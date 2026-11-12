/**
 * The package for the accountant (pacchetto per il commercialista): the books and the registers
 * of a year as CSV files plus a README, ready to be zipped and sent.
 *
 * Amounts are in euro with two decimals. The files are what the program holds: they are not
 * a fiscal declaration, and they do not replace the accountant's own checks.
 */

import type { SqlRunner } from "../data/db";
import { zipStore, type ZipFile } from "../lib/zip";
import { getCompany } from "./company";
import { aging, toCsv, trialBalance, withholdingSummary } from "./reports";
import { vatRegister } from "./vat";

export interface ExportFile {
  name: string;
  /** What the file contains, shown on the page and in the README. */
  description: string;
  content: string;
  rows: number;
}

const euro = (cents: number): number => Math.round(cents) / 100;

async function rows(db: SqlRunner, sql: string, params: unknown[] = []) {
  return (await db.query(sql, params as never[])) as unknown as Record<string, unknown>[];
}

export async function accountantFiles(
  db: SqlRunner,
  year: number,
  today: string,
): Promise<ExportFile[]> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const files: ExportFile[] = [];
  const add = (
    name: string,
    description: string,
    columns: { key: string; label: string }[],
    data: Record<string, unknown>[],
  ) => files.push({ name, description, content: toCsv(columns, data), rows: data.length });

  // Chart of accounts
  const accounts = await rows(
    db,
    "SELECT code, name, type FROM accounts WHERE deleted_at IS NULL ORDER BY code",
  );
  add(
    "piano-dei-conti.csv",
    "Piano dei conti",
    [
      { key: "code", label: "Codice" },
      { key: "name", label: "Conto" },
      { key: "type", label: "Tipo" },
    ],
    accounts,
  );

  // Journal (prima nota): one row per line, closing and reversals included and marked
  const journal = await rows(
    db,
    `SELECT e.number, e.date, e.description, e.source, e.source_id, e.reverses_id,
            a.code, a.name AS account, l.debit, l.credit, l.memo
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     JOIN accounts a ON a.id = l.account_id
     WHERE e.deleted_at IS NULL AND l.deleted_at IS NULL AND e.date >= ? AND e.date <= ?
     ORDER BY e.date, e.number, l.rowid`,
    [from, to],
  );
  add(
    `prima-nota_${year}.csv`,
    "Prima nota: una riga per movimento, con registrazioni di chiusura e storni indicati nella colonna «Origine»",
    [
      { key: "number", label: "Numero" },
      { key: "date", label: "Data" },
      { key: "description", label: "Descrizione" },
      { key: "origin", label: "Origine" },
      { key: "code", label: "Codice conto" },
      { key: "account", label: "Conto" },
      { key: "debit", label: "Dare" },
      { key: "credit", label: "Avere" },
      { key: "memo", label: "Nota" },
    ],
    journal.map((r) => ({
      ...r,
      origin: r["reverses_id"]
        ? "storno"
        : String(r["source_id"] ?? "").startsWith("closing:")
          ? "chiusura"
          : ({ document: "documento", payment: "pagamento", manual: "manuale", reversal: "storno" }[
              String(r["source"])
            ] ?? r["source"]),
      debit: euro(Number(r["debit"])),
      credit: euro(Number(r["credit"])),
    })),
  );

  // Trial balance
  const tb = await trialBalance(db, from, to, { includeClosing: true });
  add(
    `bilancio-di-verifica_${year}.csv`,
    "Bilancio di verifica dell'anno (con le chiusure, se registrate)",
    [
      { key: "code", label: "Codice" },
      { key: "name", label: "Conto" },
      { key: "debit", label: "Dare" },
      { key: "credit", label: "Avere" },
      { key: "balance", label: "Saldo (dare - avere)" },
    ],
    tb
      .filter((r) => r.debit !== 0 || r.credit !== 0)
      .map((r) => ({
        code: r.code,
        name: r.name,
        debit: euro(r.debit),
        credit: euro(r.credit),
        balance: euro(r.balance),
      })),
  );

  // VAT registers
  for (const kind of ["sales", "purchases"] as const) {
    const register = await vatRegister(db, from, to, kind);
    add(
      `registro-${kind === "sales" ? "vendite" : "acquisti"}_${year}.csv`,
      `Registro IVA ${kind === "sales" ? "delle vendite" : "degli acquisti"} (una riga per documento e aliquota; split payment indicato)`,
      [
        { key: "protocol", label: "Protocollo" },
        { key: "date", label: "Data" },
        { key: "number", label: "Numero" },
        { key: "party", label: "Controparte" },
        { key: "vatNumber", label: "Partita IVA" },
        { key: "type", label: "Tipo documento" },
        { key: "rate", label: "Aliquota" },
        { key: "nature", label: "Natura" },
        { key: "base", label: "Imponibile" },
        { key: "vat", label: "IVA" },
        { key: "split", label: "Split payment" },
      ],
      register.lines.map((l) => ({
        ...l,
        base: euro(l.base),
        vat: euro(l.vat),
        split: l.split ? "sì" : "",
      })),
    );
  }

  // Registered VAT settlements
  const settlements = await rows(
    db,
    `SELECT year, period_kind, period, date_from, date_to, sales_vat, purchases_vat,
            previous_credit, previous_debit, interest, due, credit_forward, debit_forward
     FROM vat_settlements WHERE deleted_at IS NULL AND year = ? ORDER BY date_to`,
    [year],
  );
  add(
    `liquidazioni-iva_${year}.csv`,
    "Liquidazioni IVA registrate",
    [
      { key: "period_kind", label: "Periodicità" },
      { key: "period", label: "Periodo" },
      { key: "date_from", label: "Dal" },
      { key: "date_to", label: "Al" },
      { key: "sales_vat", label: "IVA vendite" },
      { key: "purchases_vat", label: "IVA acquisti" },
      { key: "previous_credit", label: "Credito precedente" },
      { key: "previous_debit", label: "Debito riportato" },
      { key: "interest", label: "Interessi" },
      { key: "due", label: "Da versare" },
      { key: "credit_forward", label: "Credito da riportare" },
      { key: "debit_forward", label: "Debito sotto soglia riportato" },
    ],
    settlements.map((s) => ({
      ...s,
      period_kind: s["period_kind"] === "monthly" ? "mensile" : "trimestrale",
      ...Object.fromEntries(
        [
          "sales_vat",
          "purchases_vat",
          "previous_credit",
          "previous_debit",
          "interest",
          "due",
          "credit_forward",
          "debit_forward",
        ].map((k) => [k, euro(Number(s[k] ?? 0))]),
      ),
    })),
  );

  // Withholding taxes
  const withholding = await withholdingSummary(db, from, to);
  add(
    `ritenute_${year}.csv`,
    "Ritenute d'acconto subite e operate",
    [
      { key: "kind", label: "Tipo" },
      { key: "date", label: "Data" },
      { key: "number", label: "Documento" },
      { key: "party", label: "Controparte" },
      { key: "base", label: "Base" },
      { key: "rate", label: "Aliquota" },
      { key: "amount", label: "Ritenuta" },
    ],
    withholding.rows.map((r) => ({
      ...r,
      kind: r.kind === "suffered" ? "subita" : "operata",
      base: euro(r.base),
      amount: euro(r.amount),
    })),
  );

  // Open items at the end of the year
  for (const [direction, name, label] of [
    ["receivable", "crediti-aperti", "Crediti verso clienti ancora da incassare"],
    ["payable", "debiti-aperti", "Debiti verso fornitori ancora da pagare"],
  ] as const) {
    const open = await aging(db, to, direction);
    add(
      `${name}_al-31-12-${year}.csv`,
      `${label}, alla fine dell'anno`,
      [
        { key: "number", label: "Documento" },
        { key: "party", label: "Controparte" },
        { key: "dueDate", label: "Scadenza" },
        { key: "total", label: "Da incassare/pagare" },
        { key: "outstanding", label: "Residuo" },
        { key: "daysOverdue", label: "Giorni di ritardo" },
      ],
      open.map((r) => ({ ...r, total: euro(r.total), outstanding: euro(r.outstanding) })),
    );
  }

  // Payroll statements
  const payroll = await rows(
    db,
    `SELECT p.period, e.last_name || ' ' || e.first_name AS employee, p.gross, p.contrib_employee,
            p.contrib_employer, p.income_tax, p.net, p.total_cost, p.status
     FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.deleted_at IS NULL AND p.period >= ? AND p.period <= ? ORDER BY p.period, employee`,
    [`${year}-01`, `${year}-12`],
  );
  add(
    `buste-paga_${year}.csv`,
    "Prospetti delle retribuzioni (non sono buste paga ufficiali)",
    [
      { key: "period", label: "Mese" },
      { key: "employee", label: "Dipendente" },
      { key: "gross", label: "Lordo" },
      { key: "contrib_employee", label: "Contributi dipendente" },
      { key: "contrib_employer", label: "Contributi azienda" },
      { key: "income_tax", label: "Ritenuta IRPEF" },
      { key: "net", label: "Netto" },
      { key: "total_cost", label: "Costo azienda" },
      { key: "status", label: "Stato" },
    ],
    payroll.map((r) => ({
      ...r,
      ...Object.fromEntries(
        ["gross", "contrib_employee", "contrib_employer", "income_tax", "net", "total_cost"].map(
          (k) => [k, euro(Number(r[k] ?? 0))],
        ),
      ),
      status: { draft: "bozza", registered: "registrato", paid: "pagato" }[String(r["status"])],
    })),
  );

  const company = await getCompany(db);
  const done = files;
  const readme = [
    `Pacchetto per il commercialista · anno ${year}`,
    company ? `Azienda: ${company.name} (regime ${company.regime})` : "",
    `Generato il ${today} da Vyrion ERP`,
    "",
    "File inclusi:",
    ...done.map(
      (f) => `- ${f.name}: ${f.description} (${f.rows === 1 ? "1 riga" : `${f.rows} righe`})`,
    ),
    "",
    "Formato: CSV con punto e virgola, UTF-8 (si apre in Excel), importi in euro.",
    "Questi file riportano i dati registrati nel programma. Non sono dichiarazioni né",
    "comunicazioni fiscali: i calcoli (IVA, ritenute, cassa, cambi, retribuzioni) vanno",
    "verificati dal commercialista o dal consulente del lavoro prima dell'uso.",
    "",
  ]
    .filter((line, i) => i !== 1 || line)
    .join("\r\n");
  return [
    { name: "LEGGIMI.txt", description: "Contenuto del pacchetto", content: readme, rows: 0 },
    ...done,
  ];
}

/** The files as a ZIP archive. */
export async function accountantPackage(
  db: SqlRunner,
  year: number,
  today: string,
  when?: Date,
): Promise<{ fileName: string; bytes: Uint8Array; files: ExportFile[] }> {
  const files = await accountantFiles(db, year, today);
  const zipFiles: ZipFile[] = files.map((f) => ({ name: f.name, data: f.content }));
  return {
    fileName: `commercialista_${year}.zip`,
    bytes: zipStore(zipFiles, when),
    files,
  };
}
