import type { SqlRunner } from "../data/db";
import type { EntityDef, Rec } from "../data/entity";
import { ConflictError, LockedError, ValidationError } from "../data/errors";
import { opts } from "./common";
import {
  ACC,
  ACCOUNT,
  ensureAccount,
  JOURNAL_ENTRY,
  JOURNAL_LINE,
  postEntry,
  reverseEntries,
} from "./accounting";
import {
  ALLOWED_STATUS,
  DOC_STATUS,
  DOC_TYPES,
  VAT_NATURES,
  isFiscal,
  type DocType,
} from "./documents";
import { REGIMES } from "./company";
import { computePayslip } from "./payrollMath";

export const PAYMENT_METHODS = opts([
  ["bank", "Bonifico"],
  ["cash", "Contanti"],
  ["card", "Carta"],
  ["other", "Altro"],
]);
export const PRODUCT_KINDS = opts([
  ["goods", "Bene"],
  ["service", "Servizio"],
]);
export const MOVEMENT_KINDS = opts([
  ["in", "Carico"],
  ["out", "Scarico"],
  ["adjust", "Rettifica inventariale"],
]);
export const PROJECT_STATUS = opts([
  ["planned", "Pianificato"],
  ["active", "In corso"],
  ["done", "Concluso"],
  ["cancelled", "Annullato"],
]);
export const LEAVE_KINDS = opts([
  ["vacation", "Ferie"],
  ["sick", "Malattia"],
  ["permit", "Permesso"],
]);
export const LEAVE_STATUS = opts([
  ["requested", "Richiesta"],
  ["approved", "Approvata"],
  ["rejected", "Rifiutata"],
]);

/** Document ids currently being issued; only `issueDocument` may move a fiscal document to "issued". */
export const issuing = new Set<string>();

/** What is still to be paid on an issued document. */
export async function outstanding(tx: SqlRunner, documentId: string): Promise<number> {
  const [row] = await tx.query<{ total: number; paid: number }>(
    `SELECT COALESCE(d.payable, d.total) AS total,
            COALESCE((SELECT SUM(amount) FROM payments p WHERE p.document_id = d.id AND p.deleted_at IS NULL), 0) AS paid
     FROM documents d WHERE d.id = ?`,
    [documentId],
  );
  return row ? Number(row.total) - Number(row.paid) : 0;
}

type ParentDocument = {
  type: DocType;
  status: string;
  number: string | null;
  currency: string | null;
  exchange_rate: number | null;
  foreign_payable: number | null;
};

async function parentDocument(tx: SqlRunner, id: unknown): Promise<ParentDocument | null> {
  const [row] = await tx.query<ParentDocument>(
    "SELECT type, status, number, currency, exchange_rate, foreign_payable FROM documents WHERE id = ?",
    [id as string],
  );
  return row ?? null;
}

/**
 * Euro value, at the document's own rate, of a payment made in the document's currency: what
 * it clears from the open amount. Paying everything that is left in the currency clears
 * exactly what is left in euro (no rounding residue).
 */
export async function foreignSettlement(
  tx: SqlRunner,
  documentId: string,
  foreignAmount: number,
): Promise<{ euro: number; foreignOpen: number }> {
  const doc = await parentDocument(tx, documentId);
  if (!doc || !doc.currency || doc.currency === "EUR" || !(Number(doc.exchange_rate) > 0))
    throw new ValidationError({ foreign_amount: "Il documento è in euro" });
  const [paid] = await tx.query<{ n: number }>(
    "SELECT COALESCE(SUM(foreign_amount), 0) AS n FROM payments WHERE document_id = ? AND deleted_at IS NULL",
    [documentId],
  );
  const foreignOpen = Number(doc.foreign_payable ?? 0) - Number(paid?.n ?? 0);
  const open = await outstanding(tx, documentId);
  const euro =
    foreignAmount === foreignOpen
      ? open
      : Math.min(open, Math.round(foreignAmount / Number(doc.exchange_rate)));
  return { euro, foreignOpen };
}

const document: EntityDef = {
  key: "document",
  module: "erp",
  label: "Documento",
  plural: "Documenti",
  table: "documents",
  title: (r) => `${r["number"] ?? "Bozza"} · ${r["type"]}`,
  defaultOrder: "date desc",
  lockedReason: (r) =>
    isFiscal(String(r["type"])) && r["status"] !== "draft"
      ? "Un documento fiscale emesso non si modifica: per correggerlo emetti una nota di credito"
      : r["status"] === "invoiced"
        ? "Il documento è già stato fatturato"
        : null,
  fields: [
    { name: "type", label: "Tipo", type: "select", options: DOC_TYPES, required: true, list: true },
    {
      name: "number",
      label: "Numero",
      type: "text",
      unique: ["party_id"],
      list: true,
      searchable: true,
    },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: DOC_STATUS,
      required: true,
      default: "draft",
      list: true,
    },
    { name: "date", label: "Data", type: "date", required: true, list: true },
    {
      name: "party_id",
      label: "Anagrafica",
      type: "ref",
      ref: "party",
      required: true,
      list: true,
    },
    { name: "due_date", label: "Scadenza pagamento", type: "date", list: true },
    { name: "valid_until", label: "Valido fino al", type: "date" },
    {
      name: "tax_regime",
      label: "Regime",
      type: "select",
      options: REGIMES,
      required: true,
      readonly: true,
    },
    {
      name: "source_id",
      label: "Documento di origine",
      type: "ref",
      ref: "document",
      readonly: true,
    },
    { name: "net_total", label: "Imponibile", type: "money", default: 0, readonly: true },
    { name: "vat_total", label: "IVA", type: "money", default: 0, readonly: true },
    { name: "stamp_duty", label: "Bollo", type: "money", default: 0, readonly: true },
    { name: "total", label: "Totale", type: "money", default: 0, readonly: true, list: true },
    {
      name: "cassa_rate",
      label: "Cassa previdenziale %",
      type: "percent",
      min: 0,
      max: 100,
      help: "Contributo (es. 4%) calcolato sulle righe e soggetto alla stessa IVA.",
    },
    { name: "cassa_amount", label: "Cassa previdenziale", type: "money", readonly: true },
    {
      name: "withholding_rate",
      label: "Ritenuta d'acconto %",
      type: "percent",
      min: 0,
      max: 100,
      help: "Di solito 20%. Non si applica nel regime forfettario.",
    },
    {
      name: "withholding_base_pct",
      label: "Quota imponibile della ritenuta %",
      type: "percent",
      min: 0,
      max: 100,
      default: 100,
    },
    {
      name: "withholding_on_cassa",
      label: "Ritenuta anche sulla cassa",
      type: "boolean",
      default: true,
    },
    { name: "withholding_amount", label: "Ritenuta", type: "money", readonly: true },
    {
      name: "split_payment",
      label: "Scissione dei pagamenti (split payment)",
      type: "boolean",
      default: false,
      help: "Per le cessioni a enti pubblici: l'IVA la versa l'ente, non si incassa.",
    },
    {
      name: "currency",
      label: "Valuta",
      type: "text",
      default: "EUR",
      maxLength: 3,
      help: "Codice di 3 lettere (EUR, USD, GBP, CHF...). I prezzi delle righe sono in questa valuta; i totali di registri e contabilità restano in euro.",
    },
    {
      name: "exchange_rate",
      label: "Cambio (unità di valuta per 1 EUR)",
      type: "decimal",
      min: 0,
      help: "Es. 1,0850 se 1 EUR = 1,0850 USD. Obbligatorio per una valuta diversa dall'euro.",
    },
    { name: "foreign_total", label: "Totale in valuta", type: "money", readonly: true },
    {
      name: "foreign_payable",
      label: "Da incassare/pagare in valuta",
      type: "money",
      readonly: true,
    },
    {
      name: "payable",
      label: "Netto da incassare / pagare",
      type: "money",
      readonly: true,
      list: true,
    },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  // A draft takes its lines with it.
  beforeDelete: async ({ tx, ctx, repo, record }) => {
    // Hours billed on a draft that is deleted become billable again.
    const billed = (await tx.query(
      "SELECT id FROM ticket_interventions WHERE document_id = ? AND deleted_at IS NULL",
      [record.id],
    )) as unknown as { id: string }[];
    for (const row of billed)
      await repo("ticket_intervention").update(tx, ctx, row.id, { document_id: null });
    const lines = repo("document_line");
    const own = await lines.list(tx, { filters: { document_id: record.id }, limit: 1000 });
    for (const line of own.rows) await lines.remove(tx, ctx, line.id);
  },
  beforeSave: async ({ record, before }) => {
    const type = record["type"] as DocType;
    if (before && before["type"] !== type)
      throw new ValidationError({ type: "Il tipo di documento non si cambia" });
    if (!ALLOWED_STATUS[type].includes(String(record["status"]))) {
      throw new ValidationError({ status: "Stato non valido per questo tipo di documento" });
    }
    if (isFiscal(type) && record["status"] === "issued" && !issuing.has(record.id)) {
      throw new ConflictError("Un documento fiscale si emette con l'apposita operazione");
    }
    if (type === "purchase_invoice" && !record["number"]) {
      throw new ValidationError({ number: "Inserisci il numero della fattura del fornitore" });
    }
    const currency =
      String(record["currency"] ?? "EUR")
        .trim()
        .toUpperCase() || "EUR";
    if (!/^[A-Z]{3}$/.test(currency))
      throw new ValidationError({ currency: "Usa il codice di 3 lettere (es. USD)" });
    record["currency"] = currency;
    if (currency === "EUR") {
      record["exchange_rate"] = null;
    } else if (!(Number(record["exchange_rate"]) > 0)) {
      throw new ValidationError({ exchange_rate: `Indica il cambio ${currency} per 1 EUR` });
    }
    if (before && before["status"] !== "draft" && isFiscal(type) && !issuing.has(record.id)) {
      if (
        before["currency"] !== record["currency"] ||
        before["exchange_rate"] !== record["exchange_rate"]
      )
        throw new LockedError("Valuta e cambio di un documento emesso non si modificano");
    }
  },
};

const documentLine: EntityDef = {
  key: "document_line",
  module: "erp",
  label: "Riga documento",
  plural: "Righe documento",
  table: "document_lines",
  title: (r) => String(r["description"]),
  defaultOrder: "position asc",
  fields: [
    { name: "document_id", label: "Documento", type: "ref", ref: "document", required: true },
    { name: "position", label: "Posizione", type: "integer", required: true, min: 1 },
    { name: "product_id", label: "Prodotto", type: "ref", ref: "product" },
    { name: "description", label: "Descrizione", type: "text", required: true, maxLength: 1000 },
    {
      name: "quantity",
      label: "Quantità",
      type: "decimal",
      required: true,
      min: 0.001,
      default: 1,
    },
    { name: "unit", label: "Unità", type: "text", maxLength: 10 },
    { name: "unit_price", label: "Prezzo unitario", type: "money", required: true, default: 0 },
    { name: "discount", label: "Sconto %", type: "percent", default: 0 },
    { name: "vat_rate", label: "IVA %", type: "percent", required: true, default: 22 },
    { name: "vat_nature", label: "Natura (IVA 0)", type: "select", options: VAT_NATURES },
    { name: "net_amount", label: "Imponibile riga", type: "money", readonly: true, default: 0 },
  ],
  beforeSave: async ({ tx, record }) => {
    const parent = await parentDocument(tx, record["document_id"]);
    if (!parent) throw new ValidationError({ document_id: "Documento non trovato" });
    if (isFiscal(parent.type) && parent.status !== "draft") {
      throw new LockedError("Le righe di un documento fiscale emesso non si modificano");
    }
  },
  beforeDelete: async ({ tx, record }) => {
    const parent = await parentDocument(tx, record["document_id"]);
    if (parent && isFiscal(parent.type) && parent.status !== "draft") {
      throw new LockedError("Le righe di un documento fiscale emesso non si eliminano");
    }
  },
};

const payment: EntityDef = {
  key: "payment",
  module: "erp",
  label: "Pagamento",
  plural: "Pagamenti",
  table: "payments",
  title: (r) => `${r["date"]} · ${r["amount"]}`,
  defaultOrder: "date desc",
  fields: [
    {
      name: "document_id",
      label: "Documento",
      type: "ref",
      ref: "document",
      required: true,
      list: true,
    },
    { name: "date", label: "Data", type: "date", required: true, list: true },
    { name: "amount", label: "Importo", type: "money", min: 1, list: true },
    {
      name: "method",
      label: "Metodo",
      type: "select",
      options: PAYMENT_METHODS,
      required: true,
      default: "bank",
      list: true,
    },
    {
      name: "foreign_amount",
      label: "Importo in valuta",
      type: "money",
      min: 1,
      help: "Solo per documenti in valuta estera: l'importo regolato nella valuta del documento. L'importo in euro è calcolato al cambio del documento.",
    },
    {
      name: "received",
      label: "Euro effettivamente incassati/pagati",
      type: "money",
      min: 1,
      help: "Solo per documenti in valuta: la somma in euro che entra o esce dalla banca. La differenza con il valore al cambio del documento è un utile o una perdita su cambi.",
    },
    { name: "reference", label: "Riferimento", type: "text" },
  ],
  beforeSave: async ({ tx, mode, record }) => {
    if (mode === "update") {
      throw new LockedError("Un pagamento non si modifica: eliminalo e registralo di nuovo");
    }
    const doc = await parentDocument(tx, record["document_id"]);
    if (!doc || !isFiscal(doc.type))
      throw new ValidationError({ document_id: "Si pagano solo fatture e note di credito" });
    if (doc.status !== "issued") throw new ConflictError("Il documento non è ancora stato emesso");
    if (doc.currency && doc.currency !== "EUR") {
      const foreign = Number(record["foreign_amount"] ?? 0);
      if (!(foreign > 0))
        throw new ValidationError({
          foreign_amount: `Indica l'importo in ${doc.currency}`,
        });
      const { euro, foreignOpen } = await foreignSettlement(
        tx,
        record["document_id"] as string,
        foreign,
      );
      if (foreign > foreignOpen)
        throw new ValidationError({
          foreign_amount: `L'importo supera il residuo (${foreignOpen / 100} ${doc.currency})`,
        });
      record["amount"] = euro;
      if (record["received"] === null || record["received"] === undefined)
        record["received"] = euro;
    } else if (!(Number(record["amount"]) > 0)) {
      throw new ValidationError({ amount: "Campo obbligatorio" });
    } else if (record["foreign_amount"] || record["received"]) {
      throw new ValidationError({
        foreign_amount:
          "Importo in valuta e incassato effettivo riguardano solo i documenti in valuta",
      });
    }
    const open = await outstanding(tx, record["document_id"] as string);
    if (Number(record["amount"]) > open) {
      throw new ValidationError({
        amount: `L'importo supera il residuo da pagare (${open / 100})`,
      });
    }
  },
  afterSave: async ({ tx, ctx, repo, record }) => {
    const doc = await parentDocument(tx, record["document_id"]);
    if (!doc) return;
    const amount = Number(record["amount"]);
    const money = record["method"] === "cash" ? ACC.cash : ACC.bank;
    // Credit notes and sales bring money in (a credit note, refunded, sends it out: kept as
    // before); `amount` is the open amount cleared, `received` the cash that really moved.
    const incoming = doc.type === "invoice";
    const counterpart = doc.type === "purchase_invoice" ? ACC.payables : ACC.receivables;
    const cash =
      record["received"] === null || record["received"] === undefined
        ? amount
        : Number(record["received"]);
    const diff = cash - amount; // > 0: more euro than the document was worth
    if (diff !== 0) {
      await ensureAccount(tx, ctx, repo, diff > 0 === incoming ? ACC.fxGain : ACC.fxLoss);
    }
    // Sales: Dr cash, Cr customers, the difference is a gain when we cash more.
    // Purchases and credit notes: Dr suppliers/customers, Cr cash, a gain when we pay less.
    const gainOrLoss =
      diff === 0
        ? []
        : incoming
          ? [
              diff > 0
                ? { account: ACC.fxGain, credit: diff }
                : { account: ACC.fxLoss, debit: -diff },
            ]
          : [
              diff < 0
                ? { account: ACC.fxGain, credit: -diff }
                : { account: ACC.fxLoss, debit: diff },
            ];
    await postEntry(tx, ctx, repo, {
      date: record["date"] as string,
      description: `Pagamento ${doc.number ?? ""}`.trim(),
      source: "payment",
      sourceId: record.id,
      lines: incoming
        ? [{ account: money, debit: cash }, { account: counterpart, credit: amount }, ...gainOrLoss]
        : [
            { account: counterpart, debit: amount },
            { account: money, credit: cash },
            ...gainOrLoss,
          ],
    });
  },
  beforeDelete: async ({ tx, ctx, repo, record }) => {
    await reverseEntries(tx, ctx, repo, record.id, "pagamento eliminato");
  },
};

const product: EntityDef = {
  key: "product",
  module: "erp",
  label: "Prodotto",
  plural: "Prodotti e servizi",
  table: "products",
  title: (r) => `${r["sku"]} ${r["name"]}`,
  defaultOrder: "name asc",
  fields: [
    {
      name: "sku",
      label: "Codice",
      type: "text",
      required: true,
      unique: true,
      searchable: true,
      maxLength: 40,
      list: true,
    },
    { name: "name", label: "Nome", type: "text", required: true, searchable: true, list: true },
    {
      name: "kind",
      label: "Tipo",
      type: "select",
      options: PRODUCT_KINDS,
      required: true,
      default: "goods",
      list: true,
    },
    { name: "unit", label: "Unità", type: "text", default: "pz", maxLength: 10 },
    {
      name: "sale_price",
      label: "Prezzo di vendita",
      type: "money",
      default: 0,
      min: 0,
      list: true,
    },
    { name: "purchase_price", label: "Prezzo di acquisto", type: "money", default: 0, min: 0 },
    { name: "vat_rate", label: "IVA %", type: "percent", default: 22 },
    { name: "track_stock", label: "Gestisci giacenza", type: "boolean", default: false },
    {
      name: "track_lots",
      label: "Gestisci lotti / matricole",
      type: "boolean",
      default: false,
      help: "Ogni movimento indica il lotto. Per le matricole usa un lotto per ogni pezzo.",
    },
    { name: "min_stock", label: "Scorta minima", type: "decimal", min: 0, default: 0 },
    { name: "description", label: "Descrizione", type: "longtext" },
  ],
  beforeSave: ({ record }) => {
    if (record["kind"] === "service" && record["track_stock"]) {
      throw new ValidationError({ track_stock: "I servizi non hanno giacenza" });
    }
    if (record["track_lots"] && !record["track_stock"]) {
      throw new ValidationError({ track_lots: "I lotti richiedono la gestione della giacenza" });
    }
  },
};

const warehouse: EntityDef = {
  key: "warehouse",
  module: "erp",
  label: "Magazzino",
  plural: "Magazzini",
  table: "warehouses",
  title: (r) => String(r["name"]),
  defaultOrder: "name asc",
  fields: [
    {
      name: "name",
      label: "Nome",
      type: "text",
      required: true,
      unique: true,
      searchable: true,
      list: true,
    },
    { name: "address", label: "Indirizzo", type: "text", list: true },
    { name: "notes", label: "Note", type: "longtext" },
  ],
};

const stockLot: EntityDef = {
  key: "stock_lot",
  module: "erp",
  label: "Lotto",
  plural: "Lotti",
  table: "stock_lots",
  title: (r) => String(r["code"]),
  defaultOrder: "expiry_date asc",
  fields: [
    {
      name: "product_id",
      label: "Prodotto",
      type: "ref",
      ref: "product",
      required: true,
      list: true,
    },
    {
      name: "code",
      label: "Lotto / matricola",
      type: "text",
      required: true,
      unique: ["product_id"],
      searchable: true,
      maxLength: 60,
      list: true,
    },
    { name: "expiry_date", label: "Scadenza", type: "date", list: true },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  beforeSave: async ({ tx, record }) => {
    const [item] = await tx.query<{ track_lots: number }>(
      "SELECT track_lots FROM products WHERE id = ?",
      [record["product_id"] as string],
    );
    if (!item?.track_lots)
      throw new ValidationError({ product_id: "Il prodotto non gestisce i lotti" });
  },
};

const stockMovement: EntityDef = {
  key: "stock_movement",
  module: "erp",
  label: "Movimento di magazzino",
  plural: "Movimenti di magazzino",
  table: "stock_movements",
  title: (r) => `${r["date"]} ${r["quantity"]}`,
  defaultOrder: "date desc",
  noDelete: true,
  lockedReason: () => "I movimenti di magazzino non si modificano: registra una rettifica",
  fields: [
    {
      name: "product_id",
      label: "Prodotto",
      type: "ref",
      ref: "product",
      required: true,
      list: true,
    },
    { name: "date", label: "Data", type: "date", required: true, list: true },
    {
      name: "kind",
      label: "Tipo",
      type: "select",
      options: MOVEMENT_KINDS,
      required: true,
      list: true,
    },
    {
      name: "quantity",
      label: "Quantità (con segno)",
      type: "decimal",
      required: true,
      min: -1_000_000,
      max: 1_000_000,
      list: true,
    },
    { name: "unit_cost", label: "Costo unitario", type: "money", default: 0, min: 0 },
    {
      name: "warehouse_id",
      label: "Magazzino",
      type: "ref",
      ref: "warehouse",
      help: "Vuoto = magazzino principale",
      list: true,
    },
    { name: "lot_id", label: "Lotto", type: "ref", ref: "stock_lot" },
    { name: "reason", label: "Motivo", type: "text", list: true },
    { name: "document_id", label: "Documento", type: "ref", ref: "document" },
  ],
  beforeSave: async ({ tx, record }) => {
    const quantity = Number(record["quantity"]);
    if (quantity === 0) throw new ValidationError({ quantity: "La quantità non può essere zero" });
    const kind = record["kind"];
    if ((kind === "in" && quantity < 0) || (kind === "out" && quantity > 0)) {
      throw new ValidationError({ quantity: "Il segno non corrisponde al tipo di movimento" });
    }
    const [item] = await tx.query<{ track_stock: number; track_lots: number; name: string }>(
      "SELECT track_stock, track_lots, name FROM products WHERE id = ?",
      [record["product_id"] as string],
    );
    if (!item?.track_stock)
      throw new ValidationError({ product_id: "Il prodotto non ha la giacenza attiva" });
    const lotId = (record["lot_id"] as string | null) ?? null;
    if (item.track_lots && !lotId)
      throw new ValidationError({ lot_id: `${item.name} gestisce i lotti: indica il lotto` });
    if (!item.track_lots && lotId)
      throw new ValidationError({ lot_id: `${item.name} non gestisce i lotti` });
    if (lotId) {
      const [lot] = await tx.query<{ product_id: string }>(
        "SELECT product_id FROM stock_lots WHERE id = ? AND deleted_at IS NULL",
        [lotId],
      );
      if (!lot || lot.product_id !== record["product_id"])
        throw new ValidationError({ lot_id: "Il lotto non appartiene a questo prodotto" });
    }
    if (quantity < 0) {
      // Availability is checked where the goods are: in that warehouse and, if any, that lot.
      const warehouseId = (record["warehouse_id"] as string | null) ?? null;
      const [row] = await tx.query<{ q: number | null }>(
        `SELECT ROUND(SUM(quantity), 3) AS q FROM stock_movements
         WHERE product_id = ? AND deleted_at IS NULL
           AND COALESCE(warehouse_id, '') = COALESCE(?, '')
           AND COALESCE(lot_id, '') = COALESCE(?, '')`,
        [record["product_id"] as string, warehouseId, lotId],
      );
      const onHand = Number(row?.q ?? 0);
      if (onHand + quantity < -1e-9) {
        throw new ConflictError(
          `Giacenza insufficiente per ${item.name}${lotId ? " in questo lotto" : ""}${warehouseId ? " in questo magazzino" : ""}: disponibili ${onHand}`,
        );
      }
    }
  },
};

const employee: EntityDef = {
  key: "employee",
  module: "erp",
  label: "Dipendente",
  plural: "Personale",
  table: "employees",
  title: (r) => `${r["first_name"]} ${r["last_name"]}`,
  defaultOrder: "last_name asc",
  fields: [
    {
      name: "first_name",
      label: "Nome",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    {
      name: "last_name",
      label: "Cognome",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    { name: "role", label: "Mansione", type: "text", list: true },
    { name: "email", label: "Email", type: "email", list: true },
    { name: "phone", label: "Telefono", type: "phone" },
    { name: "hire_date", label: "Assunzione", type: "date" },
    { name: "end_date", label: "Cessazione", type: "date" },
    { name: "hourly_cost", label: "Costo orario", type: "money", default: 0, min: 0 },
    {
      name: "weekly_hours",
      label: "Ore settimanali",
      type: "decimal",
      default: 40,
      min: 0,
      max: 80,
      help: "Orario contrattuale: serve a calcolare le ore attese e lo straordinario.",
    },
    { name: "gross_monthly", label: "Lordo mensile", type: "money", min: 0 },
    {
      name: "contrib_employee_pct",
      label: "Contributi a carico del dipendente %",
      type: "percent",
      min: 0,
      max: 100,
      help: "Aliquota da usare nel prospetto (la fornisce il consulente del lavoro).",
    },
    {
      name: "contrib_employer_pct",
      label: "Contributi a carico dell'azienda %",
      type: "percent",
      min: 0,
      max: 100,
    },
    {
      name: "tax_pct",
      label: "Aliquota effettiva ritenuta IRPEF %",
      type: "percent",
      min: 0,
      max: 100,
      help: "Aliquota media effettiva stimata, non gli scaglioni.",
    },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  beforeSave: ({ record }) => {
    const hired = record["hire_date"] as string | null;
    const ended = record["end_date"] as string | null;
    if (hired && ended && ended < hired)
      throw new ValidationError({ end_date: "La cessazione precede l'assunzione" });
  },
};

const leave: EntityDef = {
  key: "leave",
  module: "erp",
  label: "Assenza",
  plural: "Ferie e assenze",
  table: "leaves",
  title: (r) => `${r["start_date"]} → ${r["end_date"]}`,
  defaultOrder: "start_date desc",
  fields: [
    {
      name: "employee_id",
      label: "Dipendente",
      type: "ref",
      ref: "employee",
      required: true,
      list: true,
    },
    {
      name: "kind",
      label: "Tipo",
      type: "select",
      options: LEAVE_KINDS,
      required: true,
      default: "vacation",
      list: true,
    },
    { name: "start_date", label: "Dal", type: "date", required: true, list: true },
    { name: "end_date", label: "Al", type: "date", required: true, list: true },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: LEAVE_STATUS,
      required: true,
      default: "requested",
      list: true,
    },
    { name: "notes", label: "Note", type: "text" },
  ],
  beforeSave: async ({ tx, record }) => {
    const start = record["start_date"] as string;
    const end = record["end_date"] as string;
    if (end < start) throw new ValidationError({ end_date: "La fine precede l'inizio" });
    const [clash] = await tx.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM leaves WHERE employee_id = ? AND deleted_at IS NULL AND id <> ?
         AND status <> 'rejected' AND start_date <= ? AND end_date >= ?`,
      [record["employee_id"] as string, record.id, end, start],
    );
    if (Number(clash?.n) > 0)
      throw new ConflictError("Si sovrappone a un'altra assenza dello stesso dipendente");
  },
};

const project: EntityDef = {
  key: "project",
  module: "erp",
  label: "Progetto",
  plural: "Progetti",
  table: "projects",
  title: (r) => String(r["name"]),
  defaultOrder: "name asc",
  fields: [
    { name: "name", label: "Nome", type: "text", required: true, searchable: true, list: true },
    { name: "party_id", label: "Cliente", type: "ref", ref: "party", list: true },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: PROJECT_STATUS,
      required: true,
      default: "planned",
      list: true,
    },
    { name: "start_date", label: "Inizio", type: "date" },
    { name: "end_date", label: "Fine", type: "date" },
    { name: "budget", label: "Budget", type: "money", default: 0, min: 0, list: true },
    { name: "hourly_rate", label: "Tariffa oraria", type: "money", default: 0, min: 0 },
    { name: "notes", label: "Note", type: "longtext" },
  ],
};

const timeEntry: EntityDef = {
  key: "time_entry",
  module: "erp",
  label: "Ore lavorate",
  plural: "Ore lavorate",
  table: "time_entries",
  title: (r) => `${r["date"]} ${r["minutes"]} min`,
  defaultOrder: "date desc",
  fields: [
    {
      name: "project_id",
      label: "Progetto",
      type: "ref",
      ref: "project",
      required: true,
      list: true,
    },
    {
      name: "employee_id",
      label: "Dipendente",
      type: "ref",
      ref: "employee",
      required: true,
      list: true,
    },
    { name: "date", label: "Data", type: "date", required: true, list: true },
    {
      name: "minutes",
      label: "Minuti",
      type: "integer",
      required: true,
      min: 1,
      max: 1440,
      list: true,
    },
    { name: "billable", label: "Fatturabile", type: "boolean", default: true },
    { name: "description", label: "Attività svolta", type: "text", list: true },
  ],
};

const attachment: EntityDef = {
  key: "attachment",
  module: "erp",
  label: "Allegato",
  plural: "Allegati",
  table: "attachments",
  title: (r) => String(r["file_name"]),
  defaultOrder: "created_at desc",
  fields: [
    { name: "owner_entity", label: "Tipo di record", type: "text", required: true, hidden: true },
    { name: "owner_id", label: "Record", type: "text", required: true, hidden: true },
    {
      name: "file_name",
      label: "Nome file",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    { name: "mime_type", label: "Tipo", type: "text", list: true },
    {
      name: "size",
      label: "Dimensione (byte)",
      type: "integer",
      required: true,
      min: 0,
      list: true,
    },
    { name: "sha256", label: "SHA-256", type: "text", required: true, maxLength: 64, hidden: true },
  ],
};

export const ASSET_CATEGORIES = opts([
  ["building", "Fabbricati"],
  ["plant", "Impianti e macchinari"],
  ["furniture", "Mobili e arredi"],
  ["electronics", "Elaboratori e hardware"],
  ["vehicle", "Automezzi"],
  ["software", "Software e licenze pluriennali"],
  ["other", "Altro"],
]);

/** Fixed assets (cespiti): bought once, written off over the years. */
const fixedAsset: EntityDef = {
  key: "fixed_asset",
  module: "erp",
  label: "Cespite",
  plural: "Cespiti",
  table: "fixed_assets",
  title: (r) => String(r["name"]),
  defaultOrder: "purchase_date desc",
  fields: [
    {
      name: "name",
      label: "Descrizione",
      type: "text",
      required: true,
      searchable: true,
      list: true,
    },
    {
      name: "category",
      label: "Categoria",
      type: "select",
      options: ASSET_CATEGORIES,
      required: true,
      default: "electronics",
      list: true,
    },
    { name: "purchase_date", label: "Data di acquisto", type: "date", required: true, list: true },
    { name: "cost", label: "Costo", type: "money", required: true, min: 1, list: true },
    {
      name: "rate",
      label: "Aliquota annua %",
      type: "percent",
      required: true,
      min: 0.01,
      max: 100,
      default: 20,
      list: true,
      help: "Nel primo anno si applica la metà dell'aliquota, come di prassi.",
    },
    { name: "residual", label: "Valore residuo", type: "money", default: 0, min: 0 },
    {
      name: "capitalize",
      label: "Sposta il costo dai costi alle immobilizzazioni",
      type: "boolean",
      default: true,
      help: "Attivo se l'acquisto è già nei «Costi per acquisti» (fattura di acquisto emessa).",
    },
    { name: "disposed_on", label: "Dismesso il", type: "date" },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  beforeSave: ({ record }) => {
    if (Number(record["residual"] ?? 0) >= Number(record["cost"])) {
      throw new ValidationError({ residual: "Il valore residuo deve essere inferiore al costo" });
    }
    if (record["disposed_on"] && String(record["disposed_on"]) < String(record["purchase_date"])) {
      throw new ValidationError({ disposed_on: "La dismissione precede l'acquisto" });
    }
  },
  afterSave: async ({ tx, ctx, repo, mode, record }) => {
    if (mode !== "create" || !record["capitalize"]) return;
    await ensureAccount(tx, ctx, repo, ACC.fixedAssets);
    await postEntry(tx, ctx, repo, {
      date: record["purchase_date"] as string,
      description: `Capitalizzazione ${String(record["name"])}`,
      sourceId: record.id,
      lines: [
        { account: ACC.fixedAssets, debit: Number(record["cost"]) },
        { account: ACC.costs, credit: Number(record["cost"]) },
      ],
    });
  },
  beforeDelete: async ({ tx, ctx, repo, record }) => {
    await reverseEntries(tx, ctx, repo, record.id, "cespite eliminato");
  },
};

export const BANK_STATUS = opts([
  ["open", "Da abbinare"],
  ["matched", "Abbinato"],
  ["ignored", "Ignorato"],
]);

/** A line of a bank statement, kept to be matched against payments. */
const bankTransaction: EntityDef = {
  key: "bank_transaction",
  module: "erp",
  label: "Movimento bancario",
  plural: "Movimenti bancari",
  table: "bank_transactions",
  title: (r) => `${r["date"]} ${r["description"]}`,
  defaultOrder: "date desc",
  fields: [
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
      name: "amount",
      label: "Importo (+ entrata, − uscita)",
      type: "money",
      required: true,
      list: true,
    },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: BANK_STATUS,
      required: true,
      default: "open",
      list: true,
    },
    { name: "payment_id", label: "Pagamento abbinato", type: "ref", ref: "payment" },
    { name: "import_key", label: "Chiave di importazione", type: "text", hidden: true },
    { name: "notes", label: "Note", type: "text" },
  ],
  beforeSave: ({ record }) => {
    if (Number(record["amount"]) === 0)
      throw new ValidationError({ amount: "L'importo non può essere zero" });
    if (record["status"] === "matched" && !record["payment_id"])
      throw new ValidationError({ payment_id: "Un movimento abbinato indica il pagamento" });
    if (record["status"] !== "matched" && record["payment_id"])
      throw new ValidationError({ status: "Con un pagamento abbinato lo stato è «Abbinato»" });
  },
};

export const VAT_PERIODICITY = opts([
  ["monthly", "Mensile"],
  ["quarterly", "Trimestrale"],
]);

/** A registered periodic VAT settlement (liquidazione periodica). */
const vatSettlement: EntityDef = {
  key: "vat_settlement",
  module: "erp",
  label: "Liquidazione IVA",
  plural: "Liquidazioni IVA",
  table: "vat_settlements",
  title: (r) =>
    `IVA ${r["year"]} · ${r["period_kind"] === "monthly" ? "mese" : "trimestre"} ${r["period"]}`,
  defaultOrder: "date_to desc",
  noDelete: false,
  fields: [
    {
      name: "year",
      label: "Anno",
      type: "integer",
      required: true,
      min: 2000,
      max: 2100,
      list: true,
    },
    {
      name: "period_kind",
      label: "Periodicità",
      type: "select",
      options: VAT_PERIODICITY,
      required: true,
      list: true,
    },
    {
      name: "period",
      label: "Periodo",
      type: "integer",
      required: true,
      min: 1,
      max: 12,
      unique: ["year", "period_kind"],
      list: true,
    },
    { name: "date_from", label: "Dal", type: "date", required: true },
    { name: "date_to", label: "Al", type: "date", required: true, list: true },
    { name: "sales_vat", label: "IVA sulle vendite", type: "money", required: true },
    { name: "purchases_vat", label: "IVA sugli acquisti", type: "money", required: true },
    { name: "previous_credit", label: "Credito del periodo precedente", type: "money", default: 0 },
    { name: "previous_debit", label: "Debito precedente riportato", type: "money", default: 0 },
    { name: "interest", label: "Interessi trimestrali 1%", type: "money", default: 0 },
    { name: "due", label: "Da versare", type: "money", default: 0, list: true },
    { name: "credit_forward", label: "Credito da riportare", type: "money", default: 0 },
    { name: "debit_forward", label: "Debito sotto soglia da riportare", type: "money", default: 0 },
    { name: "notes", label: "Note", type: "longtext" },
  ],
  beforeDelete: async ({ tx, ctx, repo, record }) => {
    await reverseEntries(tx, ctx, repo, record.id, "liquidazione IVA eliminata");
  },
};

export const PAYSLIP_STATUS = opts([
  ["draft", "Bozza"],
  ["registered", "Registrato"],
  ["paid", "Pagato"],
]);
export const PUNCH_SOURCES = opts([
  ["manual", "Manuale"],
  ["import", "Importato dal timbratore"],
]);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Payslip ids whose status is being moved by `registerPayslip` / `payPayslip`. */
export const payrolling = new Set<string>();

/** One working day of one employee: clock-in, clock-out and break. */
const attendance: EntityDef = {
  key: "attendance",
  module: "erp",
  label: "Presenza",
  plural: "Presenze",
  table: "attendances",
  title: (r) => `${r["date"]} ${r["clock_in"]}–${r["clock_out"]}`,
  defaultOrder: "date desc",
  fields: [
    {
      name: "employee_id",
      label: "Dipendente",
      type: "ref",
      ref: "employee",
      required: true,
      list: true,
    },
    {
      name: "date",
      label: "Giorno",
      type: "date",
      required: true,
      unique: ["employee_id"],
      list: true,
    },
    { name: "clock_in", label: "Entrata (HH:MM)", type: "text", required: true, list: true },
    { name: "clock_out", label: "Uscita (HH:MM)", type: "text", required: true, list: true },
    { name: "break_minutes", label: "Pausa (minuti)", type: "integer", default: 0, min: 0 },
    {
      name: "worked_minutes",
      label: "Minuti lavorati",
      type: "integer",
      readonly: true,
      list: true,
    },
    {
      name: "source",
      label: "Origine",
      type: "select",
      options: PUNCH_SOURCES,
      default: "manual",
    },
    { name: "notes", label: "Note", type: "text" },
  ],
  beforeSave: ({ record }) => {
    const errors: Record<string, string> = {};
    const inn = String(record["clock_in"] ?? "");
    const out = String(record["clock_out"] ?? "");
    if (!TIME.test(inn)) errors["clock_in"] = "Usa il formato HH:MM (es. 08:30)";
    if (!TIME.test(out)) errors["clock_out"] = "Usa il formato HH:MM (es. 17:30)";
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const span = minutes(out) - minutes(inn);
    if (span <= 0) throw new ValidationError({ clock_out: "L'uscita deve essere dopo l'entrata" });
    const pause = Number(record["break_minutes"] ?? 0);
    if (pause >= span) throw new ValidationError({ break_minutes: "La pausa supera la presenza" });
    record["worked_minutes"] = span - pause;
  },
};

/** A monthly payroll statement (prospetto gestionale). Not the official pay slip. */
const payslip: EntityDef = {
  key: "payslip",
  module: "erp",
  label: "Busta paga",
  plural: "Buste paga",
  table: "payslips",
  title: (r) => `Busta paga ${r["period"]}`,
  defaultOrder: "period desc",
  fields: [
    {
      name: "employee_id",
      label: "Dipendente",
      type: "ref",
      ref: "employee",
      required: true,
      list: true,
    },
    {
      name: "period",
      label: "Mese (AAAA-MM)",
      type: "text",
      required: true,
      unique: ["employee_id"],
      list: true,
    },
    { name: "base_pay", label: "Retribuzione base", type: "money", required: true, min: 0 },
    { name: "overtime_pay", label: "Straordinario", type: "money", default: 0, min: 0 },
    { name: "other_pay", label: "Altre competenze", type: "money", default: 0, min: 0 },
    { name: "reimbursements", label: "Rimborsi non imponibili", type: "money", default: 0, min: 0 },
    { name: "gross", label: "Lordo", type: "money", readonly: true, list: true },
    {
      name: "contrib_employee_pct",
      label: "Contributi dipendente %",
      type: "percent",
      default: 0,
      min: 0,
      max: 100,
    },
    {
      name: "contrib_employer_pct",
      label: "Contributi azienda %",
      type: "percent",
      default: 0,
      min: 0,
      max: 100,
    },
    { name: "tax_pct", label: "Ritenuta IRPEF %", type: "percent", default: 0, min: 0, max: 100 },
    { name: "contrib_employee", label: "Contributi dipendente", type: "money", readonly: true },
    { name: "contrib_employer", label: "Contributi azienda", type: "money", readonly: true },
    { name: "income_tax", label: "Ritenuta IRPEF", type: "money", readonly: true },
    { name: "net", label: "Netto in busta", type: "money", readonly: true, list: true },
    { name: "total_cost", label: "Costo azienda", type: "money", readonly: true },
    {
      name: "status",
      label: "Stato",
      type: "select",
      options: PAYSLIP_STATUS,
      required: true,
      default: "draft",
      list: true,
    },
    { name: "paid_date", label: "Pagata il", type: "date" },
    { name: "notes", label: "Note", type: "text" },
  ],
  beforeSave: ({ record, before }) => {
    if (before && before["status"] !== "draft" && !payrolling.has(record.id))
      throw new LockedError(
        "Una busta paga registrata non si modifica: eliminala (storno) e rifalla",
      );
    const period = String(record["period"] ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
      throw new ValidationError({ period: "Usa il formato AAAA-MM (es. 2026-03)" });
    Object.assign(
      record,
      computePayslip({
        basePay: Number(record["base_pay"] ?? 0),
        overtimePay: Number(record["overtime_pay"] ?? 0),
        otherPay: Number(record["other_pay"] ?? 0),
        reimbursements: Number(record["reimbursements"] ?? 0),
        employeePct: Number(record["contrib_employee_pct"] ?? 0),
        employerPct: Number(record["contrib_employer_pct"] ?? 0),
        taxPct: Number(record["tax_pct"] ?? 0),
      }),
    );
  },
  beforeDelete: async ({ tx, ctx, repo, record }) => {
    if (record["status"] === "paid")
      throw new ConflictError("La busta paga è già stata pagata: non si può eliminare");
    await reverseEntries(tx, ctx, repo, record.id, "busta paga eliminata");
  },
};

export const ERP_ENTITIES: EntityDef[] = [
  ACCOUNT,
  JOURNAL_ENTRY,
  JOURNAL_LINE,
  product,
  document,
  documentLine,
  payment,
  warehouse,
  stockLot,
  stockMovement,
  employee,
  leave,
  project,
  timeEntry,
  attachment,
  fixedAsset,
  bankTransaction,
  vatSettlement,
  attendance,
  payslip,
];

export type { Rec };
