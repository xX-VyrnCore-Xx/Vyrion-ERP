/**
 * Closing a financial year, and the balance sheet.
 *
 * Closing moves the result of the year (revenues minus costs) into the result account and
 * locks the year: no entry can be dated inside it any more. The closing entry is marked
 * (`source_id = "closing:<year>"`) so the profit and loss report of that year still shows its
 * real figures. The last closed year can be reopened, which reverses the closing entry.
 */

import type { SqlRunner } from "../data/db";
import { ConflictError, ValidationError } from "../data/errors";
import { getSetting, setSetting } from "../data/system";
import type { Workspace } from "../data/workspace";
import { ACC, CLOSED_THROUGH, ensureAccount, postEntry, withPeriodLockLifted } from "./accounting";
import { trialBalance } from "./reports";

const CLOSINGS = "accounting.closings";

export interface ClosingRecord {
  year: number;
  entryId: string | null;
  /** Cents; positive is a profit. */
  result: number;
  closedAt: string;
}

export interface PeriodStatus {
  closedThrough: string | null;
  closings: ClosingRecord[];
}

export async function periodStatus(db: SqlRunner): Promise<PeriodStatus> {
  return {
    closedThrough: (await getSetting<string>(db, CLOSED_THROUGH)) ?? null,
    closings: (await getSetting<ClosingRecord[]>(db, CLOSINGS)) ?? [],
  };
}

const yearEnd = (year: number): string => `${year}-12-31`;

/** The profit or loss of a year, without the closing entries. */
export async function yearResult(db: SqlRunner, year: number): Promise<number> {
  const rows = await trialBalance(db, `${year}-01-01`, yearEnd(year));
  const revenue = rows.filter((r) => r.type === "revenue").reduce((s, r) => s - r.balance, 0);
  const costs = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.balance, 0);
  return revenue - costs;
}

export async function closeYear(ws: Workspace, year: number): Promise<ClosingRecord> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new ValidationError({ year: "Anno non valido" });
  return ws.transact(async (tx, ctx, repo) => {
    const status = await periodStatus(tx);
    const last = status.closings[status.closings.length - 1];
    if (ctx.today() <= yearEnd(year))
      throw new ConflictError(`L'esercizio ${year} non è ancora terminato`);
    if (last && year !== last.year + 1)
      throw new ConflictError(
        year <= last.year
          ? `L'esercizio ${year} è già chiuso`
          : `Chiudi prima l'esercizio ${last.year + 1}`,
      );
    if (!last) {
      const [first] = await tx.query<{ y: string | null }>(
        "SELECT MIN(substr(date, 1, 4)) AS y FROM journal_entries",
      );
      if (first?.y && Number(first.y) < year)
        throw new ConflictError(`Chiudi prima l'esercizio ${first.y}`);
    }

    const rows = (await trialBalance(tx, `${year}-01-01`, yearEnd(year))).filter(
      (r) => (r.type === "revenue" || r.type === "expense") && r.balance !== 0,
    );
    const result = rows.reduce((sum, r) => sum - r.balance, 0);
    let entryId: string | null = null;
    if (rows.length > 0) {
      await ensureAccount(tx, ctx, repo, ACC.result);
      const lines = rows.map((r) => ({
        account: r.code,
        // revenue accounts have a credit balance (negative): close them with a debit
        ...(r.balance < 0 ? { debit: -r.balance } : { credit: r.balance }),
        memo: "Chiusura",
      }));
      lines.push({
        account: ACC.result,
        ...(result >= 0 ? { credit: result } : { debit: -result }),
        memo: result >= 0 ? "Utile dell'esercizio" : "Perdita dell'esercizio",
      } as (typeof lines)[number]);
      const entry = await withPeriodLockLifted(() =>
        postEntry(tx, ctx, repo, {
          date: yearEnd(year),
          description: `Chiusura esercizio ${year}`,
          sourceId: `closing:${year}`,
          lines,
        }),
      );
      entryId = entry.id;
    }
    const record: ClosingRecord = { year, entryId, result, closedAt: ctx.now() };
    await setSetting(tx, CLOSED_THROUGH, yearEnd(year), ctx.now());
    await setSetting(tx, CLOSINGS, [...status.closings, record], ctx.now());
    return record;
  });
}

/** Reopens the most recently closed year: its closing entry is reversed and the lock moves back. */
export async function reopenYear(ws: Workspace, year: number): Promise<void> {
  await ws.transact(async (tx, ctx, repo) => {
    const status = await periodStatus(tx);
    const last = status.closings[status.closings.length - 1];
    if (!last || last.year !== year)
      throw new ConflictError(
        last
          ? `Si può riaprire solo l'ultimo esercizio chiuso (${last.year})`
          : "Nessun esercizio chiuso",
      );
    if (last.entryId) {
      const lines = await tx.query<{ account_id: string; debit: number; credit: number }>(
        "SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = ?",
        [last.entryId],
      );
      await withPeriodLockLifted(() =>
        postEntry(tx, ctx, repo, {
          date: yearEnd(year),
          description: `Riapertura esercizio ${year}`,
          source: "reversal",
          sourceId: `closing:${year}:reopen`,
          reversesId: last.entryId,
          lines: lines.map((l) => ({ account: l.account_id, debit: l.credit, credit: l.debit })),
        }),
      );
    }
    const remaining = status.closings.slice(0, -1);
    const previous = remaining[remaining.length - 1];
    await setSetting(tx, CLOSED_THROUGH, previous ? yearEnd(previous.year) : null, ctx.now());
    await setSetting(tx, CLOSINGS, remaining, ctx.now());
  });
}

export interface BalanceSheet {
  asOf: string;
  assets: number;
  liabilities: number;
  equity: number;
  /** Result of the years not closed yet (revenues minus costs). */
  openResult: number;
  /** assets − (liabilities + equity + openResult): zero when the books balance. */
  difference: number;
  rows: { code: string; name: string; type: string; amount: number }[];
}

/**
 * A management balance sheet from the ledger: assets against liabilities, equity and the result
 * not yet closed. It is **not** the statutory (civilistico) balance sheet format.
 */
export async function balanceSheet(db: SqlRunner, asOf: string): Promise<BalanceSheet> {
  const rows = await trialBalance(db, "0000-01-01", asOf, { includeClosing: true });
  const sum = (type: string, sign: 1 | -1) =>
    rows.filter((r) => r.type === type).reduce((s, r) => s + sign * r.balance, 0);
  const assets = sum("asset", 1);
  const liabilities = sum("liability", -1);
  const equity = sum("equity", -1);
  const openResult = 0 - (sum("revenue", 1) + sum("expense", 1)); // `0 -` avoids a negative zero
  return {
    asOf,
    assets,
    liabilities,
    equity,
    openResult,
    difference: assets - (liabilities + equity + openResult),
    rows: rows
      .filter((r) => r.balance !== 0 && r.type !== "revenue" && r.type !== "expense")
      .map((r) => ({
        code: r.code,
        name: r.name,
        type: r.type,
        amount: r.type === "asset" ? r.balance : -r.balance,
      })),
  };
}
