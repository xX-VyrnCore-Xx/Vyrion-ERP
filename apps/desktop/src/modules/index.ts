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
  ];
}
