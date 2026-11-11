/**
 * Offline-first synchronisation. Local changes wait in `sync_outbox` (written in the same
 * transaction as the change); this engine sends them, downloads what others changed and
 * keeps whatever cannot be merged for a person to decide.
 */

import type { Row, SqlRunner } from "../data/db";
import { ValidationError } from "../data/errors";
import { validateInput, type EntityDef } from "../data/entity";
import { getSetting, setSetting, writeAudit } from "../data/system";
import type { Workspace } from "../data/workspace";
import type { Transport, WireChange, WireOperation, WireResult, WireServerRecord } from "./api";

const BATCH = 100;
const PAGE = 200;
const CURSOR = "sync.cursor";
const ADOPTED = "sync.adopted";
const LAST_SYNC = "sync.lastSyncAt";
/** Entities are written by column name: never trust a name that came over the network. */
const SAFE_NAME = /^[a-z][a-z0-9_]*$/;

interface OutboxRow extends Row {
  seq: number;
  op_id: string;
  entity: string;
  entity_id: string;
  kind: "create" | "update" | "delete";
  base_version: number;
  payload: string;
}

export interface SyncReport {
  sent: number;
  merged: number;
  conflicts: number;
  received: number;
  /** Changes not applied because the record has local changes waiting; fetched again later. */
  deferred: number;
  /** Changes that could not be stored (and why). */
  problems: string[];
}

export interface ConflictView {
  id: number;
  entity: string;
  entityLabel: string;
  entityId: string;
  reason: string;
  reasonText: string;
  fields: string[];
  server: WireServerRecord | null;
  local: Record<string, unknown>;
  kind: "create" | "update" | "delete";
  createdAt: string;
  canKeepMine: boolean;
}

export const REASONS: Record<string, string> = {
  same_fields_changed: "Lo stesso dato è stato modificato su un altro dispositivo",
  financial_record_changed:
    "Un documento o movimento contabile è stato modificato altrove: i dati contabili non si uniscono da soli",
  changed_since: "Il record è stato modificato altrove dopo la tua ultima sincronizzazione",
  deleted: "Il record è stato eliminato su un altro dispositivo",
  missing: "Il server non conosce questo record",
  already_exists: "Esiste già un record con lo stesso identificativo",
};

const SYSTEM_KEYS = new Set(["id", "version", "deleted_at"]);

const stripSystem = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !SYSTEM_KEYS.has(key)));

export class SyncEngine {
  private running = false;

  constructor(
    private readonly ws: Workspace,
    private readonly transport: Transport,
  ) {}

  // --- first connection ---------------------------------------------------------------

  /**
   * Queues every existing record, once. Before the app was linked nothing was written to the
   * outbox, so without this the server would never learn about the data already entered.
   */
  async adopt(): Promise<number> {
    let queued = 0;
    await this.ws.transact(async (tx, ctx) => {
      if (await getSetting<boolean>(tx, ADOPTED)) return;
      for (const def of this.ws.registry.entities) {
        const rows = await tx.query(
          `SELECT * FROM ${def.table} WHERE deleted_at IS NULL ORDER BY created_at`,
        );
        for (const row of rows) {
          const record = this.fromRow(def, row);
          await tx.execute(
            `INSERT INTO sync_outbox (op_id, device_id, entity, entity_id, kind, base_version, payload, created_at)
             VALUES (?, ?, ?, ?, 'create', 0, ?, ?)`,
            [
              ctx.newId(),
              ctx.deviceId,
              def.key,
              String(row["id"]),
              JSON.stringify({ record }),
              ctx.now(),
            ],
          );
          queued++;
        }
      }
      await setSetting(tx, ADOPTED, true, ctx.now());
      await setSetting(tx, "sync.enabled", true, ctx.now());
    });
    await this.ws.setSyncEnabled(true);
    return queued;
  }

  private fromRow(def: EntityDef, row: Row): Record<string, unknown> {
    const record: Record<string, unknown> = { ...row };
    for (const field of def.fields) {
      if (field.type === "boolean" && record[field.name] !== null)
        record[field.name] = record[field.name] === 1;
    }
    return record;
  }

  // --- status -------------------------------------------------------------------------

  async pendingCount(): Promise<number> {
    const [row] = await this.ws.db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sync_outbox WHERE status IN ('pending', 'blocked')",
    );
    return Number(row?.n ?? 0);
  }

  async lastSyncAt(): Promise<string | null> {
    return getSetting<string>(this.ws.db, LAST_SYNC);
  }

  // --- the cycle ----------------------------------------------------------------------

  async syncNow(): Promise<SyncReport> {
    if (this.running) throw new Error("Una sincronizzazione è già in corso");
    this.running = true;
    try {
      const report: SyncReport = {
        sent: 0,
        merged: 0,
        conflicts: 0,
        received: 0,
        deferred: 0,
        problems: [],
      };
      await this.pushAll(report);
      await this.pullAll(report);
      await setSetting(this.ws.db, LAST_SYNC, this.ws.ctx.now(), this.ws.ctx.now());
      this.ws.touch();
      return report;
    } finally {
      this.running = false;
    }
  }

  private toWire(row: OutboxRow): WireOperation {
    const payload = JSON.parse(row.payload) as {
      record?: Record<string, unknown>;
      fields?: Record<string, unknown>;
    };
    if (row.kind === "create") {
      const record = payload.record ?? {};
      return {
        op_id: row.op_id,
        entity: row.entity,
        entity_id: row.entity_id,
        kind: "create",
        base_version: 0,
        version: Number(record["version"] ?? 1),
        payload: stripSystem(record),
      };
    }
    return {
      op_id: row.op_id,
      entity: row.entity,
      entity_id: row.entity_id,
      kind: row.kind,
      base_version: row.base_version,
      payload: row.kind === "update" ? (payload.fields ?? {}) : {},
    };
  }

  private sameAsServer(row: OutboxRow, server: WireServerRecord): boolean {
    const record = stripSystem(
      (JSON.parse(row.payload) as { record?: Record<string, unknown> }).record ?? {},
    );
    const ignore = new Set(["created_at", "updated_at"]);
    const keys = new Set(
      [...Object.keys(record), ...Object.keys(server.data)].filter((k) => !ignore.has(k)),
    );
    for (const key of keys) {
      if ((record[key] ?? null) !== (server.data[key] ?? null)) return false;
    }
    return true;
  }

  private async pushAll(report: SyncReport): Promise<void> {
    for (;;) {
      const pending = await this.ws.db.query<OutboxRow>(
        "SELECT seq, op_id, entity, entity_id, kind, base_version, payload FROM sync_outbox WHERE status = 'pending' ORDER BY seq LIMIT 1000",
      );
      if (pending.length === 0) return;
      // One operation per record per round: the next one is rebased on what the server answers.
      const seen = new Set<string>();
      const batch: OutboxRow[] = [];
      for (const row of pending) {
        if (seen.has(row.entity_id)) continue;
        seen.add(row.entity_id);
        batch.push(row);
        if (batch.length === BATCH) break;
      }
      const results = await this.transport.push(batch.map((row) => this.toWire(row)));
      const byOp = new Map(results.map((r) => [r.op_id, r]));
      for (const row of batch) {
        const result = byOp.get(row.op_id);
        if (!result) throw new Error("Il server non ha risposto a tutte le operazioni");
        await this.record(row, result, report);
      }
    }
  }

  private async record(row: OutboxRow, result: WireResult, report: SyncReport): Promise<void> {
    await this.ws.db.transaction(async (tx) => {
      if (
        result.status === "applied" ||
        result.status === "merged" ||
        result.status === "duplicate"
      ) {
        await tx.execute("UPDATE sync_outbox SET status = 'sent', sent_at = ? WHERE seq = ?", [
          this.ws.ctx.now(),
          row.seq,
        ]);
        report.sent++;
        if (result.status === "merged") report.merged++;
        // Later edits of the same record continue from the version the server now has.
        const payload = JSON.parse(row.payload) as { record?: { version?: number } };
        const expected =
          row.kind === "create" ? Number(payload.record?.version ?? 1) : row.base_version + 1;
        const delta = Number(result.version) - expected;
        if (delta !== 0) {
          await tx.execute(
            "UPDATE sync_outbox SET base_version = base_version + ? WHERE entity_id = ? AND status = 'pending' AND seq > ?",
            [delta, row.entity_id, row.seq],
          );
        }
        return;
      }
      // The server already holds this very record (reference data every installation creates,
      // or a reconnection): nothing to decide.
      if (
        row.kind === "create" &&
        result.reason === "already_exists" &&
        result.server &&
        this.sameAsServer(row, result.server)
      ) {
        await tx.execute("UPDATE sync_outbox SET status = 'sent', sent_at = ? WHERE seq = ?", [
          this.ws.ctx.now(),
          row.seq,
        ]);
        report.sent++;
        return;
      }
      const reason =
        result.status === "rejected"
          ? `rejected:${result.reason ?? ""}`
          : (result.reason ?? "conflict");
      await tx.execute("UPDATE sync_outbox SET status = 'conflict' WHERE seq = ?", [row.seq]);
      // Later changes to the same record wait: they build on this one.
      await tx.execute(
        "UPDATE sync_outbox SET status = 'blocked' WHERE entity_id = ? AND status = 'pending' AND seq > ?",
        [row.entity_id, row.seq],
      );
      await tx.execute(
        `INSERT INTO sync_conflicts (op_id, entity, entity_id, reason, fields, server, local, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.op_id,
          row.entity,
          row.entity_id,
          reason,
          JSON.stringify(result.conflicting_fields),
          result.server ? JSON.stringify(result.server) : null,
          row.payload,
          this.ws.ctx.now(),
        ],
      );
      report.conflicts++;
    });
  }

  private async pullAll(report: SyncReport): Promise<void> {
    let cursor = (await getSetting<number>(this.ws.db, CURSOR)) ?? 0;
    let firstSkipped: number | null = null;
    for (;;) {
      const page = await this.transport.pull(cursor, PAGE);
      for (const change of page.changes) {
        const outcome = await this.apply(change);
        if (outcome === "applied") report.received++;
        else if (outcome === "deferred") {
          report.deferred++;
          firstSkipped ??= change.seq;
        } else if (outcome !== "same") {
          report.problems.push(outcome.problem);
          firstSkipped ??= change.seq;
        }
      }
      cursor = page.cursor;
      if (!page.has_more) break;
    }
    // A skipped change is fetched again next time (applying is idempotent).
    const next = firstSkipped === null ? cursor : Math.min(cursor, firstSkipped - 1);
    await setSetting(this.ws.db, CURSOR, next, this.ws.ctx.now());
  }

  private async hasLocalChanges(tx: SqlRunner, entityId: string): Promise<boolean> {
    const [row] = await tx.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sync_outbox WHERE entity_id = ? AND status IN ('pending', 'conflict', 'blocked')",
      [entityId],
    );
    return Number(row?.n) > 0;
  }

  /** Stores one change from the server. Never writes to the outbox: it came from there. */
  private async apply(
    change: WireChange,
    force = false,
  ): Promise<"applied" | "same" | "deferred" | { problem: string }> {
    if (!SAFE_NAME.test(change.entity) || !this.ws.registry.has(change.entity)) {
      return { problem: `Record di tipo sconosciuto «${change.entity}»: aggiorna l'applicazione` };
    }
    const def = this.ws.registry.get(change.entity);
    try {
      return await this.ws.db.transaction(async (tx) => {
        if (!force && (await this.hasLocalChanges(tx, change.entity_id)))
          return "deferred" as const;
        // Records may arrive before the ones they refer to; check the references at the end.
        await tx.execute("PRAGMA defer_foreign_keys = ON");
        const [local] = await tx.query<{ version: number; deleted_at: string | null }>(
          `SELECT version, deleted_at FROM ${def.table} WHERE id = ?`,
          [change.entity_id],
        );
        if (!force && local && local.version >= change.version) return "same" as const;

        if (change.deleted) {
          if (!local) return "same" as const;
          const now = this.ws.ctx.now();
          await tx.execute(
            `UPDATE ${def.table} SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`,
            [now, change.version, now, change.entity_id],
          );
        } else {
          const known = new Set(def.fields.map((f) => f.name));
          const data: Record<string, unknown> = {};
          for (const [name, value] of Object.entries(change.data))
            if (known.has(name)) data[name] = value;
          let clean: Record<string, unknown>;
          try {
            clean = validateInput(def, data, "create");
          } catch (error) {
            if (error instanceof ValidationError)
              throw new Error(`${def.label} non valido dal server: ${error.message}`, {
                cause: error,
              });
            throw error;
          }
          const now = this.ws.ctx.now();
          const createdAt =
            typeof change.data["created_at"] === "string" ? change.data["created_at"] : now;
          const updatedAt =
            typeof change.data["updated_at"] === "string" ? change.data["updated_at"] : now;
          const names = def.fields.map((f) => f.name);
          const values = def.fields.map((f) => {
            const v = clean[f.name];
            return v === undefined || v === null
              ? null
              : f.type === "boolean"
                ? v
                  ? 1
                  : 0
                : (v as string | number);
          });
          const columns = ["id", "version", "created_at", "updated_at", "deleted_at", ...names];
          const params = [change.entity_id, change.version, createdAt, updatedAt, null, ...values];
          await tx.execute(
            `INSERT INTO ${def.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
             ON CONFLICT(id) DO UPDATE SET ${columns
               .slice(1)
               .map((c) => `${c} = excluded.${c}`)
               .join(", ")}`,
            params,
          );
        }
        await writeAudit(tx, this.ws.ctx, {
          action: "sync",
          entity: def.key,
          entityId: change.entity_id,
          summary: `Ricevuto dal server (versione ${change.version})`,
          changes: {},
        });
        return "applied" as const;
      });
    } catch (error) {
      return { problem: `${def.label}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // --- conflicts ----------------------------------------------------------------------

  async conflicts(): Promise<ConflictView[]> {
    const rows = await this.ws.db.query<{
      id: number;
      op_id: string;
      entity: string;
      entity_id: string;
      reason: string;
      fields: string;
      server: string | null;
      local: string;
    }>(
      "SELECT id, op_id, entity, entity_id, reason, fields, server, local FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY id",
    );
    const out: ConflictView[] = [];
    for (const row of rows) {
      const def = this.ws.registry.has(row.entity) ? this.ws.registry.get(row.entity) : null;
      const [op] = await this.ws.db.query<{
        kind: "create" | "update" | "delete";
        created_at: string;
      }>("SELECT kind, created_at FROM sync_outbox WHERE op_id = ?", [row.op_id]);
      const local = JSON.parse(row.local) as {
        record?: Record<string, unknown>;
        fields?: Record<string, unknown>;
      };
      const server = row.server ? (JSON.parse(row.server) as WireServerRecord) : null;
      const kind = op?.kind ?? "update";
      out.push({
        id: row.id,
        entity: row.entity,
        entityLabel: def?.label ?? row.entity,
        entityId: row.entity_id,
        reason: row.reason,
        reasonText: row.reason.startsWith("rejected:")
          ? `Il server ha rifiutato la modifica (${row.reason.slice(9)})`
          : (REASONS[row.reason] ?? row.reason),
        fields: JSON.parse(row.fields) as string[],
        server,
        local: local.fields ?? local.record ?? {},
        kind,
        createdAt: op?.created_at ?? "",
        // Keeping your version only makes sense on top of a live server record, or to re-create a missing one.
        canKeepMine:
          row.reason === "missing" ||
          (server !== null &&
            !server.deleted &&
            kind !== "create" &&
            !row.reason.startsWith("rejected:")),
      });
    }
    return out;
  }

  async resolve(conflictId: number, choice: "mine" | "server"): Promise<void> {
    const [conflict] = await this.ws.db.query<{
      id: number;
      op_id: string;
      entity: string;
      entity_id: string;
      reason: string;
      server: string | null;
    }>(
      "SELECT id, op_id, entity, entity_id, reason, server FROM sync_conflicts WHERE id = ? AND resolved_at IS NULL",
      [conflictId],
    );
    if (!conflict) throw new Error("Conflitto non trovato");
    const server = conflict.server ? (JSON.parse(conflict.server) as WireServerRecord) : null;
    const now = this.ws.ctx.now();

    if (choice === "server") {
      if (server) {
        await this.ws.db.execute(
          "UPDATE sync_outbox SET status = 'discarded' WHERE entity_id = ? AND status IN ('conflict', 'blocked', 'pending')",
          [conflict.entity_id],
        );
        const result = await this.apply(
          {
            seq: 0,
            entity: server.entity,
            entity_id: server.entity_id,
            version: server.version,
            deleted: server.deleted,
            data: server.data,
          },
          true,
        );
        if (typeof result === "object") throw new Error(result.problem);
      } else {
        // The server never heard of it: giving up on mine means removing it here too.
        await this.ws.db.transaction(async (tx) => {
          await tx.execute(
            "UPDATE sync_outbox SET status = 'discarded' WHERE entity_id = ? AND status IN ('conflict', 'blocked', 'pending')",
            [conflict.entity_id],
          );
          const def = this.ws.registry.get(conflict.entity);
          await tx.execute(
            `UPDATE ${def.table} SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
            [now, conflict.entity_id],
          );
        });
      }
    } else {
      await this.ws.db.transaction(async (tx) => {
        const [head] = await tx.query<{
          seq: number;
          base_version: number;
          kind: string;
          payload: string;
        }>("SELECT seq, base_version, kind, payload FROM sync_outbox WHERE op_id = ?", [
          conflict.op_id,
        ]);
        if (!head) throw new Error("Operazione non trovata");
        if (conflict.reason === "missing") {
          // Re-create it from the local copy.
          const def = this.ws.registry.get(conflict.entity);
          const [row] = await tx.query(`SELECT * FROM ${def.table} WHERE id = ?`, [
            conflict.entity_id,
          ]);
          if (!row) throw new Error("Il record locale non esiste più");
          await tx.execute(
            "UPDATE sync_outbox SET kind = 'create', base_version = 0, payload = ?, status = 'pending' WHERE seq = ?",
            [JSON.stringify({ record: this.fromRow(def, row) }), head.seq],
          );
          await tx.execute(
            "UPDATE sync_outbox SET status = 'discarded' WHERE entity_id = ? AND status = 'blocked'",
            [conflict.entity_id],
          );
        } else {
          if (!server || server.deleted) throw new Error("Il record non esiste più sul server");
          const delta = server.version - head.base_version;
          await tx.execute(
            "UPDATE sync_outbox SET base_version = ?, status = 'pending' WHERE seq = ?",
            [server.version, head.seq],
          );
          await tx.execute(
            "UPDATE sync_outbox SET base_version = base_version + ?, status = 'pending' WHERE entity_id = ? AND status = 'blocked'",
            [delta, conflict.entity_id],
          );
        }
      });
    }
    await this.ws.db.execute(
      "UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE id = ?",
      [now, choice, conflictId],
    );
    this.ws.touch();
  }

  /** Ends the link: nothing is deleted locally; changes are simply no longer queued. */
  async disconnect(): Promise<void> {
    await this.ws.setSyncEnabled(false);
    await setSetting(this.ws.db, ADOPTED, false, this.ws.ctx.now());
    await setSetting(this.ws.db, CURSOR, 0, this.ws.ctx.now());
    await this.ws.db.execute(
      "UPDATE sync_outbox SET status = 'discarded' WHERE status IN ('pending', 'blocked', 'conflict')",
    );
    await this.ws.db.execute(
      "UPDATE sync_conflicts SET resolved_at = ?, resolution = 'disconnected' WHERE resolved_at IS NULL",
      [this.ws.ctx.now()],
    );
    this.ws.touch();
  }
}
