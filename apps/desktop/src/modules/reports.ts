import type { SqlRunner } from "../data/db";
import { daysBetween } from "../lib/dates";
import { percentOf } from "../lib/money";
import { productCosts, valueOf } from "./stock";

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

/** Totals per account over a period; `balance` is debit minus credit. */
/**
 * Totals per account for a period. The year-end closing entries (which zero the income and
 * expense accounts into the result) are left out unless `includeClosing` is set, so the profit
 * and loss of a closed year still shows its real figures.
 */
export async function trialBalance(
  db: SqlRunner,
  from: string,
  to: string,
  options: { includeClosing?: boolean } = {},
): Promise<TrialBalanceRow[]> {
  const rows = await db.query<{
    code: string;
    name: string;
    type: string;
    debit: number;
    credit: number;
  }>(
    `SELECT a.code, a.name, a.type,
            COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
     FROM accounts a
     LEFT JOIN (SELECT jl.account_id, jl.debit, jl.credit
                FROM journal_lines jl JOIN journal_entries e ON e.id = jl.entry_id
                WHERE e.date >= ? AND e.date <= ?
                  ${options.includeClosing ? "" : "AND (e.source_id IS NULL OR e.source_id NOT LIKE 'closing:%')"}) l ON l.account_id = a.id
     WHERE a.deleted_at IS NULL
     GROUP BY a.id ORDER BY a.code`,
    [from, to],
  );
  return rows.map((r) => ({
    ...r,
    debit: Number(r.debit),
    credit: Number(r.credit),
    balance: Number(r.debit) - Number(r.credit),
  }));
}

export interface ProfitAndLoss {
  revenue: number;
  expenses: number;
  result: number;
}

export async function profitAndLoss(
  db: SqlRunner,
  from: string,
  to: string,
): Promise<ProfitAndLoss> {
  const rows = await trialBalance(db, from, to);
  const revenue = rows.filter((r) => r.type === "revenue").reduce((s, r) => s - r.balance, 0);
  const expenses = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.balance, 0);
  return { revenue, expenses, result: revenue - expenses };
}

export interface VatSummary {
  salesBase: number;
  salesVat: number;
  purchaseBase: number;
  purchaseVat: number;
  /** Positive: VAT to pay; negative: VAT credit. */
  balance: number;
  rows: { direction: "sales" | "purchases"; rate: number; base: number; vat: number }[];
}

/**
 * VAT on issued documents of the period, per rate. Credit notes subtract. This is a
 * working summary for the periodic settlement, not the filed return.
 */
export async function vatSummary(db: SqlRunner, from: string, to: string): Promise<VatSummary> {
  const lines = await db.query<{ type: string; rate: number; base: number }>(
    `SELECT d.type AS type, l.vat_rate AS rate, SUM(l.net_amount) AS base
     FROM document_lines l JOIN documents d ON d.id = l.document_id
     WHERE d.status = 'issued' AND d.deleted_at IS NULL AND l.deleted_at IS NULL
       AND d.date >= ? AND d.date <= ? AND d.type IN ('invoice', 'credit_note', 'purchase_invoice')
     GROUP BY d.type, l.vat_rate`,
    [from, to],
  );
  const bucket = new Map<
    string,
    { direction: "sales" | "purchases"; rate: number; base: number }
  >();
  for (const line of lines) {
    const direction = line.type === "purchase_invoice" ? "purchases" : "sales";
    const sign = line.type === "credit_note" ? -1 : 1;
    const key = `${direction}|${line.rate}`;
    const entry = bucket.get(key) ?? { direction, rate: Number(line.rate), base: 0 };
    entry.base += sign * Number(line.base);
    bucket.set(key, entry);
  }
  const rows = [...bucket.values()]
    .map((r) => ({ ...r, vat: percentOf(r.base, r.rate) }))
    .sort((a, b) => a.direction.localeCompare(b.direction) || b.rate - a.rate);
  const sum = (direction: string, field: "base" | "vat") =>
    rows.filter((r) => r.direction === direction).reduce((s, r) => s + r[field], 0);
  const salesVat = sum("sales", "vat");
  const purchaseVat = sum("purchases", "vat");
  return {
    salesBase: sum("sales", "base"),
    salesVat,
    purchaseBase: sum("purchases", "base"),
    purchaseVat,
    balance: salesVat - purchaseVat,
    rows,
  };
}

export interface AgingRow {
  documentId: string;
  number: string;
  party: string;
  dueDate: string;
  total: number;
  outstanding: number;
  daysOverdue: number;
  bucket: "not_due" | "1-30" | "31-60" | "61-90" | "90+";
}

export function bucketOf(daysOverdue: number): AgingRow["bucket"] {
  if (daysOverdue <= 0) return "not_due";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

/** The deadline schedule: what customers owe (`receivable`) or what is owed to suppliers. */
export async function aging(
  db: SqlRunner,
  asOf: string,
  direction: "receivable" | "payable",
): Promise<AgingRow[]> {
  const rows = await db.query<{
    id: string;
    type: string;
    number: string;
    party: string;
    due_date: string | null;
    date: string;
    total: number;
    paid: number;
  }>(
    `SELECT d.id, d.type, d.number, p.name AS party, d.due_date, d.date, d.total,
            COALESCE((SELECT SUM(amount) FROM payments x WHERE x.document_id = d.id AND x.deleted_at IS NULL), 0) AS paid
     FROM documents d JOIN parties p ON p.id = d.party_id
     WHERE d.status = 'issued' AND d.deleted_at IS NULL AND d.type IN (${direction === "receivable" ? "'invoice', 'credit_note'" : "'purchase_invoice'"})`,
  );
  return rows
    .map((r) => {
      const due = r.due_date ?? r.date;
      const days = daysBetween(due, asOf);
      // A credit note is money owed back to the customer, so it reduces what they owe.
      return {
        documentId: r.id,
        number: r.number,
        party: r.party,
        dueDate: due,
        total: (r.type === "credit_note" ? -1 : 1) * Number(r.total),
        outstanding: (r.type === "credit_note" ? -1 : 1) * (Number(r.total) - Number(r.paid)),
        daysOverdue: days,
        bucket: bucketOf(days),
      };
    })
    .filter((r) => r.outstanding !== 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  onHand: number;
  minStock: number;
  value: number;
  low: boolean;
}

export async function stockLevels(db: SqlRunner): Promise<StockRow[]> {
  const products = (await db.query(
    `SELECT id, sku, name, min_stock FROM products WHERE track_stock = 1 AND deleted_at IS NULL ORDER BY name`,
  )) as unknown as { id: string; sku: string; name: string; min_stock: number | null }[];
  // Valued at the weighted average cost of the purchases (the purchase price until there are any).
  const costs = await productCosts(db);
  return products.map((p) => {
    const cost = costs.get(p.id) ?? { onHand: 0, average: 0 };
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      onHand: cost.onHand,
      minStock: Number(p.min_stock ?? 0),
      value: valueOf(cost),
      low: cost.onHand <= Number(p.min_stock ?? 0),
    };
  });
}

export interface ProjectRow {
  projectId: string;
  name: string;
  minutes: number;
  billableMinutes: number;
  billable: number;
  cost: number;
  budget: number;
}

/** Hours, billable value (rate × billable hours) and labour cost per project. */
export async function projectSummary(db: SqlRunner): Promise<ProjectRow[]> {
  const rows = await db.query<{
    id: string;
    name: string;
    budget: number;
    hourly_rate: number;
    minutes: number;
    billable_minutes: number;
    cost: number;
  }>(
    `SELECT p.id, p.name, p.budget, p.hourly_rate,
            COALESCE(SUM(t.minutes), 0) AS minutes,
            COALESCE(SUM(CASE WHEN t.billable = 1 THEN t.minutes ELSE 0 END), 0) AS billable_minutes,
            COALESCE(SUM(t.minutes * e.hourly_cost / 60.0), 0) AS cost
     FROM projects p
     LEFT JOIN time_entries t ON t.project_id = p.id AND t.deleted_at IS NULL
     LEFT JOIN employees e ON e.id = t.employee_id
     WHERE p.deleted_at IS NULL GROUP BY p.id ORDER BY p.name`,
  );
  return rows.map((r) => ({
    projectId: r.id,
    name: r.name,
    minutes: Number(r.minutes),
    billableMinutes: Number(r.billable_minutes),
    billable: Math.round((Number(r.billable_minutes) * Number(r.hourly_rate)) / 60),
    cost: Math.round(Number(r.cost)),
    budget: Number(r.budget ?? 0),
  }));
}

// --- CSV ------------------------------------------------------------------------------

/**
 * Semicolon-separated, UTF-8 with BOM: what Italian versions of Excel open correctly.
 * Text starting with = + - @ would be run as a formula by a spreadsheet, so it is
 * prefixed with an apostrophe (numbers are written as numbers and are not affected).
 */
export function toCsv(
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
): string {
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return String(value).replace(".", ",");
    let text = typeof value === "boolean" ? (value ? "sì" : "no") : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((c) => cell(c.label)).join(";")];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.key])).join(";"));
  return `${String.fromCharCode(0xfeff)}${lines.join("\r\n")}\r\n`;
}
