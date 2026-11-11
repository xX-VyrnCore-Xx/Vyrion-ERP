import type { Param, Row, SqlRunner } from "./db";
import {
  ConflictError,
  LockedError,
  NotFoundError,
  ValidationError,
  VersionConflictError,
} from "./errors";
import {
  validateInput,
  type Ctx,
  type EntityDef,
  type FieldDef,
  type HookContext,
  type Rec,
  type SaveMode,
} from "./entity";
import type { Registry } from "./registry";
import { enqueueSync, writeAudit } from "./system";
import { isUuid } from "../lib/ids";

export interface ListOptions {
  search?: string;
  filters?: Record<string, Param | Param[] | undefined>;
  /** "field asc" or "field desc"; only the entity's own fields are accepted. */
  orderBy?: string;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  /** Trusted SQL (built by the app, never from user text) with its bound parameters. */
  where?: { sql: string; params?: Param[] };
}

export interface Page {
  rows: Rec[];
  total: number;
}

const MAX_LIMIT = 1000;
const LIKE_ESCAPE = /[\\%_]/g;

function sameValue(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

export class EntityRepository {
  constructor(
    readonly def: EntityDef,
    private readonly registry: Registry,
  ) {}

  private get columns(): string[] {
    return [
      "id",
      "version",
      "created_at",
      "updated_at",
      "deleted_at",
      ...this.def.fields.map((f) => f.name),
    ];
  }

  private fromRow(row: Row): Rec {
    const record: Record<string, unknown> = { ...row };
    for (const field of this.def.fields) {
      if (field.type === "boolean" && record[field.name] !== null)
        record[field.name] = record[field.name] === 1;
    }
    return record as Rec;
  }

  private toParam(field: FieldDef, value: unknown): Param {
    if (value === null || value === undefined) return null;
    if (field.type === "boolean") return value ? 1 : 0;
    return value as Param;
  }

  async get(tx: SqlRunner, id: string, includeDeleted = false): Promise<Rec | null> {
    const rows = await tx.query(
      `SELECT ${this.columns.join(", ")} FROM ${this.def.table} WHERE id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`,
      [id],
    );
    return rows[0] ? this.fromRow(rows[0]) : null;
  }

  async require(tx: SqlRunner, id: string): Promise<Rec> {
    const record = await this.get(tx, id);
    if (!record) throw new NotFoundError(this.def.label);
    return record;
  }

  async list(tx: SqlRunner, options: ListOptions = {}): Promise<Page> {
    const clauses: string[] = [];
    const params: Param[] = [];
    if (!options.includeDeleted) clauses.push("deleted_at IS NULL");

    const known = new Map(this.def.fields.map((f) => [f.name, f]));
    for (const [name, wanted] of Object.entries(options.filters ?? {})) {
      if (wanted === undefined) continue;
      const field = known.get(name);
      if (!field && !["id", "version", "created_at", "updated_at"].includes(name)) {
        throw new Error(`Cannot filter ${this.def.key} by unknown field ${name}`);
      }
      const values = (Array.isArray(wanted) ? wanted : [wanted]).map((v) =>
        field ? this.toParam(field, v) : v,
      );
      if (values.length === 0) {
        clauses.push("0 = 1");
      } else if (values.includes(null) && values.length === 1) {
        clauses.push(`${name} IS NULL`);
      } else {
        clauses.push(`${name} IN (${values.map(() => "?").join(", ")})`);
        params.push(...values);
      }
    }

    const search = options.search?.trim();
    if (search) {
      const searchable = this.def.fields.filter((f) => f.searchable);
      if (searchable.length) {
        const pattern = `%${search.replace(LIKE_ESCAPE, (c) => `\\${c}`)}%`;
        clauses.push(`(${searchable.map((f) => `${f.name} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
        params.push(...searchable.map(() => pattern));
      }
    }
    if (options.where) {
      clauses.push(`(${options.where.sql})`);
      params.push(...(options.where.params ?? []));
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [orderField, orderDir = "asc"] = (
      options.orderBy ??
      this.def.defaultOrder ??
      "created_at desc"
    ).split(" ");
    if (
      !orderField ||
      !this.columns.includes(orderField) ||
      !["asc", "desc"].includes(orderDir.toLowerCase())
    ) {
      throw new Error(`Invalid order for ${this.def.key}: ${options.orderBy}`);
    }
    const limit = Math.min(Math.max(options.limit ?? 100, 1), MAX_LIMIT);
    const offset = Math.max(options.offset ?? 0, 0);

    const [{ n } = { n: 0 }] = await tx.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${this.def.table} ${where}`,
      params,
    );
    const rows = await tx.query(
      `SELECT ${this.columns.join(", ")} FROM ${this.def.table} ${where}
       ORDER BY ${orderField} ${orderDir.toUpperCase()}, id ASC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return { rows: rows.map((r) => this.fromRow(r)), total: Number(n) };
  }

  // --- writes -------------------------------------------------------------------------

  async create(tx: SqlRunner, ctx: Ctx, input: Record<string, unknown>): Promise<Rec> {
    const values = validateInput(this.def, input, "create");
    const suppliedId = input["id"];
    const now = ctx.now();
    const record = {
      id: isUuid(suppliedId) ? suppliedId : ctx.newId(),
      version: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      ...values,
    } as Rec;

    await this.runHook(this.def.beforeSave, tx, ctx, "create", null, record);
    this.revalidate(record);
    await this.checkReferences(tx, record, this.def.fields);

    await this.write("insert", tx, record);
    await this.runHook(this.def.afterSave, tx, ctx, "create", null, record);

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const field of this.def.fields) {
      if (record[field.name] !== null && record[field.name] !== undefined) {
        changes[field.name] = { old: null, new: this.audited(field, record[field.name]) };
      }
    }
    await writeAudit(tx, ctx, {
      action: "create",
      entity: this.def.key,
      entityId: record.id,
      summary: this.def.title(record),
      changes,
    });
    await enqueueSync(tx, ctx, {
      entity: this.def.key,
      entityId: record.id,
      kind: "create",
      baseVersion: 0,
      payload: { record },
    });
    return record;
  }

  async update(
    tx: SqlRunner,
    ctx: Ctx,
    id: string,
    patch: Record<string, unknown>,
    options: { expectedVersion?: number } = {},
  ): Promise<Rec> {
    const before = await this.require(tx, id);
    this.assertEditable(before);
    if (options.expectedVersion !== undefined && options.expectedVersion !== before.version) {
      throw new VersionConflictError(options.expectedVersion, before.version);
    }
    const values = validateInput(this.def, patch, "update");
    const record = { ...before, ...values } as Rec;

    await this.runHook(this.def.beforeSave, tx, ctx, "update", before, record);
    this.revalidate(record);

    const changed = this.def.fields.filter((f) => !sameValue(record[f.name], before[f.name]));
    if (changed.length === 0) return before;
    await this.checkReferences(tx, record, changed);

    record.version = before.version + 1;
    record.updated_at = ctx.now();
    await this.write("update", tx, record, changed, before.version);
    await this.runHook(this.def.afterSave, tx, ctx, "update", before, record);

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const fields: Record<string, unknown> = {};
    for (const field of changed) {
      changes[field.name] = {
        old: this.audited(field, before[field.name]),
        new: this.audited(field, record[field.name]),
      };
      fields[field.name] = record[field.name];
    }
    // The server never treats updated_at as a conflict: it only follows the latest edit.
    fields["updated_at"] = record.updated_at;
    await writeAudit(tx, ctx, {
      action: "update",
      entity: this.def.key,
      entityId: id,
      summary: this.def.title(record),
      changes,
    });
    await enqueueSync(tx, ctx, {
      entity: this.def.key,
      entityId: id,
      kind: "update",
      baseVersion: before.version,
      payload: { fields },
    });
    return record;
  }

  /** Soft delete: the row stays (history, synchronisation) but disappears from every list. */
  async remove(
    tx: SqlRunner,
    ctx: Ctx,
    id: string,
    options: { expectedVersion?: number } = {},
  ): Promise<void> {
    const before = await this.require(tx, id);
    if (this.def.noDelete) throw new LockedError(`${this.def.plural} non possono essere eliminati`);
    this.assertEditable(before);
    if (options.expectedVersion !== undefined && options.expectedVersion !== before.version) {
      throw new VersionConflictError(options.expectedVersion, before.version);
    }
    const record = {
      ...before,
      deleted_at: ctx.now(),
      updated_at: ctx.now(),
      version: before.version + 1,
    } as Rec;
    // The hook may remove records that belong to this one (e.g. document lines) first.
    await this.runHook(this.def.beforeDelete, tx, ctx, "delete", before, record);
    await this.assertNotReferenced(tx, id);

    const result = await tx.execute(
      `UPDATE ${this.def.table} SET deleted_at = ?, updated_at = ?, version = ? WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      [record.deleted_at, record.updated_at, record.version, id, before.version],
    );
    if (result.changes === 0) throw new VersionConflictError(before.version, before.version + 1);

    await writeAudit(tx, ctx, {
      action: "delete",
      entity: this.def.key,
      entityId: id,
      summary: this.def.title(before),
      changes: { _deleted: true },
    });
    await enqueueSync(tx, ctx, {
      entity: this.def.key,
      entityId: id,
      kind: "delete",
      baseVersion: before.version,
      payload: {},
    });
  }

  // --- internals ----------------------------------------------------------------------

  private assertEditable(record: Rec): void {
    const reason = this.def.lockedReason?.(record);
    if (reason) throw new LockedError(reason);
  }

  private audited(field: FieldDef, value: unknown): unknown {
    return field.sensitive && value !== null && value !== undefined ? "***" : value;
  }

  private async runHook(
    hook: ((context: HookContext) => Promise<void> | void) | undefined,
    tx: SqlRunner,
    ctx: Ctx,
    mode: SaveMode,
    before: Rec | null,
    record: Rec,
  ): Promise<void> {
    if (hook)
      await hook({
        tx,
        ctx,
        repo: (key) => new EntityRepository(this.registry.get(key), this.registry),
        mode,
        before,
        record,
      });
  }

  /** Hooks may set fields; whatever they set must still be valid. */
  private revalidate(record: Rec): void {
    const editable: Record<string, unknown> = {};
    for (const field of this.def.fields) editable[field.name] = record[field.name];
    const clean = validateInput(this.def, editable, "create");
    for (const [name, value] of Object.entries(clean)) record[name] = value;
  }

  private async checkReferences(tx: SqlRunner, record: Rec, fields: FieldDef[]): Promise<void> {
    const errors: Record<string, string> = {};
    for (const field of fields) {
      const value = record[field.name];
      if (field.type !== "ref" || value === null || value === undefined || !field.ref) continue;
      const table = this.registry.tableOf(field.ref);
      const found = await tx.query(
        `SELECT 1 AS found FROM ${table} WHERE id = ? AND deleted_at IS NULL`,
        [value as string],
      );
      if (found.length === 0) errors[field.name] = "Il record collegato non esiste";
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
  }

  private async assertNotReferenced(tx: SqlRunner, id: string): Promise<void> {
    for (const { entity, field } of this.registry.referencing(this.def.key)) {
      const [{ n } = { n: 0 }] = await tx.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${entity.table} WHERE ${field.name} = ? AND deleted_at IS NULL`,
        [id],
      );
      if (Number(n) > 0) {
        throw new ConflictError(
          `Impossibile eliminare: è usato da ${n} ${Number(n) === 1 ? entity.label.toLowerCase() : entity.plural.toLowerCase()}`,
        );
      }
    }
  }

  private async write(
    kind: "insert" | "update",
    tx: SqlRunner,
    record: Rec,
    changed: FieldDef[] = this.def.fields,
    expectedVersion?: number,
  ): Promise<void> {
    try {
      if (kind === "insert") {
        const names = this.columns;
        const params = names.map((name) => {
          const field = this.def.fields.find((f) => f.name === name);
          return field ? this.toParam(field, record[name]) : (record[name] as Param);
        });
        await tx.execute(
          `INSERT INTO ${this.def.table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
          params,
        );
        return;
      }
      const sets = ["version = ?", "updated_at = ?", ...changed.map((f) => `${f.name} = ?`)];
      const params: Param[] = [
        record.version,
        record.updated_at,
        ...changed.map((f) => this.toParam(f, record[f.name])),
        record.id,
        expectedVersion as number,
      ];
      const result = await tx.execute(
        `UPDATE ${this.def.table} SET ${sets.join(", ")} WHERE id = ? AND version = ? AND deleted_at IS NULL`,
        params,
      );
      if (result.changes === 0)
        throw new VersionConflictError(expectedVersion as number, (expectedVersion as number) + 1);
    } catch (error) {
      throw this.friendly(error);
    }
  }

  /** Turns raw constraint failures into messages a person can act on. */
  private friendly(error: unknown): unknown {
    const message = error instanceof Error ? error.message : String(error);
    const unique = /UNIQUE constraint failed: ([\w.,\s]+)/.exec(message);
    if (unique) {
      const columns = (unique[1] as string)
        .split(",")
        .map((c) => c.trim().split(".").pop() as string);
      const labels = columns.map((c) => this.def.fields.find((f) => f.name === c)?.label ?? c);
      return new ConflictError(`${labels.join(" / ")} già presente`);
    }
    if (message.includes("FOREIGN KEY constraint failed")) {
      return new ConflictError("Il record collegato non esiste o è ancora in uso");
    }
    return error;
  }
}
