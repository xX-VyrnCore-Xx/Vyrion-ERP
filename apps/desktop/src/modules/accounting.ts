import type { SqlRunner } from "../data/db";
import type { Ctx, EntityDef, Rec } from "../data/entity";
import { ConflictError, ValidationError } from "../data/errors";
import type { EntityRepository } from "../data/repository";
import { getSetting } from "../data/system";
import { namedId } from "../lib/ids";
import { opts } from "./common";

export const ACCOUNT_TYPES = opts([
  ["asset", "Attività"],
  ["liability", "Passività"],
  ["equity", "Patrimonio netto"],
  ["revenue", "Ricavi"],
  ["expense", "Costi"],
]);

/** Chart of accounts created on first start. The codes marked below are used by the automatic postings. */
export const DEFAULT_ACCOUNTS: { code: string; name: string; type: string }[] = [
  { code: "100", name: "Cassa", type: "asset" },
  { code: "110", name: "Clienti", type: "asset" },
  { code: "120", name: "Banca c/c", type: "asset" },
  { code: "130", name: "IVA a credito", type: "asset" },
  { code: "135", name: "Erario c/ritenute subite", type: "asset" },
  { code: "150", name: "Immobilizzazioni", type: "asset" },
  { code: "151", name: "Fondo ammortamento", type: "asset" },
  { code: "200", name: "Fornitori", type: "liability" },
  { code: "220", name: "IVA a debito", type: "liability" },
  { code: "230", name: "Erario c/ritenute da versare", type: "liability" },
  { code: "300", name: "Capitale e riserve", type: "equity" },
  { code: "310", name: "Utile (perdita) d'esercizio", type: "equity" },
  { code: "400", name: "Ricavi delle vendite e prestazioni", type: "revenue" },
  { code: "410", name: "Rimborso imposta di bollo", type: "revenue" },
  { code: "500", name: "Costi per acquisti e servizi", type: "expense" },
  { code: "510", name: "Costo del personale", type: "expense" },
  { code: "520", name: "Spese generali", type: "expense" },
  { code: "530", name: "Ammortamenti", type: "expense" },
];

export const ACC = {
  cash: "100",
  receivables: "110",
  bank: "120",
  vatCredit: "130",
  withholdingSuffered: "135",
  withholdingToPay: "230",
  payables: "200",
  vatDebit: "220",
  revenue: "400",
  stampRefund: "410",
  costs: "500",
  fixedAssets: "150",
  accumulatedDepreciation: "151",
  result: "310",
  depreciation: "530",
} as const;

export const ACCOUNT: EntityDef = {
  key: "account",
  module: "erp",
  label: "Conto",
  plural: "Piano dei conti",
  table: "accounts",
  title: (r) => `${r["code"]} ${r["name"]}`,
  defaultOrder: "code asc",
  fields: [
    {
      name: "code",
      label: "Codice",
      type: "text",
      required: true,
      unique: true,
      maxLength: 12,
      list: true,
      searchable: true,
    },
    {
      name: "name",
      label: "Descrizione",
      type: "text",
      required: true,
      list: true,
      searchable: true,
    },
    {
      name: "type",
      label: "Tipo",
      type: "select",
      options: ACCOUNT_TYPES,
      required: true,
      list: true,
    },
  ],
};

const IMMUTABLE = "Le registrazioni contabili non si modificano: usa lo storno.";

// A journal entry can only be created by `postEntry`, which checks that it balances.
let posting = 0;
// Set while the closing (or reopening) of a financial year writes its own entries.
let closing = 0;

/** The last day of the latest closed financial year (setting), or none. */
export const CLOSED_THROUGH = "accounting.closed_through";

/** Runs `job` with the period lock lifted: only the year-end closing and reopening use it. */
export async function withPeriodLockLifted<T>(job: () => Promise<T>): Promise<T> {
  closing++;
  try {
    return await job();
  } finally {
    closing--;
  }
}

export const JOURNAL_ENTRY: EntityDef = {
  key: "journal_entry",
  module: "erp",
  label: "Registrazione",
  plural: "Prima nota",
  table: "journal_entries",
  title: (r) => `${r["number"]} · ${r["description"]}`,
  defaultOrder: "date desc",
  noDelete: true,
  lockedReason: () => IMMUTABLE,
  fields: [
    { name: "number", label: "Numero", type: "text", required: true, unique: true, list: true },
    { name: "date", label: "Data", type: "date", required: true, list: true },
    {
      name: "description",
      label: "Descrizione",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    {
      name: "source",
      label: "Origine",
      type: "select",
      options: opts([
        ["manual", "Manuale"],
        ["document", "Documento"],
        ["payment", "Pagamento"],
        ["reversal", "Storno"],
      ]),
      required: true,
      default: "manual",
    },
    { name: "source_id", label: "Origine (id)", type: "text", hidden: true },
    { name: "reverses_id", label: "Storna", type: "ref", ref: "journal_entry" },
    { name: "total", label: "Totale", type: "money", readonly: true, list: true },
  ],
  beforeSave: async ({ tx, mode, record }) => {
    if (mode === "create" && posting === 0) {
      throw new ConflictError(
        "Le registrazioni si creano solo dalla prima nota, che ne verifica il pareggio",
      );
    }
    if (mode === "create" && !closing) {
      // A closed financial year cannot receive new entries: its figures are final.
      const closedThrough = await getSetting<string>(tx, CLOSED_THROUGH);
      if (closedThrough && String(record["date"]) <= closedThrough) {
        throw new ConflictError(
          `L'esercizio fino al ${closedThrough} è chiuso: non si può registrare con questa data`,
        );
      }
    }
  },
};

export const JOURNAL_LINE: EntityDef = {
  key: "journal_line",
  module: "erp",
  label: "Riga di registrazione",
  plural: "Righe di registrazione",
  table: "journal_lines",
  title: (r) => String(r["account_id"]),
  noDelete: true,
  lockedReason: () => IMMUTABLE,
  fields: [
    { name: "entry_id", label: "Registrazione", type: "ref", ref: "journal_entry", required: true },
    { name: "account_id", label: "Conto", type: "ref", ref: "account", required: true },
    { name: "debit", label: "Dare", type: "money", default: 0, min: 0 },
    { name: "credit", label: "Avere", type: "money", default: 0, min: 0 },
    { name: "memo", label: "Nota", type: "text" },
  ],
  beforeSave: ({ mode, record }) => {
    if (mode === "create" && posting === 0)
      throw new ConflictError("Le righe si creano solo con la registrazione");
    const debit = Number(record["debit"] ?? 0);
    const credit = Number(record["credit"] ?? 0);
    if (debit > 0 === credit > 0)
      throw new ValidationError({ debit: "Una riga ha un importo o in dare o in avere" });
  },
};

export interface PostingLine {
  /** Account code (e.g. "110") or id. */
  account: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface PostingInput {
  date: string;
  description: string;
  source?: "manual" | "document" | "payment" | "reversal";
  sourceId?: string | null;
  reversesId?: string | null;
  lines: PostingLine[];
}

type RepoOf = (key: string) => EntityRepository;

async function nextEntryNumber(tx: SqlRunner, year: string): Promise<string> {
  const key = `journal:${year}`;
  await tx.execute(
    `INSERT INTO number_sequences (key, last, last_date) VALUES (?, 0, NULL) ON CONFLICT(key) DO NOTHING`,
    [key],
  );
  await tx.execute("UPDATE number_sequences SET last = last + 1 WHERE key = ?", [key]);
  const [row] = await tx.query<{ last: number }>(
    "SELECT last FROM number_sequences WHERE key = ?",
    [key],
  );
  return `${year}/${String(row?.last ?? 1).padStart(5, "0")}`;
}

/**
 * Makes sure a standard account exists. Installations created before an account was added to
 * the chart do not have it: it is created with the same fixed id on every device, so two
 * devices creating it do not end up with two copies.
 */
export async function ensureAccount(
  tx: SqlRunner,
  ctx: Ctx,
  repo: RepoOf,
  code: string,
): Promise<void> {
  const [existing] = await tx.query<{ id: string }>(
    "SELECT id FROM accounts WHERE code = ? AND deleted_at IS NULL",
    [code],
  );
  if (existing) return;
  const standard = DEFAULT_ACCOUNTS.find((a) => a.code === code);
  if (!standard) throw new ConflictError(`Il conto ${code} non esiste nel piano dei conti`);
  await repo("account").create(tx, ctx, { id: await namedId(`account:${code}`), ...standard });
}

async function accountId(tx: SqlRunner, ref: string): Promise<string> {
  const [row] = await tx.query<{ id: string }>(
    "SELECT id FROM accounts WHERE (code = ? OR id = ?) AND deleted_at IS NULL",
    [ref, ref],
  );
  if (!row) throw new ConflictError(`Il conto ${ref} non esiste nel piano dei conti`);
  return row.id;
}

/** Writes a balanced journal entry (debits = credits, at least two lines) atomically. */
export async function postEntry(
  tx: SqlRunner,
  ctx: Ctx,
  repo: RepoOf,
  input: PostingInput,
): Promise<Rec> {
  const lines = input.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  if (lines.length < 2) throw new ValidationError({ lines: "Servono almeno due righe" });
  const debit = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const credit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (debit !== credit) {
    throw new ValidationError({
      lines: `La registrazione non quadra: dare ${debit / 100}, avere ${credit / 100}`,
    });
  }
  posting++;
  try {
    const entry = await repo("journal_entry").create(tx, ctx, {
      number: await nextEntryNumber(tx, input.date.slice(0, 4)),
      date: input.date,
      description: input.description,
      source: input.source ?? "manual",
      source_id: input.sourceId ?? null,
      reverses_id: input.reversesId ?? null,
      total: debit,
    });
    for (const line of lines) {
      await repo("journal_line").create(tx, ctx, {
        entry_id: entry.id,
        account_id: await accountId(tx, line.account),
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        memo: line.memo ?? null,
      });
    }
    return entry;
  } finally {
    posting--;
  }
}

/** Posts the opposite of every not-yet-reversed entry that came from `sourceId`. */
export async function reverseEntries(
  tx: SqlRunner,
  ctx: Ctx,
  repo: RepoOf,
  sourceId: string,
  why: string,
): Promise<void> {
  const entries = await tx.query<{ id: string; number: string }>(
    `SELECT e.id, e.number FROM journal_entries e
     WHERE e.source_id = ? AND e.source <> 'reversal'
       AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_id = e.id)`,
    [sourceId],
  );
  for (const entry of entries) {
    const lines = await tx.query<{ account_id: string; debit: number; credit: number }>(
      "SELECT account_id, debit, credit FROM journal_lines WHERE entry_id = ?",
      [entry.id],
    );
    await postEntry(tx, ctx, repo, {
      date: ctx.today(),
      description: `Storno ${entry.number}: ${why}`,
      source: "reversal",
      sourceId,
      reversesId: entry.id,
      lines: lines.map((l) => ({ account: l.account_id, debit: l.credit, credit: l.debit })),
    });
  }
}
