/** Tables that belong to the application rather than to a business entity. */

import type { Ctx } from "./entity";
import type { Param, SqlRunner } from "./db";
import type { Migration } from "./migrations";

export const SYSTEM_STATEMENTS: string[] = [
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  // Every change to business data is recorded here, in the same transaction as the change.
  // The triggers make the trail append-only: nothing in the app can rewrite history.
  `CREATE TABLE audit_log (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     actor TEXT NOT NULL,
     device_id TEXT NOT NULL,
     action TEXT NOT NULL,
     entity TEXT NOT NULL,
     entity_id TEXT,
     summary TEXT,
     changes TEXT NOT NULL
   )`,
  `CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id)`,
  `CREATE INDEX ix_audit_at ON audit_log(at)`,
  `CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
     BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`,
  `CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
     BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`,
  // Changes waiting to be sent to the company server. Filled only while the app is linked
  // to one; each operation carries the version it was based on so the server can detect
  // concurrent edits.
  `CREATE TABLE sync_outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT NOT NULL UNIQUE,
     device_id TEXT NOT NULL,
     entity TEXT NOT NULL,
     entity_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('create', 'update', 'delete')),
     base_version INTEGER NOT NULL,
     payload TEXT NOT NULL,
     created_at TEXT NOT NULL,
     sent_at TEXT
   )`,
  `CREATE INDEX ix_outbox_pending ON sync_outbox(seq) WHERE sent_at IS NULL`,
  `CREATE TABLE dismissed_notifications (
     key TEXT PRIMARY KEY,
     dismissed_at TEXT NOT NULL
   )`,
];

export const SYSTEM_MIGRATION: Migration = {
  id: 1,
  name: "system",
  statements: SYSTEM_STATEMENTS,
};

export async function getSetting<T>(db: SqlRunner, key: string): Promise<T | null> {
  const rows = await db.query<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  const row = rows[0];
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function setSetting(
  db: SqlRunner,
  key: string,
  value: unknown,
  at: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), at],
  );
}

export async function writeAudit(
  tx: SqlRunner,
  ctx: Ctx,
  entry: {
    action: string;
    entity: string;
    entityId: string | null;
    summary?: string;
    changes?: unknown;
  },
): Promise<void> {
  await tx.execute(
    `INSERT INTO audit_log (at, actor, device_id, action, entity, entity_id, summary, changes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ctx.now(),
      ctx.actor,
      ctx.deviceId,
      entry.action,
      entry.entity,
      entry.entityId,
      entry.summary ?? null,
      JSON.stringify(entry.changes ?? {}),
    ] satisfies Param[],
  );
}

export async function enqueueSync(
  tx: SqlRunner,
  ctx: Ctx,
  op: {
    entity: string;
    entityId: string;
    kind: "create" | "update" | "delete";
    baseVersion: number;
    payload: unknown;
  },
): Promise<void> {
  if (!ctx.syncEnabled) return;
  await tx.execute(
    `INSERT INTO sync_outbox (op_id, device_id, entity, entity_id, kind, base_version, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ctx.newId(),
      ctx.deviceId,
      op.entity,
      op.entityId,
      op.kind,
      op.baseVersion,
      JSON.stringify(op.payload),
      ctx.now(),
    ],
  );
}
