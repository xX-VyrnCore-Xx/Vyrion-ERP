import type { EntityDef } from "../data/entity";
import type { Migration } from "../data/migrations";
import { CRM_ENTITIES } from "./crm";
import { ERP_ENTITIES } from "./erp";
import { IT_ENTITIES } from "./it";
import { BUSINESS_SCHEMA_V2 } from "./schemaV2";

export const ALL_ENTITIES: EntityDef[] = [...CRM_ENTITIES, ...ERP_ENTITIES, ...IT_ENTITIES];

/**
 * Schema of the business tables. Applied migrations are frozen as literal SQL (an applied
 * migration whose text changes is refused), so a change to an entity definition needs a new
 * migration here with the matching `ALTER TABLE` / `CREATE TABLE`, never an edit of an old one.
 */
export function businessMigrations(): Migration[] {
  return [
    {
      id: 2,
      name: "business-entities",
      statements: [...BUSINESS_SCHEMA_V2],
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
    {
      id: 4,
      name: "warehouses-lots",
      statements: [
        `CREATE TABLE warehouses (
           id TEXT PRIMARY KEY,
           version INTEGER NOT NULL DEFAULT 1,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           deleted_at TEXT,
           name TEXT NOT NULL,
           address TEXT,
           notes TEXT
         )`,
        `CREATE UNIQUE INDEX uq_warehouses_name ON warehouses(name) WHERE deleted_at IS NULL`,
        `CREATE INDEX ix_warehouses_updated ON warehouses(updated_at)`,
        `CREATE TABLE stock_lots (
           id TEXT PRIMARY KEY,
           version INTEGER NOT NULL DEFAULT 1,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           deleted_at TEXT,
           product_id TEXT NOT NULL REFERENCES products(id),
           code TEXT NOT NULL,
           expiry_date TEXT,
           notes TEXT
         )`,
        `CREATE INDEX ix_stock_lots_product_id ON stock_lots(product_id) WHERE deleted_at IS NULL`,
        `CREATE UNIQUE INDEX uq_stock_lots_code_product_id ON stock_lots(code, product_id) WHERE deleted_at IS NULL`,
        `CREATE INDEX ix_stock_lots_updated ON stock_lots(updated_at)`,
        `ALTER TABLE products ADD COLUMN track_lots INTEGER CHECK (track_lots IS NULL OR track_lots IN (0, 1))`,
        `ALTER TABLE stock_movements ADD COLUMN warehouse_id TEXT REFERENCES warehouses(id)`,
        `ALTER TABLE stock_movements ADD COLUMN lot_id TEXT REFERENCES stock_lots(id)`,
        `CREATE INDEX ix_stock_movements_warehouse_id ON stock_movements(warehouse_id) WHERE deleted_at IS NULL`,
        `CREATE INDEX ix_stock_movements_lot_id ON stock_movements(lot_id) WHERE deleted_at IS NULL`,
      ],
    },
    {
      id: 5,
      name: "fixed-assets-bank",
      statements: [
        `CREATE TABLE fixed_assets (
           id TEXT PRIMARY KEY,
           version INTEGER NOT NULL DEFAULT 1,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           deleted_at TEXT,
           name TEXT NOT NULL,
           category TEXT NOT NULL CHECK (category IS NULL OR category IN ('building', 'plant', 'furniture', 'electronics', 'vehicle', 'software', 'other')),
           purchase_date TEXT NOT NULL,
           cost INTEGER NOT NULL,
           rate REAL NOT NULL,
           residual INTEGER,
           capitalize INTEGER CHECK (capitalize IS NULL OR capitalize IN (0, 1)),
           disposed_on TEXT,
           notes TEXT
         )`,
        `CREATE INDEX ix_fixed_assets_updated ON fixed_assets(updated_at)`,
        `CREATE TABLE bank_transactions (
           id TEXT PRIMARY KEY,
           version INTEGER NOT NULL DEFAULT 1,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           deleted_at TEXT,
           date TEXT NOT NULL,
           description TEXT NOT NULL,
           amount INTEGER NOT NULL,
           status TEXT NOT NULL CHECK (status IS NULL OR status IN ('open', 'matched', 'ignored')),
           payment_id TEXT REFERENCES payments(id),
           import_key TEXT,
           notes TEXT
         )`,
        `CREATE INDEX ix_bank_transactions_payment_id ON bank_transactions(payment_id) WHERE deleted_at IS NULL`,
        `CREATE INDEX ix_bank_transactions_import_key ON bank_transactions(import_key) WHERE deleted_at IS NULL`,
        `CREATE INDEX ix_bank_transactions_updated ON bank_transactions(updated_at)`,
      ],
    },
    {
      id: 6,
      name: "crm-reminders-calendar-billing",
      statements: [
        `ALTER TABLE parties ADD COLUMN hourly_rate INTEGER`,
        `ALTER TABLE appointments ADD COLUMN reminder_minutes INTEGER`,
        `ALTER TABLE appointments ADD COLUMN ics_uid TEXT`,
        `CREATE INDEX ix_appointments_ics_uid ON appointments(ics_uid) WHERE deleted_at IS NULL`,
        `ALTER TABLE tasks ADD COLUMN remind_on TEXT`,
        `ALTER TABLE ticket_interventions ADD COLUMN document_id TEXT REFERENCES documents(id)`,
        `CREATE INDEX ix_ticket_interventions_document_id ON ticket_interventions(document_id) WHERE deleted_at IS NULL`,
      ],
    },
    {
      id: 7,
      name: "documents-cassa-withholding-split",
      statements: [
        `ALTER TABLE documents ADD COLUMN cassa_rate REAL`,
        `ALTER TABLE documents ADD COLUMN cassa_amount INTEGER`,
        `ALTER TABLE documents ADD COLUMN withholding_rate REAL`,
        `ALTER TABLE documents ADD COLUMN withholding_base_pct REAL`,
        `ALTER TABLE documents ADD COLUMN withholding_on_cassa INTEGER CHECK (withholding_on_cassa IS NULL OR withholding_on_cassa IN (0, 1))`,
        `ALTER TABLE documents ADD COLUMN withholding_amount INTEGER`,
        `ALTER TABLE documents ADD COLUMN split_payment INTEGER CHECK (split_payment IS NULL OR split_payment IN (0, 1))`,
        `ALTER TABLE documents ADD COLUMN payable INTEGER`,
      ],
    },
  ];
}
