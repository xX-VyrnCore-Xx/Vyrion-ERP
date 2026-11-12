/**
 * Stock beyond a single total: per warehouse, per lot, valued at the weighted average cost,
 * with transfers between warehouses and first-expired-first-out picking of lots.
 */

import type { SqlRunner } from "../data/db";
import type { Ctx, Rec } from "../data/entity";
import { ConflictError, ValidationError } from "../data/errors";
import type { Workspace } from "../data/workspace";
import { addDays } from "../lib/dates";

type RepoOf = (key: string) => import("../data/repository").EntityRepository;

export interface CostMovement {
  quantity: number;
  /** Cents per unit; 0 or missing means "at the current average". */
  unit_cost: number;
}

export interface CostState {
  onHand: number;
  /** Average cost in cents per unit (fractional: rounding happens when valuing). */
  average: number;
}

/**
 * Weighted average cost over movements already in date order. A purchase with a price moves
 * the average; a sale or adjustment out leaves it unchanged; a receipt without a price (a
 * return, an inventory gain) comes in at the current average.
 */
export function weightedAverage(movements: CostMovement[], fallbackCost = 0): CostState {
  let onHand = 0;
  let average = fallbackCost;
  for (const m of movements) {
    if (m.quantity > 0) {
      const cost = m.unit_cost > 0 ? m.unit_cost : onHand > 0 ? average : fallbackCost;
      average = onHand <= 0 ? cost : (onHand * average + m.quantity * cost) / (onHand + m.quantity);
    }
    onHand = Math.round((onHand + m.quantity) * 1000) / 1000;
  }
  return { onHand, average };
}

export const valueOf = (state: CostState): number =>
  state.onHand > 0 ? Math.round(state.onHand * state.average) : 0;

interface MovementRow {
  product_id: string;
  quantity: number;
  unit_cost: number;
  warehouse_id: string | null;
  lot_id: string | null;
}

/** Every live movement, oldest first (the order the average needs). */
async function movementRows(db: SqlRunner, productId?: string): Promise<MovementRow[]> {
  return (await db.query(
    `SELECT product_id, quantity, unit_cost, warehouse_id, lot_id FROM stock_movements
     WHERE deleted_at IS NULL ${productId ? "AND product_id = ?" : ""}
     ORDER BY date, created_at, rowid`,
    productId ? [productId] : [],
  )) as unknown as MovementRow[];
}

/** Cost state of each stock-tracked product (the average is per product, across warehouses). */
export async function productCosts(
  db: SqlRunner,
  productId?: string,
): Promise<Map<string, CostState>> {
  const products = (await db.query(
    `SELECT id, purchase_price FROM products WHERE track_stock = 1 AND deleted_at IS NULL ${productId ? "AND id = ?" : ""}`,
    productId ? [productId] : [],
  )) as unknown as { id: string; purchase_price: number }[];
  const fallback = new Map(products.map((p) => [p.id, Number(p.purchase_price ?? 0)]));
  const grouped = new Map<string, CostMovement[]>();
  for (const row of await movementRows(db, productId)) {
    if (!fallback.has(row.product_id)) continue;
    const list = grouped.get(row.product_id) ?? [];
    list.push({ quantity: Number(row.quantity), unit_cost: Number(row.unit_cost ?? 0) });
    grouped.set(row.product_id, list);
  }
  const out = new Map<string, CostState>();
  for (const [id, cost] of fallback) out.set(id, weightedAverage(grouped.get(id) ?? [], cost));
  return out;
}

export interface WarehouseStock {
  productId: string;
  warehouseId: string | null;
  warehouse: string;
  onHand: number;
  value: number;
}

export const MAIN_WAREHOUSE = "Magazzino principale";

/** Quantity and value of each product in each warehouse (movements without one are the main one). */
export async function stockByWarehouse(db: SqlRunner): Promise<WarehouseStock[]> {
  const names = new Map(
    (
      (await db.query("SELECT id, name FROM warehouses WHERE deleted_at IS NULL")) as unknown as {
        id: string;
        name: string;
      }[]
    ).map((w) => [w.id, w.name]),
  );
  const costs = await productCosts(db);
  const totals = new Map<string, WarehouseStock>();
  for (const row of await movementRows(db)) {
    const cost = costs.get(row.product_id);
    if (!cost) continue;
    const key = `${row.product_id}|${row.warehouse_id ?? ""}`;
    const entry = totals.get(key) ?? {
      productId: row.product_id,
      warehouseId: row.warehouse_id,
      warehouse: row.warehouse_id ? (names.get(row.warehouse_id) ?? "(eliminato)") : MAIN_WAREHOUSE,
      onHand: 0,
      value: 0,
    };
    entry.onHand = Math.round((entry.onHand + Number(row.quantity)) * 1000) / 1000;
    totals.set(key, entry);
  }
  for (const entry of totals.values()) {
    const cost = costs.get(entry.productId);
    entry.value = entry.onHand > 0 && cost ? Math.round(entry.onHand * cost.average) : 0;
  }
  return [...totals.values()].filter((e) => e.onHand !== 0);
}

export interface LotStock {
  lotId: string;
  productId: string;
  code: string;
  expiryDate: string | null;
  onHand: number;
}

/** Lots with stock on hand (all warehouses together), soonest expiry first. */
export async function lotLevels(db: SqlRunner): Promise<LotStock[]> {
  const rows = (await db.query(
    `SELECT l.id, l.product_id, l.code, l.expiry_date,
            ROUND(COALESCE(SUM(m.quantity), 0), 3) AS q
     FROM stock_lots l
     LEFT JOIN stock_movements m ON m.lot_id = l.id AND m.deleted_at IS NULL
     WHERE l.deleted_at IS NULL
     GROUP BY l.id
     HAVING q <> 0
     ORDER BY l.expiry_date IS NULL, l.expiry_date, l.code`,
  )) as unknown as {
    id: string;
    product_id: string;
    code: string;
    expiry_date: string | null;
    q: number;
  }[];
  return rows.map((r) => ({
    lotId: r.id,
    productId: r.product_id,
    code: r.code,
    expiryDate: r.expiry_date,
    onHand: Number(r.q),
  }));
}

/** Lots with stock that expire within `days` days (or already expired). */
export async function expiringLots(
  db: SqlRunner,
  today: string,
  days = 30,
): Promise<(LotStock & { expired: boolean })[]> {
  const limit = addDays(today, days);
  return (await lotLevels(db))
    .filter((l) => l.onHand > 0 && l.expiryDate !== null && l.expiryDate <= limit)
    .map((l) => ({ ...l, expired: (l.expiryDate as string) < today }));
}

/**
 * Picks lots first-expired-first-out for a sale, returning how much to take from each.
 * Lots without an expiry come last. Refuses when the lots together cannot cover the quantity.
 */
export async function allocateFefo(
  tx: SqlRunner,
  productId: string,
  quantity: number,
): Promise<{ lotId: string; quantity: number }[]> {
  const lots = (await lotLevels(tx)).filter((l) => l.productId === productId && l.onHand > 0);
  const picks: { lotId: string; quantity: number }[] = [];
  let left = quantity;
  for (const lot of lots) {
    if (left <= 1e-9) break;
    const take = Math.min(lot.onHand, left);
    picks.push({ lotId: lot.lotId, quantity: Math.round(take * 1000) / 1000 });
    left = Math.round((left - take) * 1000) / 1000;
  }
  if (left > 1e-9) {
    const [item] = (await tx.query("SELECT name FROM products WHERE id = ?", [
      productId,
    ])) as unknown as { name: string }[];
    throw new ConflictError(
      `Giacenza insufficiente per ${item?.name ?? "il prodotto"}: mancano ${left} nei lotti disponibili`,
    );
  }
  return picks;
}

/** Finds or creates the lot named after a purchase document, for goods bought without a lot code. */
export async function lotForDocument(
  tx: SqlRunner,
  ctx: Ctx,
  repo: RepoOf,
  productId: string,
  code: string,
): Promise<string> {
  const [existing] = (await tx.query(
    "SELECT id FROM stock_lots WHERE product_id = ? AND code = ? AND deleted_at IS NULL",
    [productId, code],
  )) as unknown as { id: string }[];
  if (existing) return existing.id;
  const lot = await repo("stock_lot").create(tx, ctx, { product_id: productId, code });
  return lot.id;
}

export interface TransferInput {
  productId: string;
  /** null = main warehouse */
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  quantity: number;
  lotId?: string | null;
  date?: string;
  reason?: string;
}

/**
 * Moves goods between warehouses: an out and an in movement in one transaction, the in leg at
 * the current average cost so the product's average (and the stock value) does not change.
 */
export async function transferStock(ws: Workspace, input: TransferInput): Promise<void> {
  if ((input.fromWarehouseId ?? "") === (input.toWarehouseId ?? ""))
    throw new ValidationError({ to: "Scegli due magazzini diversi" });
  if (!(input.quantity > 0))
    throw new ValidationError({ quantity: "La quantità deve essere maggiore di zero" });
  await ws.transact(async (tx, ctx, repo) => {
    const cost = (await productCosts(tx, input.productId)).get(input.productId);
    const unitCost = Math.round(cost?.average ?? 0);
    const date = input.date ?? ctx.today();
    const reason = input.reason ?? "Trasferimento tra magazzini";
    const base = {
      product_id: input.productId,
      date,
      reason,
      lot_id: input.lotId ?? null,
    };
    await repo("stock_movement").create(tx, ctx, {
      ...base,
      kind: "out",
      quantity: -input.quantity,
      warehouse_id: input.fromWarehouseId,
      unit_cost: 0,
    });
    await repo("stock_movement").create(tx, ctx, {
      ...base,
      kind: "in",
      quantity: input.quantity,
      warehouse_id: input.toWarehouseId,
      unit_cost: unitCost,
    });
  });
}

export type { Rec };
