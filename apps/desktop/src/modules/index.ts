import type { EntityDef } from "../data/entity";
import type { Migration } from "../data/migrations";
import { createTableSql } from "../data/entity";
import type { Registry } from "../data/registry";
import { CRM_ENTITIES } from "./crm";
import { ERP_ENTITIES } from "./erp";
import { IT_ENTITIES } from "./it";

export const ALL_ENTITIES: EntityDef[] = [...CRM_ENTITIES, ...ERP_ENTITIES, ...IT_ENTITIES];

/**
 * Schema of the business tables. Pre-release only: while the app is unreleased this
 * migration follows the entity definitions. From the first stable release the generated
 * SQL is frozen here as literal statements and every later change is a new migration.
 */
export function businessMigrations(registry: Registry): Migration[] {
  return [
    {
      id: 2,
      name: "business-entities",
      statements: [
        `CREATE TABLE number_sequences (
           key TEXT PRIMARY KEY,
           last INTEGER NOT NULL,
           last_date TEXT
         )`,
        // Reachability results are operational telemetry, not business records: no audit, no sync.
        `CREATE TABLE monitor_results (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           check_id TEXT NOT NULL,
           at TEXT NOT NULL,
           up INTEGER NOT NULL CHECK (up IN (0, 1)),
           latency_ms INTEGER,
           error TEXT
         )`,
        `CREATE INDEX ix_monitor_results ON monitor_results(check_id, at)`,
        ...registry.entities.flatMap((def) => createTableSql(def, registry.tableOf)),
      ],
    },
    {
      id: 3,
      name: "sync-conflicts",
      statements: [
        // pending | sent | conflict | blocked (waits behind a conflict on the same record)
        // | discarded (dropped when the server's version was chosen)
        `ALTER TABLE sync_outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
           CHECK (status IN ('pending', 'sent', 'conflict', 'blocked', 'discarded'))`,
        `CREATE INDEX ix_outbox_record ON sync_outbox(entity_id, status)`,
        `CREATE TABLE sync_conflicts (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           op_id TEXT NOT NULL,
           entity TEXT NOT NULL,
           entity_id TEXT NOT NULL,
           reason TEXT NOT NULL,
           fields TEXT NOT NULL,
           server TEXT,
           local TEXT NOT NULL,
           created_at TEXT NOT NULL,
           resolved_at TEXT,
           resolution TEXT
         )`,
        `CREATE INDEX ix_conflicts_open ON sync_conflicts(resolved_at)`,
      ],
    },
  ];
}
