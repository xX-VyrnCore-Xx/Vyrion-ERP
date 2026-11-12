// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ConflictError, ValidationError } from "../../data/errors";
import { testWorkspace } from "../../test/workspace";
import { notifications } from "../insights";
import { issueDocument, saveDocument } from "../operations";
import { stockLevels } from "../reports";
import {
  expiringLots,
  lotLevels,
  stockByWarehouse,
  transferStock,
  valueOf,
  weightedAverage,
} from "../stock";

const clock = () => new Date("2026-06-15T10:00:00Z");

async function goods(ws: Awaited<ReturnType<typeof testWorkspace>>, extra = {}) {
  return ws.create("product", {
    sku: "V-1",
    name: "Vite",
    kind: "goods",
    track_stock: true,
    purchase_price: 1000,
    ...extra,
  });
}

describe("weighted average cost", () => {
  it("averages purchases, leaves sales at the average and prices unpriced receipts at it", () => {
    const state = weightedAverage([
      { quantity: 10, unit_cost: 1000 },
      { quantity: 10, unit_cost: 2000 },
    ]);
    expect(state).toEqual({ onHand: 20, average: 1500 });
    const afterSale = weightedAverage([
      { quantity: 10, unit_cost: 1000 },
      { quantity: 10, unit_cost: 2000 },
      { quantity: -5, unit_cost: 0 },
    ]);
    expect(afterSale).toEqual({ onHand: 15, average: 1500 });
    expect(valueOf(afterSale)).toBe(22500);
    const more = weightedAverage([
      { quantity: 10, unit_cost: 1000 },
      { quantity: 10, unit_cost: 2000 },
      { quantity: -5, unit_cost: 0 },
      { quantity: 5, unit_cost: 3000 },
      { quantity: 2, unit_cost: 0 }, // a return: at the current average
    ]);
    expect(more.average).toBeCloseTo(1875, 5);
    expect(more.onHand).toBe(22);
    // starts again from the new price once the shelf was empty
    expect(
      weightedAverage([
        { quantity: 5, unit_cost: 1000 },
        { quantity: -5, unit_cost: 0 },
        { quantity: 5, unit_cost: 4000 },
      ]).average,
    ).toBe(4000);
    // no priced purchase yet: the product's purchase price is the fallback
    expect(weightedAverage([{ quantity: 4, unit_cost: 0 }], 700).average).toBe(700);
  });

  it("values the stock list at the average, not at the last price", async () => {
    const ws = await testWorkspace();
    const p = await goods(ws);
    await ws.create("stock_movement", {
      product_id: p.id,
      date: "2026-01-01",
      kind: "in",
      quantity: 10,
      unit_cost: 1000,
    });
    await ws.create("stock_movement", {
      product_id: p.id,
      date: "2026-01-02",
      kind: "in",
      quantity: 10,
      unit_cost: 2000,
    });
    const [row] = await stockLevels(ws.db);
    expect(row?.onHand).toBe(20);
    expect(row?.value).toBe(30000); // 20 × 15,00 €
  });
});

describe("warehouses", () => {
  it("keeps stock apart and refuses a sale beyond what a warehouse holds", async () => {
    const ws = await testWorkspace();
    const p = await goods(ws);
    const deposito = await ws.create("warehouse", { name: "Deposito" });
    await ws.create("stock_movement", {
      product_id: p.id,
      date: "2026-01-01",
      kind: "in",
      quantity: 10,
      unit_cost: 1000,
    });
    await ws.create("stock_movement", {
      product_id: p.id,
      date: "2026-01-01",
      kind: "in",
      quantity: 4,
      unit_cost: 1000,
      warehouse_id: deposito.id,
    });
    await expect(
      ws.create("stock_movement", {
        product_id: p.id,
        date: "2026-01-02",
        kind: "out",
        quantity: -5,
        warehouse_id: deposito.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await ws.create("stock_movement", {
      product_id: p.id,
      date: "2026-01-02",
      kind: "out",
      quantity: -5,
    });
    const rows = await stockByWarehouse(ws.db);
    expect(rows.map((r) => [r.warehouse, r.onHand]).sort()).toEqual([
      ["Deposito", 4],
      ["Magazzino principale", 5],
    ]);
  });

  it("transfers between warehouses without changing the total or its value", async () => {
    const ws = await testWorkspace();
    const p = await goods(ws);
    const deposito = await ws.create("warehouse", { name: "Deposito" });
    await ws.create("stock_movement", {
      product_id: p.id,
      date: "2026-01-01",
      kind: "in",
      quantity: 10,
      unit_cost: 1000,
    });
    await ws.create("stock_movement", {
      product_id: p.id,
      date: "2026-01-02",
      kind: "in",
      quantity: 10,
      unit_cost: 2000,
    });
    const before = (await stockLevels(ws.db))[0];
    await transferStock(ws, {
      productId: p.id,
      fromWarehouseId: null,
      toWarehouseId: deposito.id,
      quantity: 8,
    });
    const after = (await stockLevels(ws.db))[0];
    expect(after?.onHand).toBe(before?.onHand);
    expect(after?.value).toBe(before?.value);
    const rows = await stockByWarehouse(ws.db);
    expect(rows.find((r) => r.warehouseId === deposito.id)?.onHand).toBe(8);
    expect(rows.find((r) => r.warehouseId === null)?.onHand).toBe(12);
    await expect(
      transferStock(ws, {
        productId: p.id,
        fromWarehouseId: deposito.id,
        toWarehouseId: null,
        quantity: 9,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      transferStock(ws, {
        productId: p.id,
        fromWarehouseId: null,
        toWarehouseId: null,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // the failed transfer left nothing half-done
    expect((await stockByWarehouse(ws.db)).find((r) => r.warehouseId === deposito.id)?.onHand).toBe(
      8,
    );
  });
});

describe("lots", () => {
  it("requires a lot for lot-tracked goods and refuses another product's lot", async () => {
    const ws = await testWorkspace();
    const p = await goods(ws, { track_lots: true });
    const other = await goods(ws, { sku: "V-2", name: "Dado", track_lots: true });
    await expect(
      ws.create("stock_movement", {
        product_id: p.id,
        date: "2026-01-01",
        kind: "in",
        quantity: 5,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const lot = await ws.create("stock_lot", {
      product_id: p.id,
      code: "L1",
      expiry_date: "2026-07-01",
    });
    await expect(
      ws.create("stock_movement", {
        product_id: other.id,
        date: "2026-01-01",
        kind: "in",
        quantity: 5,
        lot_id: lot.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await ws.create("stock_movement", {
      product_id: p.id,
      date: "2026-01-01",
      kind: "in",
      quantity: 5,
      lot_id: lot.id,
    });
    await expect(
      ws.create("stock_movement", {
        product_id: p.id,
        date: "2026-01-02",
        kind: "out",
        quantity: -6,
        lot_id: lot.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // a lot only for products that track lots
    const plain = await goods(ws, { sku: "V-3", name: "Chiodo" });
    await expect(
      ws.create("stock_lot", { product_id: plain.id, code: "X" }),
    ).rejects.toBeInstanceOf(ValidationError);
    // the same code is allowed on another product, not twice on the same one
    await expect(ws.create("stock_lot", { product_id: p.id, code: "L1" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await ws.create("stock_lot", { product_id: other.id, code: "L1" });
  });

  it("sells lot-tracked goods first-expired-first-out and receives purchases into a lot", async () => {
    const ws = await testWorkspace("ordinario", clock);
    const customer = await ws.create("party", { name: "Cliente", kind: "customer" });
    const supplier = await ws.create("party", { name: "Fornitore", kind: "supplier" });
    const p = await goods(ws, { track_lots: true, sale_price: 5000 });
    const late = await ws.create("stock_lot", {
      product_id: p.id,
      code: "TARDI",
      expiry_date: "2026-12-31",
    });
    const soon = await ws.create("stock_lot", {
      product_id: p.id,
      code: "PRESTO",
      expiry_date: "2026-07-01",
    });
    const none = await ws.create("stock_lot", { product_id: p.id, code: "SENZA" });
    for (const [lot, q] of [
      [late, 10],
      [soon, 4],
      [none, 10],
    ] as const)
      await ws.create("stock_movement", {
        product_id: p.id,
        date: "2026-01-01",
        kind: "in",
        quantity: q,
        unit_cost: 1000,
        lot_id: lot.id,
      });

    const sale = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "invoice", date: "2026-06-10", party_id: customer.id },
        lines: [
          { product_id: p.id, description: "Vite", quantity: 6, unit_price: 5000, vat_rate: 22 },
        ],
      }),
    );
    await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, sale.id, "2026-06-10"));
    const levels = Object.fromEntries((await lotLevels(ws.db)).map((l) => [l.code, l.onHand]));
    expect(levels).toEqual({ TARDI: 8, SENZA: 10 }); // PRESTO emptied first, then 2 from TARDI

    const buy = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: {
          type: "purchase_invoice",
          number: "A-9",
          date: "2026-06-12",
          party_id: supplier.id,
        },
        lines: [
          { product_id: p.id, description: "Vite", quantity: 5, unit_price: 1200, vat_rate: 22 },
        ],
      }),
    );
    await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, buy.id, "2026-06-12"));
    expect((await lotLevels(ws.db)).find((l) => l.code === "A-9")?.onHand).toBe(5);

    // a sale the lots cannot cover is refused as a whole
    const big = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "invoice", date: "2026-06-14", party_id: customer.id },
        lines: [
          { product_id: p.id, description: "Vite", quantity: 100, unit_price: 5000, vat_rate: 22 },
        ],
      }),
    );
    await expect(
      ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, big.id, "2026-06-14")),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("warns about lots that expire soon or already expired, only while stock remains", async () => {
    const ws = await testWorkspace("ordinario", clock);
    const p = await goods(ws, { track_lots: true });
    const soon = await ws.create("stock_lot", {
      product_id: p.id,
      code: "S",
      expiry_date: "2026-06-30",
    });
    const past = await ws.create("stock_lot", {
      product_id: p.id,
      code: "P",
      expiry_date: "2026-05-01",
    });
    const far = await ws.create("stock_lot", {
      product_id: p.id,
      code: "F",
      expiry_date: "2027-01-01",
    });
    const empty = await ws.create("stock_lot", {
      product_id: p.id,
      code: "E",
      expiry_date: "2026-06-20",
    });
    for (const lot of [soon, past, far, empty])
      await ws.create("stock_movement", {
        product_id: p.id,
        date: "2026-01-01",
        kind: "in",
        quantity: 3,
        unit_cost: 1000,
        lot_id: lot.id,
      });
    await ws.create("stock_movement", {
      product_id: p.id,
      date: "2026-01-02",
      kind: "out",
      quantity: -3,
      lot_id: empty.id,
    });

    const found = await expiringLots(ws.db, "2026-06-15", 30);
    expect(found.map((l) => [l.code, l.expired])).toEqual([
      ["P", true],
      ["S", false],
    ]);
    const alerts = await notifications(ws.db, "2026-06-15", "2026-06-15T10:00:00Z");
    const lotAlerts = alerts.filter((a) => a.entity === "stock_lot");
    expect(lotAlerts.map((a) => [a.severity, a.title])).toEqual(
      expect.arrayContaining([
        ["danger", "Lotto scaduto: Vite P"],
        ["warning", "Lotto in scadenza: Vite S"],
      ]),
    );
    expect(lotAlerts).toHaveLength(2);
  });
});
