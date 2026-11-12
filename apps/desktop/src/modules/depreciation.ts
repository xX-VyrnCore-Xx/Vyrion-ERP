/**
 * Depreciation of fixed assets (ammortamento), straight line.
 *
 * Each year the annual rate is applied to the depreciable amount (cost minus residual value);
 * in the first year only half of it, as is customary. Depreciation never exceeds what is left,
 * so the last year takes the remainder, and stops from the year the asset is disposed of.
 */

import type { Rec } from "../data/entity";
import type { Workspace } from "../data/workspace";
import { ACC, ensureAccount, postEntry } from "./accounting";

export interface AssetTerms {
  cost: number;
  rate: number;
  residual: number;
  purchaseDate: string;
  disposedOn: string | null;
}

export interface ScheduleRow {
  year: number;
  amount: number;
  accumulated: number;
  /** Book value at the end of the year. */
  bookValue: number;
}

export const termsOf = (asset: Rec): AssetTerms => ({
  cost: Number(asset["cost"]),
  rate: Number(asset["rate"]),
  residual: Number(asset["residual"] ?? 0),
  purchaseDate: String(asset["purchase_date"]),
  disposedOn: (asset["disposed_on"] as string | null) ?? null,
});

/** Year by year, from the purchase year to `untilYear`. */
export function depreciationSchedule(terms: AssetTerms, untilYear: number): ScheduleRow[] {
  const first = Number(terms.purchaseDate.slice(0, 4));
  const stop = terms.disposedOn ? Number(terms.disposedOn.slice(0, 4)) - 1 : untilYear;
  const base = terms.cost - terms.residual;
  const rows: ScheduleRow[] = [];
  let accumulated = 0;
  for (let year = first; year <= Math.min(untilYear, stop); year++) {
    const full = (base * terms.rate) / 100;
    const wanted = Math.round(year === first ? full / 2 : full);
    const amount = Math.max(0, Math.min(wanted, base - accumulated));
    if (amount === 0 && accumulated >= base) break; // fully written off
    accumulated += amount;
    rows.push({ year, amount, accumulated, bookValue: terms.cost - accumulated });
  }
  return rows;
}

const entryDescription = (year: number, name: string): string => `Ammortamento ${year}: ${name}`;

export interface DepreciationPosted {
  assetId: string;
  name: string;
  amount: number;
}

/**
 * Posts the depreciation of `year` for every asset that has some, once: running it again posts
 * nothing for assets already done. The year must not be closed.
 */
export async function postDepreciation(ws: Workspace, year: number): Promise<DepreciationPosted[]> {
  return ws.transact(async (tx, ctx, repo) => {
    const assets = (await tx.query(
      "SELECT * FROM fixed_assets WHERE deleted_at IS NULL ORDER BY purchase_date",
    )) as unknown as Rec[];
    const posted: DepreciationPosted[] = [];
    let accountsReady = false;
    for (const asset of assets) {
      const row = depreciationSchedule(termsOf(asset), year).find((r) => r.year === year);
      if (!row || row.amount <= 0) continue;
      const description = entryDescription(year, String(asset["name"]));
      const [done] = await tx.query<{ id: string }>(
        `SELECT e.id FROM journal_entries e
         WHERE e.source_id = ? AND e.description = ? AND e.source <> 'reversal'
           AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_id = e.id)`,
        [asset.id, description],
      );
      if (done) continue;
      if (!accountsReady) {
        await ensureAccount(tx, ctx, repo, ACC.depreciation);
        await ensureAccount(tx, ctx, repo, ACC.accumulatedDepreciation);
        accountsReady = true;
      }
      await postEntry(tx, ctx, repo, {
        date: `${year}-12-31`,
        description,
        sourceId: asset.id,
        lines: [
          { account: ACC.depreciation, debit: row.amount },
          { account: ACC.accumulatedDepreciation, credit: row.amount },
        ],
      });
      posted.push({ assetId: asset.id, name: String(asset["name"]), amount: row.amount });
    }
    return posted;
  });
}

/** Total depreciation of `year` that is still to be posted (for the preview before posting). */
export async function pendingDepreciation(
  ws: Workspace,
  year: number,
): Promise<{ assetId: string; name: string; amount: number; posted: boolean }[]> {
  const assets = (await ws.db.query(
    "SELECT * FROM fixed_assets WHERE deleted_at IS NULL ORDER BY purchase_date",
  )) as unknown as Rec[];
  const out = [];
  for (const asset of assets) {
    const row = depreciationSchedule(termsOf(asset), year).find((r) => r.year === year);
    if (!row || row.amount <= 0) continue;
    const [done] = await ws.db.query<{ id: string }>(
      `SELECT e.id FROM journal_entries e
       WHERE e.source_id = ? AND e.description = ? AND e.source <> 'reversal'
         AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_id = e.id)`,
      [asset.id, entryDescription(year, String(asset["name"]))],
    );
    out.push({
      assetId: asset.id,
      name: String(asset["name"]),
      amount: row.amount,
      posted: Boolean(done),
    });
  }
  return out;
}
