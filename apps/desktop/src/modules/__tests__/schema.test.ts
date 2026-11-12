// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { join, dirname } from "node:path";
import { createRequire } from "node:module";

import { openMemoryDatabase } from "../../data/memoryDriver";
import { Workspace } from "../../data/workspace";
import { testWorkspace } from "../../test/workspace";
import { ALL_ENTITIES, businessMigrations } from "..";
import { BUSINESS_SCHEMA_V2 } from "../schemaV2";

describe("database schema", () => {
  it("keeps migration 2 exactly as installed apps recorded it", () => {
    // If this fails the frozen list was edited: installed databases would refuse to open.
    const sum = createHash("sha256").update(JSON.stringify(BUSINESS_SCHEMA_V2)).digest("hex");
    expect(sum).toBe("5bfffdbcf38632669ea45aa4191220ff189262e90419dd64fd1c49c4fa25d3d1");
  });

  it("has a column for every field of every entity after all migrations", async () => {
    const ws = await testWorkspace();
    for (const def of ws.registry.entities) {
      const rows = await ws.db.query(`PRAGMA table_info(${def.table})`);
      const columns = new Set(rows.map((r) => String(r["name"])));
      for (const field of def.fields)
        expect(columns.has(field.name), `${def.table}.${field.name}`).toBe(true);
    }
  });

  it("upgrades a database made before warehouses and lots without losing data", async () => {
    const wasm = dirname(createRequire(import.meta.url).resolve("sql.js"));
    const db = await openMemoryDatabase((file) => join(wasm, file));
    // The app as it was: migrations up to 3 only.
    await Workspace.open({
      db,
      entities: ALL_ENTITIES,
      migrations: () => businessMigrations().slice(0, 2),
    });
    const now = "2026-01-01T00:00:00.000Z";
    await db.execute(
      `INSERT INTO products (id, created_at, updated_at, sku, name, kind, track_stock) VALUES ('p1', ?, ?, 'A1', 'Vite', 'goods', 1)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO stock_movements (id, created_at, updated_at, product_id, date, kind, quantity) VALUES ('m1', ?, ?, 'p1', '2026-01-01', 'in', 10)`,
      [now, now],
    );

    const ws = await Workspace.open({
      db,
      entities: ALL_ENTITIES,
      migrations: businessMigrations,
    });
    // every later migration kept the rows that were there
    expect((await ws.get("product", "p1"))?.["track_lots"] ?? null).toBeNull();
    const [row] = await ws.db.query("SELECT quantity, warehouse_id, lot_id FROM stock_movements");
    expect(row).toEqual({ quantity: 10, warehouse_id: null, lot_id: null });
    expect((await ws.get("product", "p1"))?.["name"]).toBe("Vite");
    await ws.create("warehouse", { name: "Deposito" });
  });
});
