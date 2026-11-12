/**
 * Bank reconciliation: import a bank statement (CSV from the online banking) and match each
 * line with the payments recorded in the app. A match needs the same amount in the same
 * direction and a date close enough; a document number or a name in the description makes it
 * more certain. Nothing is matched without the person confirming, except the unambiguous ones
 * when asked to match automatically.
 */

import { ConflictError, ValidationError } from "../data/errors";
import type { Rec } from "../data/entity";
import type { Workspace } from "../data/workspace";
import { isValidDay } from "../lib/dates";
import { parseMoney } from "../lib/money";
import { normalize } from "../search/text";
import { parseCsv } from "./csv";

export interface StatementLine {
  date: string;
  description: string;
  /** Cents, positive = money in. */
  amount: number;
}

const toDay = (text: string): string | null => {
  const t = text.trim();
  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (it) {
    const year = it[3] as string;
    const iso = `${year.length === 2 ? `20${year}` : year}-${(it[2] as string).padStart(2, "0")}-${(it[1] as string).padStart(2, "0")}`;
    return isValidDay(iso) ? iso : null;
  }
  return isValidDay(t.slice(0, 10)) ? t.slice(0, 10) : null;
};

export interface StatementRead {
  lines: StatementLine[];
  /** Rows that could not be read, with the reason. */
  problems: { line: number; reason: string }[];
}

/**
 * Reads a statement. It finds the date, description and amount columns by their headings
 * (Data, Descrizione/Causale, Importo; or separate Dare/Avere or Uscite/Entrate columns).
 */
export function readStatement(text: string): StatementRead {
  const rows = parseCsv(text);
  const header = (rows.shift() ?? []).map((h) => normalize(h));
  const find = (re: RegExp, skip: number[] = []) =>
    header.findIndex((h, i) => re.test(h) && !skip.includes(i));
  const date = find(/^data( operazione| contabile)?$|^data/);
  const description = find(/descrizione|causale|operazione|dettagli|note/, [date]);
  const amount = find(/^importo|^ammontare/);
  const debit = find(/dare|uscite|addebit|prelievi/);
  const credit = find(/avere|entrate|accredit|versamenti/);
  if (date < 0 || description < 0 || (amount < 0 && (debit < 0 || credit < 0)))
    throw new ValidationError({
      file: "Non trovo le colonne: servono Data, Descrizione (o Causale) e Importo (oppure Dare e Avere)",
    });
  const lines: StatementLine[] = [];
  const problems: StatementRead["problems"] = [];
  rows.forEach((cells, index) => {
    const line = index + 2;
    const day = toDay(cells[date] ?? "");
    if (!day) return void problems.push({ line, reason: `data non valida «${cells[date] ?? ""}»` });
    let cents: number | null;
    if (amount >= 0) cents = parseMoney(cells[amount] ?? "");
    else {
      const out = parseMoney(cells[debit] ?? "") ?? 0;
      const inn = parseMoney(cells[credit] ?? "") ?? 0;
      cents = inn - Math.abs(out);
    }
    if (cents === null || cents === 0)
      return void problems.push({ line, reason: `importo non valido «${cells[amount] ?? ""}»` });
    lines.push({
      date: day,
      description: (cells[description] ?? "").trim() || "(senza descrizione)",
      amount: cents,
    });
  });
  return { lines, problems };
}

export async function importStatement(
  ws: Workspace,
  lines: StatementLine[],
): Promise<{ created: number; duplicates: number }> {
  const seen = new Map<string, number>();
  let created = 0;
  let duplicates = 0;
  for (const line of lines) {
    // Identical lines inside one file are all real: they are told apart by their order.
    const base = `${line.date}|${line.amount}|${normalize(line.description)}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const key = `${base}|${occurrence}`;
    const [exists] = await ws.db.query(
      "SELECT id FROM bank_transactions WHERE import_key = ? AND deleted_at IS NULL",
      [key],
    );
    if (exists) {
      duplicates++;
      continue;
    }
    await ws.create("bank_transaction", {
      date: line.date,
      description: line.description,
      amount: line.amount,
      status: "open",
      import_key: key,
    });
    created++;
  }
  return { created, duplicates };
}

export interface MatchCandidate {
  paymentId: string;
  documentNumber: string | null;
  party: string;
  date: string;
  amount: number;
  /** 0–1; higher is more certain. */
  score: number;
  reason: string;
}

const MAX_DAYS = 15;
const dayDiff = (a: string, b: string): number =>
  Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));

/** Payments that could be this line: same amount and direction, close in time, not yet matched. */
export async function candidatesFor(ws: Workspace, tx: Rec): Promise<MatchCandidate[]> {
  const amount = Number(tx["amount"]);
  const rows = (await ws.db.query(
    `SELECT p.id, p.date, COALESCE(p.received, p.amount) AS amount, d.number, d.type, pa.name AS party
     FROM payments p
     JOIN documents d ON d.id = p.document_id
     JOIN parties pa ON pa.id = d.party_id
     WHERE p.deleted_at IS NULL AND COALESCE(p.received, p.amount) = ?
       AND NOT EXISTS (SELECT 1 FROM bank_transactions b
                       WHERE b.payment_id = p.id AND b.deleted_at IS NULL)`,
    [Math.abs(amount)],
  )) as unknown as {
    id: string;
    date: string;
    amount: number;
    number: string | null;
    type: string;
    party: string;
  }[];
  const text = normalize(String(tx["description"]));
  const out: MatchCandidate[] = [];
  for (const r of rows) {
    // customer invoices are paid to us; purchase invoices and credit notes are paid by us
    const incoming = r.type === "invoice";
    if (incoming !== amount > 0) continue;
    const days = dayDiff(String(tx["date"]), r.date);
    if (days > MAX_DAYS) continue;
    let score = 0.55 - (days / MAX_DAYS) * 0.15;
    const reasons: string[] = [`stesso importo, a ${days} giorni`];
    const number = r.number ? normalize(r.number) : "";
    if (number && text.includes(number)) {
      score += 0.35;
      reasons.push(`cita ${r.number}`);
    }
    const word = normalize(r.party)
      .split(" ")
      .find((w) => w.length >= 4 && text.includes(w));
    if (word) {
      score += 0.1;
      reasons.push(`cita «${word}»`);
    }
    out.push({
      paymentId: r.id,
      documentNumber: r.number,
      party: r.party,
      date: r.date,
      amount: r.amount,
      score: Math.min(1, Math.round(score * 100) / 100),
      reason: reasons.join(", "),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export async function matchTransaction(
  ws: Workspace,
  transactionId: string,
  paymentId: string,
): Promise<void> {
  const tx = await ws.get("bank_transaction", transactionId);
  if (!tx) throw new ConflictError("Movimento non trovato");
  if (tx["status"] === "matched") throw new ConflictError("Il movimento è già abbinato");
  const taken = await ws.db.query(
    "SELECT id FROM bank_transactions WHERE payment_id = ? AND deleted_at IS NULL",
    [paymentId],
  );
  if (taken.length > 0)
    throw new ConflictError("Questo pagamento è già abbinato a un altro movimento");
  const ok = (await candidatesFor(ws, tx)).some((c) => c.paymentId === paymentId);
  if (!ok)
    throw new ConflictError(
      "Il pagamento non corrisponde: servono stesso importo, stessa direzione e una data vicina",
    );
  await ws.update("bank_transaction", transactionId, { status: "matched", payment_id: paymentId });
}

export async function unmatchTransaction(ws: Workspace, transactionId: string): Promise<void> {
  await ws.update("bank_transaction", transactionId, { status: "open", payment_id: null });
}

export async function ignoreTransaction(ws: Workspace, transactionId: string): Promise<void> {
  await ws.update("bank_transaction", transactionId, { status: "ignored", payment_id: null });
}

/** Matches the lines that have exactly one convincing candidate (a document number found). */
export async function autoMatch(ws: Workspace): Promise<number> {
  const open = (await ws.list("bank_transaction", { filters: { status: "open" }, limit: 1000 }))
    .rows;
  const used = new Set<string>();
  let matched = 0;
  for (const tx of open) {
    const strong = (await candidatesFor(ws, tx)).filter(
      (c) => c.score >= 0.85 && !used.has(c.paymentId),
    );
    if (strong.length !== 1) continue;
    const pick = strong[0] as MatchCandidate;
    await matchTransaction(ws, tx.id, pick.paymentId);
    used.add(pick.paymentId);
    matched++;
  }
  return matched;
}

export interface ReconciliationSummary {
  open: number;
  matched: number;
  ignored: number;
  /** Payments by bank transfer or card with no statement line yet. */
  paymentsWithoutLine: number;
}

export async function reconciliationSummary(ws: Workspace): Promise<ReconciliationSummary> {
  const counts = (await ws.db.query(
    "SELECT status, COUNT(*) AS n FROM bank_transactions WHERE deleted_at IS NULL GROUP BY status",
  )) as unknown as { status: string; n: number }[];
  const by = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)]));
  const [unmatched] = (await ws.db.query(
    `SELECT COUNT(*) AS n FROM payments p
     WHERE p.deleted_at IS NULL AND p.method <> 'cash'
       AND NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.payment_id = p.id AND b.deleted_at IS NULL)`,
  )) as unknown as { n: number }[];
  return {
    open: by["open"] ?? 0,
    matched: by["matched"] ?? 0,
    ignored: by["ignored"] ?? 0,
    paymentsWithoutLine: Number(unmatched?.n ?? 0),
  };
}
