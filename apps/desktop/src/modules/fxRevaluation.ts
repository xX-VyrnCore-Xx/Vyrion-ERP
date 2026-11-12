/**
 * Year-end adjustment of foreign-currency receivables and payables (adeguamento cambi).
 *
 * At the end of the year the open amounts in a foreign currency are valued again at the
 * exchange rate of 31 December. The difference between that value and what the books carry
 * (the amount at the rate of the document) is booked as an unrealised exchange gain or loss;
 * the entry is reversed on 1 January so that the collection or payment of the following year
 * finds the document at its original rate and books the realised difference as usual.
 *
 * It is a working tool: how unrealised differences are treated for tax (they are generally
 * not taxable or deductible until realised) is for the accountant to confirm.
 */

import type { SqlRunner } from "../data/db";
import type { Rec } from "../data/entity";
import { ConflictError, ValidationError } from "../data/errors";
import type { Workspace } from "../data/workspace";
import { ACC, ensureAccount, postEntry } from "./accounting";

export interface FxItem {
  documentId: string;
  number: string;
  party: string;
  currency: string;
  side: "receivable" | "payable";
  /** Open amount in the currency at 31 December (negative for a credit note). */
  foreignOpen: number;
  /** What the books carry, in euro (at the rate of the document). */
  carrying: number;
  /** The same amount valued at the year-end rate. */
  revalued: number;
  /** Gain (positive) or loss (negative) of the adjustment. */
  difference: number;
}

export interface FxCurrency {
  currency: string;
  rate: number | null;
  items: FxItem[];
  gain: number;
  loss: number;
  /** Change to the receivables and to the payables accounts. */
  receivablesChange: number;
  payablesChange: number;
  /** An adjustment for this currency and year is already registered. */
  registeredId: string | null;
}

/** The foreign-currency documents still open at the end of the year, grouped by currency. */
export async function revaluationPreview(
  db: SqlRunner,
  year: number,
  rates: Record<string, number | undefined> = {},
): Promise<FxCurrency[]> {
  const end = `${year}-12-31`;
  const docs = (await db.query(
    `SELECT d.id, d.type, d.number, d.currency, d.payable, d.total, d.foreign_payable, p.name AS party
     FROM documents d JOIN parties p ON p.id = d.party_id
     WHERE d.status = 'issued' AND d.deleted_at IS NULL AND d.date <= ?
       AND d.currency IS NOT NULL AND d.currency <> 'EUR'
       AND d.type IN ('invoice', 'credit_note', 'purchase_invoice')
     ORDER BY d.currency, d.date, d.number`,
    [end],
  )) as unknown as Record<string, unknown>[];
  const registered = (await db.query(
    "SELECT id, currency FROM fx_revaluations WHERE year = ? AND deleted_at IS NULL",
    [year],
  )) as unknown as { id: string; currency: string }[];

  const byCurrency = new Map<string, FxCurrency>();
  for (const d of docs) {
    const currency = String(d["currency"]).toUpperCase();
    const [paid] = (await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS euro, COALESCE(SUM(foreign_amount), 0) AS foreign_amount
       FROM payments WHERE document_id = ? AND deleted_at IS NULL AND date <= ?`,
      [String(d["id"]), end],
    )) as unknown as { euro: number; foreign_amount: number }[];
    const sign = d["type"] === "credit_note" ? -1 : 1;
    const foreignOpen = Number(d["foreign_payable"] ?? 0) - Number(paid?.foreign_amount ?? 0);
    const carrying = Number(d["payable"] ?? d["total"]) - Number(paid?.euro ?? 0);
    if (foreignOpen === 0 && carrying === 0) continue;
    const entry = byCurrency.get(currency) ?? {
      currency,
      rate: rates[currency] ?? null,
      items: [],
      gain: 0,
      loss: 0,
      receivablesChange: 0,
      payablesChange: 0,
      registeredId: registered.find((r) => r.currency === currency)?.id ?? null,
    };
    byCurrency.set(currency, entry);
    const rate = entry.rate;
    const side = d["type"] === "purchase_invoice" ? "payable" : "receivable";
    const revalued = rate && rate > 0 ? Math.round(foreignOpen / rate) : carrying;
    const change = sign * (revalued - carrying);
    const difference = side === "receivable" ? change : -change;
    entry.items.push({
      documentId: String(d["id"]),
      number: String(d["number"]),
      party: String(d["party"]),
      currency,
      side,
      foreignOpen: sign * foreignOpen,
      carrying: sign * carrying,
      revalued: sign * revalued,
      difference,
    });
    if (side === "receivable") entry.receivablesChange += change;
    else entry.payablesChange += change;
    if (difference > 0) entry.gain += difference;
    else entry.loss += -difference;
  }
  return [...byCurrency.values()];
}

/**
 * Books the adjustment of the currencies that have a rate: one entry on 31 December and its
 * reversal on 1 January, for each currency. Returns the records created.
 */
export async function registerRevaluation(
  ws: Workspace,
  year: number,
  rates: Record<string, number | undefined>,
): Promise<Rec[]> {
  for (const [currency, rate] of Object.entries(rates))
    if (rate !== undefined && !(rate > 0))
      throw new ValidationError({ rate: `Il cambio ${currency} deve essere maggiore di zero` });
  return ws.transact(async (tx, ctx, repo) => {
    const preview = await revaluationPreview(tx, year, rates);
    const todo = preview.filter((c) => c.rate && c.rate > 0);
    if (todo.length === 0) throw new ConflictError("Indica almeno un cambio al 31 dicembre");
    const created: Rec[] = [];
    for (const c of todo) {
      if (c.registeredId)
        throw new ConflictError(`L'adeguamento ${c.currency} ${year} è già registrato`);
      const record = await repo("fx_revaluation").create(tx, ctx, {
        year,
        currency: c.currency,
        rate: c.rate,
        gain: c.gain,
        loss: c.loss,
      });
      created.push(record);
      if (c.receivablesChange === 0 && c.payablesChange === 0 && c.gain === 0 && c.loss === 0)
        continue;
      for (const code of [
        ACC.receivables,
        ACC.payables,
        ACC.fxGainUnrealized,
        ACC.fxLossUnrealized,
      ])
        await ensureAccount(tx, ctx, repo, code);
      const lines = (flip: boolean) => {
        const out = (amount: number) => (flip ? -amount : amount);
        const side = (account: string, amount: number, debitWhenPositive: boolean) => {
          const v = out(debitWhenPositive ? amount : -amount);
          return v >= 0 ? { account, debit: v } : { account, credit: -v };
        };
        return [
          side(ACC.receivables, c.receivablesChange, true),
          side(ACC.payables, c.payablesChange, false),
          // gains are credits, losses debits
          side(ACC.fxGainUnrealized, c.gain, false),
          side(ACC.fxLossUnrealized, c.loss, true),
        ];
      };
      await postEntry(tx, ctx, repo, {
        date: `${year}-12-31`,
        description: `Adeguamento cambi ${c.currency} al 31/12/${year} (cambio ${String(c.rate).replace(".", ",")})`,
        sourceId: record.id,
        lines: lines(false),
      });
      await postEntry(tx, ctx, repo, {
        date: `${year + 1}-01-01`,
        description: `Storno adeguamento cambi ${c.currency} ${year}`,
        sourceId: record.id,
        lines: lines(true),
      });
    }
    return created;
  });
}
