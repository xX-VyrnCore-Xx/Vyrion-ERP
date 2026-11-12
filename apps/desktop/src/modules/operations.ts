import type { SqlRunner } from "../data/db";
import type { Ctx, Rec } from "../data/entity";
import { ConflictError, NotFoundError, ValidationError } from "../data/errors";
import type { EntityRepository } from "../data/repository";
import { ACC, ensureAccount, postEntry } from "./accounting";
import { getCompany } from "./company";
import {
  computeTotals,
  extrasFromRecord,
  dueDate,
  isFiscal,
  isSalesFiscal,
  lineNet,
  type DocType,
  type LineInput,
  type Totals,
  type TotalsExtras,
} from "./documents";
import { issuing } from "./erp";
import { allocateFefo, lotForDocument } from "./stock";

type RepoOf = (key: string) => EntityRepository;

export interface DocumentLineInput extends LineInput {
  product_id?: string | null;
  description: string;
  unit?: string | null;
}

export interface SaveDocumentInput {
  id?: string;
  header: Record<string, unknown>;
  lines: DocumentLineInput[];
}

const PREFIX: Partial<Record<DocType, string>> = {
  quote: "PR",
  order: "OR",
  invoice: "FT",
  credit_note: "NC",
};

/**
 * Next number of a series, with no gaps: the counter moves inside the caller's
 * transaction, so a failure that rolls the document back rolls the number back too.
 * Fiscal series must also keep dates in order (a number cannot carry an earlier date
 * than the previous one).
 */
export async function nextNumber(
  tx: SqlRunner,
  series: string,
  year: string,
  date: string,
  ordered: boolean,
): Promise<number> {
  const key = `${series}:${year}`;
  await tx.execute(
    `INSERT INTO number_sequences (key, last, last_date) VALUES (?, 0, NULL) ON CONFLICT(key) DO NOTHING`,
    [key],
  );
  const [row] = await tx.query<{ last: number; last_date: string | null }>(
    "SELECT last, last_date FROM number_sequences WHERE key = ?",
    [key],
  );
  if (ordered && row?.last_date && date < row.last_date) {
    throw new ConflictError(
      `Esiste già un documento con data ${row.last_date}: la numerazione deve seguire l'ordine delle date`,
    );
  }
  await tx.execute("UPDATE number_sequences SET last = last + 1, last_date = ? WHERE key = ?", [
    date,
    key,
  ]);
  return (row?.last ?? 0) + 1;
}

const formatNumber = (type: DocType, year: string, n: number): string =>
  `${PREFIX[type]} ${year}/${String(n).padStart(4, "0")}`;

/**
 * Cassa, withholding and split payment settings of a document, checked against the rules that
 * make them (in)compatible: no withholding in the flat-rate regime, split payment only on sales
 * with VAT and never together with a withholding.
 */
export function extrasOf(
  doc: Record<string, unknown>,
  regime: "forfettario" | "ordinario",
  type: DocType,
): TotalsExtras {
  const rate = Number(doc["withholding_rate"] ?? 0) || 0;
  const split = Boolean(doc["split_payment"]);
  if (rate > 0 && regime === "forfettario")
    throw new ValidationError({
      withholding_rate: "Nel regime forfettario non si applica la ritenuta d'acconto",
    });
  if (split && type !== "invoice" && type !== "credit_note" && type !== "quote" && type !== "order")
    throw new ValidationError({ split_payment: "Lo split payment riguarda solo le vendite" });
  if (split && regime === "forfettario")
    throw new ValidationError({ split_payment: "Senza IVA non c'è scissione dei pagamenti" });
  if (split && rate > 0)
    throw new ValidationError({
      split_payment: "Lo split payment non si applica a operazioni soggette a ritenuta",
    });
  return extrasFromRecord(doc);
}

/** The cassa, withholding and split-payment choices a derived document inherits. */
export function carriedOver(source: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "cassa_rate",
    "withholding_rate",
    "withholding_base_pct",
    "withholding_on_cassa",
    "split_payment",
  ];
  return Object.fromEntries(
    keys.filter((k) => source[k] !== null && source[k] !== undefined).map((k) => [k, source[k]]),
  );
}

/** Writes a document and its lines in one go, with totals computed from the lines. */
export async function saveDocument(
  tx: SqlRunner,
  ctx: Ctx,
  repo: RepoOf,
  input: SaveDocumentInput,
): Promise<Rec> {
  const documents = repo("document");
  const existing = input.id ? await documents.require(tx, input.id) : null;
  const company = await getCompany(tx);
  if (!company) throw new ConflictError("Completa prima i dati dell'azienda nelle impostazioni");

  const regime =
    (existing?.["tax_regime"] as "forfettario" | "ordinario" | undefined) ?? company.regime;
  const type = (existing?.["type"] ?? input.header["type"]) as DocType;
  if (input.lines.length === 0) throw new ValidationError({ lines: "Aggiungi almeno una riga" });

  const lines = input.lines.map((line, index) => {
    const rate = regime === "forfettario" ? 0 : line.vat_rate;
    if (
      rate === 0 &&
      regime === "ordinario" &&
      type !== "quote" &&
      type !== "order" &&
      !line.vat_nature
    ) {
      throw new ValidationError({
        [`lines.${index}.vat_nature`]: "Indica la natura dell'operazione senza IVA",
      });
    }
    return { ...line, vat_rate: rate };
  });
  const merged = { ...(existing ?? {}), ...input.header } as Record<string, unknown>;
  const extras = extrasOf(merged, regime, type);
  const totals = computeTotals(lines, regime, extras);

  const header: Record<string, unknown> = {
    ...input.header,
    tax_regime: regime,
    net_total: totals.net,
    vat_total: totals.vat,
    stamp_duty: totals.stamp,
    cassa_amount: totals.cassa,
    withholding_amount: totals.withholding,
    total: totals.total,
    payable: totals.payable,
  };
  if (type === "quote" || type === "order") {
    // Non-fiscal documents are numbered when they are first saved.
    if (!existing) {
      const year = String(header["date"] ?? ctx.today()).slice(0, 4);
      header["number"] = formatNumber(
        type,
        year,
        await nextNumber(tx, type, year, ctx.today(), false),
      );
    }
  }

  const doc = existing
    ? await documents.update(tx, ctx, existing.id, header)
    : await documents.create(tx, ctx, { status: "draft", ...header });

  const lineRepo = repo("document_line");
  const old = await lineRepo.list(tx, { filters: { document_id: doc.id }, limit: 1000 });
  for (const row of old.rows) await lineRepo.remove(tx, ctx, row.id);
  let position = 1;
  for (const line of lines) {
    await lineRepo.create(tx, ctx, {
      document_id: doc.id,
      position: position++,
      product_id: line.product_id ?? null,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit ?? null,
      unit_price: line.unit_price,
      discount: line.discount ?? 0,
      vat_rate: line.vat_rate,
      vat_nature:
        regime === "forfettario" ? "N2.2" : line.vat_rate === 0 ? (line.vat_nature ?? null) : null,
      net_amount: lineNet(line),
    });
  }
  return doc;
}

async function loadLines(tx: SqlRunner, documentId: string): Promise<Rec[]> {
  const rows = await tx.query(
    `SELECT id, product_id, description, quantity, unit, unit_price, discount, vat_rate, vat_nature, net_amount
     FROM document_lines WHERE document_id = ? AND deleted_at IS NULL ORDER BY position`,
    [documentId],
  );
  return rows as unknown as Rec[];
}

/**
 * Issues a sales invoice, credit note or purchase invoice: assigns the number (sales
 * only), freezes it, moves stock and posts the accounting entry, all in one transaction.
 */
export async function issueDocument(
  tx: SqlRunner,
  ctx: Ctx,
  repo: RepoOf,
  id: string,
  date?: string,
): Promise<Rec> {
  const documents = repo("document");
  const doc = await documents.require(tx, id);
  const type = doc["type"] as DocType;
  if (!isFiscal(type)) throw new ConflictError("Solo fatture e note di credito si emettono");
  if (doc["status"] !== "draft") throw new ConflictError("Il documento è già stato emesso");
  const lines = await loadLines(tx, id);
  if (lines.length === 0) throw new ValidationError({ lines: "Il documento non ha righe" });

  const regime = doc["tax_regime"] as "forfettario" | "ordinario";
  const totals = computeTotals(
    lines.map((l) => ({
      quantity: Number(l["quantity"]),
      unit_price: Number(l["unit_price"]),
      discount: Number(l["discount"] ?? 0),
      vat_rate: Number(l["vat_rate"]),
      vat_nature: (l["vat_nature"] as string | null) ?? null,
    })),
    regime,
    extrasOf(doc, regime, doc["type"] as DocType),
  );
  if (
    totals.total !== Number(doc["total"]) ||
    totals.payable !== Number(doc["payable"] ?? doc["total"])
  )
    throw new ConflictError("I totali non coincidono con le righe: salva di nuovo il documento");
  if (totals.total <= 0) throw new ValidationError({ total: "Il totale deve essere positivo" });

  const issueDate = date ?? ctx.today();
  const [party] = await tx.query<{ payment_terms_days: number | null; name: string }>(
    "SELECT payment_terms_days, name FROM parties WHERE id = ?",
    [doc["party_id"] as string],
  );
  if (!party) throw new NotFoundError("Anagrafica");

  const patch: Record<string, unknown> = {
    status: "issued",
    date: issueDate,
    due_date:
      (doc["due_date"] as string | null) ?? dueDate(issueDate, party.payment_terms_days ?? 30),
  };
  if (isSalesFiscal(type)) {
    const year = issueDate.slice(0, 4);
    patch["number"] = formatNumber(type, year, await nextNumber(tx, type, year, issueDate, true));
  } else if (!doc["number"]) {
    throw new ValidationError({ number: "Inserisci il numero della fattura del fornitore" });
  }

  issuing.add(id);
  let issued: Rec;
  try {
    issued = await documents.update(tx, ctx, id, patch);
  } finally {
    issuing.delete(id);
  }

  await moveStock(tx, ctx, repo, issued, lines);
  await postDocument(tx, ctx, repo, issued, totals);
  return issued;
}

async function moveStock(
  tx: SqlRunner,
  ctx: Ctx,
  repo: RepoOf,
  doc: Rec,
  lines: Rec[],
): Promise<void> {
  const type = doc["type"] as DocType;
  // Sales take goods out, credit notes and purchases bring them in.
  const sign = type === "invoice" ? -1 : 1;
  for (const line of lines) {
    if (!line["product_id"]) continue;
    const productId = line["product_id"] as string;
    const [item] = await tx.query<{ track_stock: number; track_lots: number }>(
      "SELECT track_stock, track_lots FROM products WHERE id = ?",
      [productId],
    );
    if (!item?.track_stock) continue;
    const quantity = sign * Number(line["quantity"]);
    const reason =
      `${type === "invoice" ? "Vendita" : type === "credit_note" ? "Reso" : "Acquisto"} ${doc["number"] ?? ""}`.trim();
    const base = {
      product_id: productId,
      date: doc["date"],
      reason,
      document_id: doc.id,
    };
    const unitCost = type === "purchase_invoice" ? Number(line["unit_price"]) : 0;
    if (!item.track_lots) {
      await repo("stock_movement").create(tx, ctx, {
        ...base,
        kind: quantity < 0 ? "out" : "in",
        quantity,
        unit_cost: unitCost,
      });
    } else if (quantity < 0) {
      // A sale of lot-tracked goods takes from the lots that expire first.
      for (const pick of await allocateFefo(tx, productId, -quantity)) {
        await repo("stock_movement").create(tx, ctx, {
          ...base,
          kind: "out",
          quantity: -pick.quantity,
          unit_cost: 0,
          lot_id: pick.lotId,
        });
      }
    } else {
      // Goods received on a document go into a lot named after it (add expiry on the lot).
      const lotId = await lotForDocument(
        tx,
        ctx,
        repo,
        productId,
        String(doc["number"] ?? doc.id.slice(0, 8)),
      );
      await repo("stock_movement").create(tx, ctx, {
        ...base,
        kind: "in",
        quantity,
        unit_cost: unitCost,
        lot_id: lotId,
      });
    }
  }
}

async function postDocument(
  tx: SqlRunner,
  ctx: Ctx,
  repo: RepoOf,
  doc: Rec,
  totals: Totals,
): Promise<void> {
  const type = doc["type"] as DocType;
  const { stamp, vat, withholding, splitVat, payable } = totals;
  // Revenue (or cost) is what the lines and the cassa add up to; the stamp is booked apart.
  const net = totals.net + totals.cassa;
  const description = `${doc["number"]} · ${(await tx.query<{ name: string }>("SELECT name FROM parties WHERE id = ?", [doc["party_id"] as string]))[0]?.name ?? ""}`;
  if (withholding > 0) {
    await ensureAccount(
      tx,
      ctx,
      repo,
      type === "purchase_invoice" ? ACC.withholdingToPay : ACC.withholdingSuffered,
    );
  }
  // With split payment the seller never receives (nor owes) the VAT: it stays out of the books.
  const bookedVat = vat - splitVat;
  const lines =
    type === "invoice"
      ? [
          { account: ACC.receivables, debit: payable },
          { account: ACC.withholdingSuffered, debit: withholding },
          { account: ACC.revenue, credit: net },
          { account: ACC.vatDebit, credit: bookedVat },
          { account: ACC.stampRefund, credit: stamp },
        ]
      : type === "credit_note"
        ? [
            { account: ACC.receivables, credit: payable },
            { account: ACC.withholdingSuffered, credit: withholding },
            { account: ACC.revenue, debit: net },
            { account: ACC.vatDebit, debit: bookedVat },
            { account: ACC.stampRefund, debit: stamp },
          ]
        : [
            { account: ACC.costs, debit: net + stamp },
            { account: ACC.vatCredit, debit: vat },
            { account: ACC.payables, credit: payable },
            { account: ACC.withholdingToPay, credit: withholding },
          ];
  await postEntry(tx, ctx, repo, {
    date: doc["date"] as string,
    description,
    source: "document",
    sourceId: doc.id,
    lines,
  });
}

/** Creates the next document in the chain (quote → order → invoice) copying lines and customer. */
export async function convertDocument(
  tx: SqlRunner,
  ctx: Ctx,
  repo: RepoOf,
  id: string,
  to: "order" | "invoice",
): Promise<Rec> {
  const documents = repo("document");
  const source = await documents.require(tx, id);
  const from = source["type"] as DocType;
  const allowed = to === "order" ? from === "quote" : from === "quote" || from === "order";
  if (!allowed) throw new ConflictError("Conversione non prevista per questo tipo di documento");
  if (source["status"] === "invoiced")
    throw new ConflictError("Il documento è già stato fatturato");
  if (from === "quote" && source["status"] !== "accepted")
    throw new ConflictError("Il preventivo deve essere accettato");
  if (source["status"] === "rejected" || source["status"] === "cancelled")
    throw new ConflictError("Il documento non è valido per la conversione");

  const lines = (await loadLines(tx, id)).map((l) => ({
    product_id: (l["product_id"] as string | null) ?? null,
    description: String(l["description"]),
    quantity: Number(l["quantity"]),
    unit: (l["unit"] as string | null) ?? null,
    unit_price: Number(l["unit_price"]),
    discount: Number(l["discount"] ?? 0),
    vat_rate: Number(l["vat_rate"]),
    vat_nature: (l["vat_nature"] as string | null) ?? null,
  }));
  const created = await saveDocument(tx, ctx, repo, {
    header: {
      type: to,
      date: ctx.today(),
      party_id: source["party_id"],
      source_id: source.id,
      notes: source["notes"],
      status: "draft",
      ...carriedOver(source),
    },
    lines,
  });
  await documents.update(tx, ctx, id, { status: to === "invoice" ? "invoiced" : source["status"] });
  return created;
}
