/**
 * VAT registers (registri IVA) and the periodic VAT settlement (liquidazione periodica).
 *
 * The registers list every issued document by date with its taxable amount and VAT per rate;
 * purchases get a progressive protocol number per year. The settlement adds up the sales VAT,
 * subtracts the purchases VAT and the credit of the previous period, carries a small debit
 * forward, adds the 1% quarterly interest where it applies, and can be registered in the books.
 *
 * It is a working tool: it does not file anything, and the rules below are the general ones —
 * have the accountant confirm them for the specific case before relying on the figures.
 */

import type { SqlRunner } from "../data/db";
import type { Rec } from "../data/entity";
import { ConflictError, ValidationError } from "../data/errors";
import type { Workspace } from "../data/workspace";
import { ACC, ensureAccount, postEntry } from "./accounting";
import { computeTotals, extrasFromRecord } from "./documents";

export type Register = "sales" | "purchases";
export type Periodicity = "monthly" | "quarterly";

/** A debit below this amount is not paid: it is added to the next period's (€25,82). */
export const CARRY_THRESHOLD = 2582;
/** Quarterly settlements carry 1% interest (quarters 1–3). */
export const QUARTERLY_INTEREST = 1;

export interface RegisterLine {
  documentId: string;
  /** Progressive number of the purchases register in the year (null for sales). */
  protocol: number | null;
  date: string;
  number: string;
  party: string;
  vatNumber: string | null;
  type: string;
  rate: number;
  nature: string | null;
  /** Taxable amount (signed: credit notes are negative). */
  base: number;
  vat: number;
  /** True for sales under split payment: the VAT is shown but is not owed by us. */
  split: boolean;
}

export interface RegisterTotals {
  base: number;
  vat: number;
  /** Totals per rate. */
  byRate: { rate: number; nature: string | null; base: number; vat: number }[];
}

export interface RegisterData {
  lines: RegisterLine[];
  totals: RegisterTotals;
  /** VAT of split-payment sales, kept out of `totals.vat`. */
  splitVat: number;
}

async function documentRows(db: SqlRunner, from: string, to: string, kind: Register) {
  return (await db.query(
    `SELECT d.*, p.name AS party_name, p.vat_number AS party_vat FROM documents d
     JOIN parties p ON p.id = d.party_id
     WHERE d.status = 'issued' AND d.deleted_at IS NULL AND d.date >= ? AND d.date <= ?
       AND d.type IN (${kind === "sales" ? "'invoice', 'credit_note'" : "'purchase_invoice'"})
     ORDER BY d.date, d.created_at`,
    [from, to],
  )) as unknown as Rec[];
}

/** The register of sales or purchases between two dates. */
export async function vatRegister(
  db: SqlRunner,
  from: string,
  to: string,
  kind: Register,
): Promise<RegisterData> {
  const docs = await documentRows(db, from, to, kind);
  // Purchases are numbered in order of registration, restarting each year.
  const counters = new Map<string, number>();
  if (kind === "purchases") {
    const first = from.slice(0, 4);
    const before = (await db.query(
      `SELECT COUNT(*) AS n FROM documents d WHERE d.status = 'issued' AND d.deleted_at IS NULL
         AND d.type = 'purchase_invoice' AND d.date >= ? AND d.date < ?`,
      [`${first}-01-01`, from],
    )) as unknown as { n: number }[];
    counters.set(first, Number(before[0]?.n ?? 0));
  }
  const lines: RegisterLine[] = [];
  for (const doc of docs) {
    const rows = (await db.query(
      "SELECT quantity, unit_price, discount, vat_rate, vat_nature FROM document_lines WHERE document_id = ? AND deleted_at IS NULL",
      [doc.id],
    )) as unknown as {
      quantity: number;
      unit_price: number;
      discount: number | null;
      vat_rate: number;
      vat_nature: string | null;
    }[];
    const totals = computeTotals(
      rows.map((l) => ({
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        discount: Number(l.discount ?? 0),
        vat_rate: Number(l.vat_rate),
        vat_nature: l.vat_nature,
      })),
      (doc["tax_regime"] as "forfettario" | "ordinario") ?? "ordinario",
      extrasFromRecord(doc),
    );
    const sign = doc["type"] === "credit_note" ? -1 : 1;
    const year = String(doc["date"]).slice(0, 4);
    let protocol: number | null = null;
    if (kind === "purchases") {
      protocol = (counters.get(year) ?? 0) + 1;
      counters.set(year, protocol);
    }
    const split = kind === "sales" && Boolean(doc["split_payment"]);
    for (const group of totals.breakdown) {
      lines.push({
        documentId: doc.id,
        protocol,
        date: String(doc["date"]),
        number: String(doc["number"]),
        party: String(doc["party_name"]),
        vatNumber: (doc["party_vat"] as string | null) ?? null,
        type: String(doc["type"]),
        rate: group.rate,
        nature: group.nature,
        base: sign * group.base,
        vat: sign * group.vat,
        split,
      });
    }
  }
  const counted = lines.filter((l) => !l.split);
  const byRate = new Map<string, RegisterTotals["byRate"][number]>();
  for (const l of counted) {
    const key = `${l.rate}|${l.nature ?? ""}`;
    const entry = byRate.get(key) ?? { rate: l.rate, nature: l.nature, base: 0, vat: 0 };
    entry.base += l.base;
    entry.vat += l.vat;
    byRate.set(key, entry);
  }
  return {
    lines,
    totals: {
      base: counted.reduce((s, l) => s + l.base, 0),
      vat: counted.reduce((s, l) => s + l.vat, 0),
      byRate: [...byRate.values()].sort((a, b) => b.rate - a.rate),
    },
    splitVat: lines.filter((l) => l.split).reduce((s, l) => s + l.vat, 0),
  };
}

// --- periods -----------------------------------------------------------------------------

export function periodRange(
  year: number,
  kind: Periodicity,
  period: number,
): { from: string; to: string } {
  const months = kind === "monthly" ? 1 : 3;
  const max = kind === "monthly" ? 12 : 4;
  if (!Number.isInteger(period) || period < 1 || period > max)
    throw new ValidationError({ period: "Periodo non valido" });
  const firstMonth = (period - 1) * months + 1;
  const lastMonth = firstMonth + months - 1;
  const last = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  const mm = (m: number) => String(m).padStart(2, "0");
  return {
    from: `${year}-${mm(firstMonth)}-01`,
    to: `${year}-${mm(lastMonth)}-${String(last).padStart(2, "0")}`,
  };
}

export interface Settlement {
  year: number;
  kind: Periodicity;
  period: number;
  from: string;
  to: string;
  salesVat: number;
  purchasesVat: number;
  previousCredit: number;
  previousDebit: number;
  /** Sales VAT − purchases VAT − previous credit + previous debit (positive: to pay). */
  balance: number;
  interest: number;
  /** What to pay for this period. */
  due: number;
  creditForward: number;
  debitForward: number;
  /** Earlier periods of the year (or the last one of the previous year) still to be registered. */
  missingPrevious: boolean;
  registeredId: string | null;
  /** Due date of the payment (16th of the month after the period for monthly, 16 May/Aug/Nov for quarters). */
  payBy: string;
}

function previousPeriod(year: number, kind: Periodicity, period: number) {
  if (period > 1) return { year, period: period - 1 };
  return { year: year - 1, period: kind === "monthly" ? 12 : 4 };
}

/** The payment deadline: the 16th of the following month (quarters: the 16th of May, August, November; the 4th quarter is settled with the annual return). */
function dueDate(year: number, kind: Periodicity, period: number): string {
  if (kind === "monthly") {
    const next = period === 12 ? { y: year + 1, m: 1 } : { y: year, m: period + 1 };
    return `${next.y}-${String(next.m).padStart(2, "0")}-16`;
  }
  if (period === 4) return `${year + 1}-03-16`;
  return `${year}-${String(period * 3 + 2).padStart(2, "0")}-16`;
}

export async function computeSettlement(
  db: SqlRunner,
  year: number,
  kind: Periodicity,
  period: number,
): Promise<Settlement> {
  const { from, to } = periodRange(year, kind, period);
  const sales = await vatRegister(db, from, to, "sales");
  const purchases = await vatRegister(db, from, to, "purchases");
  const prev = previousPeriod(year, kind, period);
  const [before] = (await db.query(
    "SELECT * FROM vat_settlements WHERE year = ? AND period_kind = ? AND period = ? AND deleted_at IS NULL",
    [prev.year, kind, prev.period],
  )) as unknown as Rec[];
  const [mine] = (await db.query(
    "SELECT id FROM vat_settlements WHERE year = ? AND period_kind = ? AND period = ? AND deleted_at IS NULL",
    [year, kind, period],
  )) as unknown as { id: string }[];
  // Without the previous settlement registered there is no credit/debit to carry in: say so.
  const previousCredit = Number(before?.["credit_forward"] ?? 0);
  const previousDebit = Number(before?.["debit_forward"] ?? 0);
  const [anyEarlier] = (await db.query(
    "SELECT COUNT(*) AS n FROM vat_settlements WHERE period_kind = ? AND deleted_at IS NULL AND (year < ? OR (year = ? AND period < ?))",
    [kind, year, year, period],
  )) as unknown as { n: number }[];
  const salesVat = sales.totals.vat;
  const purchasesVat = purchases.totals.vat;
  const balance = salesVat - purchasesVat - previousCredit + previousDebit;
  let interest = 0;
  let due = 0;
  let debitForward = 0;
  let creditForward = 0;
  if (balance < 0) creditForward = -balance;
  else if (balance > 0 && balance < CARRY_THRESHOLD) debitForward = balance;
  else if (balance > 0) {
    interest =
      kind === "quarterly" && period <= 3 ? Math.round((balance * QUARTERLY_INTEREST) / 100) : 0;
    due = balance + interest;
  }
  return {
    year,
    kind,
    period,
    from,
    to,
    salesVat,
    purchasesVat,
    previousCredit,
    previousDebit,
    balance,
    interest,
    due,
    creditForward,
    debitForward,
    missingPrevious: !before && Number(anyEarlier?.n ?? 0) > 0,
    registeredId: mine?.id ?? null,
    payBy: dueDate(year, kind, period),
  };
}

/**
 * Registers the settlement: the figures are stored (so the next period can carry the credit or
 * debit) and the period's VAT is closed in the books — debit VAT and credit VAT are cleared and
 * the difference goes to «Erario c/IVA». Interest is not posted: it belongs to the payment.
 */
export async function registerSettlement(
  ws: Workspace,
  year: number,
  kind: Periodicity,
  period: number,
): Promise<Rec> {
  return ws.transact(async (tx, ctx, repo) => {
    const s = await computeSettlement(tx, year, kind, period);
    if (s.registeredId)
      throw new ConflictError("La liquidazione di questo periodo è già registrata");
    if (s.missingPrevious)
      throw new ConflictError("Registra prima la liquidazione del periodo precedente");
    const record = await repo("vat_settlement").create(tx, ctx, {
      year,
      period_kind: kind,
      period,
      date_from: s.from,
      date_to: s.to,
      sales_vat: s.salesVat,
      purchases_vat: s.purchasesVat,
      previous_credit: s.previousCredit,
      previous_debit: s.previousDebit,
      interest: s.interest,
      due: s.due,
      credit_forward: s.creditForward,
      debit_forward: s.debitForward,
    });
    await ensureAccount(tx, ctx, repo, ACC.vatSettlement);
    const diff = s.salesVat - s.purchasesVat;
    await postEntry(tx, ctx, repo, {
      date: s.to,
      description: `Liquidazione IVA ${kind === "monthly" ? "mese" : "trimestre"} ${period}/${year}`,
      sourceId: record.id,
      lines: [
        { account: ACC.vatDebit, debit: s.salesVat },
        { account: ACC.vatCredit, credit: s.purchasesVat },
        ...(diff >= 0
          ? [{ account: ACC.vatSettlement, credit: diff }]
          : [{ account: ACC.vatSettlement, debit: -diff }]),
      ],
    });
    return record;
  });
}

/**
 * The December advance (acconto IVA, due 27 December) by the historical method: 88% of the
 * payment of the last period of the previous year (December for monthly, the 4th quarter for
 * quarterly taxpayers). Below €103,29 it is not due.
 */
export const ADVANCE_MINIMUM = 10329;
export async function historicalAdvance(
  db: SqlRunner,
  year: number,
  kind: Periodicity,
): Promise<{ base: number; advance: number; due: boolean }> {
  const [last] = (await db.query(
    "SELECT * FROM vat_settlements WHERE year = ? AND period_kind = ? AND period = ? AND deleted_at IS NULL",
    [year - 1, kind, kind === "monthly" ? 12 : 4],
  )) as unknown as Rec[];
  const base = Number(last?.["due"] ?? 0);
  const advance = Math.round(base * 0.88);
  return { base, advance, due: advance >= ADVANCE_MINIMUM };
}
