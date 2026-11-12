/**
 * A printable PDF of a document (quote, order, invoice, credit note, purchase invoice).
 *
 * For invoices this is a courtesy copy: the legally valid invoice is the electronic one sent
 * through the Sistema di Interscambio, and the PDF says so.
 */

import type { Rec } from "../data/entity";
import type { Workspace } from "../data/workspace";
import { A4, Pdf } from "../lib/pdf";
import { formatMoney } from "../lib/money";
import { formatDay } from "../ui/format";
import { getCompany } from "./company";
import {
  DOC_STATUS,
  DOC_TYPES,
  computeTotals,
  extrasFromRecord,
  isFiscal,
  type DocType,
} from "./documents";

const MARGIN = 42;
const RIGHT = A4.width - MARGIN;
const BOTTOM = 70;

const label = (options: { value: string; label: string }[], value: unknown): string =>
  options.find((o) => o.value === value)?.label ?? String(value ?? "");

const pct = (n: number): string => `${String(n).replace(".", ",")}%`;
const qty = (n: number): string => String(n).replace(".", ",");

const FORFETTARIO_NOTE =
  "Operazione senza applicazione dell'IVA ai sensi dell'art. 1, commi 54-89, Legge n. 190/2014 (regime forfettario).";

export interface DocumentPdf {
  fileName: string;
  content: string;
}

export async function buildDocumentPdf(ws: Workspace, documentId: string): Promise<DocumentPdf> {
  const doc = await ws.get("document", documentId);
  if (!doc) throw new Error("Documento non trovato");
  const lineDef = ws.registry.get("document_line");
  const lines = (await ws.db.query(
    `SELECT * FROM ${lineDef.table} WHERE document_id = ? AND deleted_at IS NULL ORDER BY position`,
    [documentId],
  )) as unknown as Rec[];
  const party = await ws.get("party", String(doc["party_id"]));
  const company = await getCompany(ws.db);
  const type = String(doc["type"]) as DocType;
  const typeName = label(DOC_TYPES, type);
  const number = String(doc["number"] ?? "").trim();
  const draft = isFiscal(type) ? doc["status"] !== "issued" : false;
  const regime = (doc["tax_regime"] as "forfettario" | "ordinario" | null) ?? "ordinario";
  const totals = computeTotals(
    lines.map((l) => ({
      quantity: Number(l["quantity"]),
      unit_price: Number(l["unit_price"]),
      discount: Number(l["discount"] ?? 0),
      vat_rate: Number(l["vat_rate"]),
      vat_nature: (l["vat_nature"] as string | null) ?? null,
    })),
    regime,
    extrasFromRecord(doc),
  );

  const pdf = new Pdf();
  pdf.title = `${typeName} ${number || "(bozza)"}`;
  let y = A4.height - MARGIN;

  const footer = () => {
    pdf.line(MARGIN, 52, RIGHT, 52);
    const left =
      isFiscal(type) && type !== "purchase_invoice"
        ? "Copia di cortesia: la fattura valida ai fini fiscali è quella elettronica trasmessa tramite SDI."
        : `${typeName}${number ? ` n. ${number}` : ""}`;
    pdf.text(MARGIN, 40, left, { size: 7.5, gray: 0.4 });
    pdf.text(RIGHT, 40, `Pagina ${pdf.page}`, { size: 7.5, gray: 0.4, align: "right" });
  };
  const newPage = () => {
    footer();
    pdf.addPage();
    y = A4.height - MARGIN;
  };
  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) newPage();
  };

  // --- sender and title ---
  pdf.text(MARGIN, y - 14, String(company?.name ?? "Azienda"), { size: 16, bold: true });
  y -= 30;
  const senderLines = [
    [
      company?.["address"],
      [
        company?.["zip"],
        company?.["city"],
        company?.["province"] ? `(${String(company["province"])})` : "",
      ]
        .filter(Boolean)
        .join(" "),
    ]
      .filter(Boolean)
      .join(" - "),
    company?.["vat_number"] ? `P.IVA ${String(company["vat_number"])}` : "",
    company?.["tax_code"] ? `C.F. ${String(company["tax_code"])}` : "",
    [company?.["email"], company?.["phone"]].filter(Boolean).join(" - "),
  ].filter(Boolean);
  for (const line of senderLines) {
    pdf.text(MARGIN, y, String(line), { size: 9, gray: 0.25 });
    y -= 12;
  }
  const titleY = A4.height - MARGIN - 14;
  pdf.text(RIGHT, titleY, typeName.toUpperCase(), { size: 18, bold: true, align: "right" });
  pdf.text(RIGHT, titleY - 18, number ? `n. ${number}` : "senza numero", {
    size: 11,
    align: "right",
  });
  pdf.text(RIGHT, titleY - 32, `del ${formatDay(String(doc["date"]))}`, {
    size: 10,
    align: "right",
  });
  if (draft || (!isFiscal(type) && doc["status"] === "draft")) {
    pdf.text(RIGHT, titleY - 48, "BOZZA", { size: 11, bold: true, align: "right", gray: 0.5 });
  } else {
    pdf.text(RIGHT, titleY - 48, label(DOC_STATUS, doc["status"]), {
      size: 9,
      align: "right",
      gray: 0.4,
    });
  }
  y = Math.min(y, titleY - 60) - 14;

  // --- recipient ---
  pdf.rect(MARGIN, y - 78, RIGHT - MARGIN, 82, 0.96);
  pdf.text(MARGIN + 10, y - 14, type === "purchase_invoice" ? "Fornitore" : "Spett.le", {
    size: 8,
    gray: 0.45,
  });
  const partyLines: string[] = party
    ? [
        String(party["name"]),
        String(party["address"] ?? ""),
        [party["zip"], party["city"], party["province"] ? `(${String(party["province"])})` : ""]
          .filter(Boolean)
          .join(" "),
        [
          party["vat_number"] ? `P.IVA ${String(party["vat_number"])}` : "",
          party["tax_code"] ? `C.F. ${String(party["tax_code"])}` : "",
        ]
          .filter(Boolean)
          .join("   "),
        [
          party["sdi_code"] ? `Codice SDI ${String(party["sdi_code"])}` : "",
          party["pec"] ? `PEC ${String(party["pec"])}` : "",
        ]
          .filter(Boolean)
          .join("   "),
      ].filter(Boolean)
    : ["—"];
  let py = y - 27;
  partyLines.slice(0, 5).forEach((l, i) => {
    pdf.text(MARGIN + 10, py, l, { size: i === 0 ? 11 : 9, bold: i === 0 });
    py -= i === 0 ? 14 : 11.5;
  });
  y -= 98;

  // --- lines ---
  const col = {
    desc: MARGIN + 4,
    qty: 335,
    unit: 350,
    price: 425,
    disc: 462,
    vat: 497,
    amount: RIGHT - 4,
  };
  const header = () => {
    pdf.rect(MARGIN, y - 16, RIGHT - MARGIN, 18, 0.9);
    const s = { size: 8, bold: true } as const;
    pdf.text(col.desc, y - 11, "Descrizione", s);
    pdf.text(col.qty, y - 11, "Q.tà", { ...s, align: "right" });
    pdf.text(col.unit, y - 11, "U.m.", s);
    pdf.text(col.price, y - 11, "Prezzo", { ...s, align: "right" });
    pdf.text(col.disc, y - 11, "Sc.", { ...s, align: "right" });
    pdf.text(col.vat, y - 11, "IVA", { ...s, align: "right" });
    pdf.text(col.amount, y - 11, "Importo", { ...s, align: "right" });
    y -= 22;
  };
  header();
  for (const l of lines) {
    const wrapped = pdf.wrap(String(l["description"]), col.qty - 60 - col.desc, 9);
    const height = wrapped.length * 11 + 6;
    if (y - height < BOTTOM) {
      newPage();
      header();
    }
    wrapped.forEach((w, i) => pdf.text(col.desc, y - 9 - i * 11, w, { size: 9 }));
    const top = y - 9;
    pdf.text(col.qty, top, qty(Number(l["quantity"])), { size: 9, align: "right" });
    pdf.text(col.unit, top, String(l["unit"] ?? ""), { size: 9 });
    pdf.text(col.price, top, formatMoney(Number(l["unit_price"])), { size: 9, align: "right" });
    pdf.text(col.disc, top, Number(l["discount"] ?? 0) ? pct(Number(l["discount"])) : "", {
      size: 9,
      align: "right",
    });
    pdf.text(col.vat, top, regime === "forfettario" ? "—" : pct(Number(l["vat_rate"])), {
      size: 9,
      align: "right",
    });
    pdf.text(col.amount, top, formatMoney(Number(l["net_amount"] ?? 0)), {
      size: 9,
      align: "right",
    });
    y -= height;
    pdf.line(MARGIN, y + 2, RIGHT, y + 2, 0.3, 0.85);
  }

  // --- totals ---
  const rows: [string, string, boolean][] = [["Imponibile", formatMoney(totals.net), false]];
  if (totals.cassa > 0)
    rows.push([
      `Cassa previdenziale ${pct(Number(doc["cassa_rate"]))}`,
      formatMoney(totals.cassa),
      false,
    ]);
  for (const b of totals.breakdown)
    rows.push([
      b.rate === 0
        ? `IVA esente${b.nature ? ` (${b.nature})` : ""}`
        : `IVA ${pct(b.rate)} su ${formatMoney(b.base)}`,
      formatMoney(b.vat),
      false,
    ]);
  if (totals.stamp > 0) rows.push(["Imposta di bollo", formatMoney(totals.stamp), false]);
  rows.push([
    totals.payable !== totals.total ? "TOTALE DOCUMENTO" : "TOTALE",
    formatMoney(totals.total),
    totals.payable === totals.total,
  ]);
  if (totals.withholding > 0)
    rows.push([
      `Ritenuta d'acconto ${pct(Number(doc["withholding_rate"]))}`,
      `- ${formatMoney(totals.withholding)}`,
      false,
    ]);
  if (totals.splitVat > 0)
    rows.push([
      "IVA versata dall'ente (split payment)",
      `- ${formatMoney(totals.splitVat)}`,
      false,
    ]);
  if (totals.payable !== totals.total)
    rows.push([
      type === "purchase_invoice" ? "NETTO DA PAGARE" : "NETTO DA INCASSARE",
      formatMoney(totals.payable),
      true,
    ]);
  ensure(rows.length * 15 + 40);
  y -= 14;
  const labelX = 330;
  for (const [name, value, strong] of rows) {
    if (strong) pdf.rect(labelX - 8, y - 6, RIGHT - labelX + 8, 20, 0.9);
    pdf.text(labelX, y, name, { size: strong ? 11 : 9, bold: strong });
    pdf.text(RIGHT - 4, y, value, { size: strong ? 11 : 9, bold: strong, align: "right" });
    y -= strong ? 22 : 15;
  }

  // --- notes, payment, footer text ---
  const notes: string[] = [];
  if (regime === "forfettario" && isFiscal(type)) notes.push(FORFETTARIO_NOTE);
  if (totals.stamp > 0) notes.push("Imposta di bollo assolta in modo virtuale, ove dovuta.");
  if (totals.splitVat > 0)
    notes.push(
      "Operazione soggetta a scissione dei pagamenti ai sensi dell'art. 17-ter del DPR 633/1972: l'IVA è versata dal committente.",
    );
  if (totals.withholding > 0) notes.push("Operazione soggetta a ritenuta d'acconto.");
  if (doc["notes"]) notes.push(String(doc["notes"]));
  if (isFiscal(type) && doc["due_date"])
    notes.push(`Scadenza pagamento: ${formatDay(String(doc["due_date"]))}`);
  if (type === "quote" && doc["valid_until"])
    notes.push(`Valido fino al ${formatDay(String(doc["valid_until"]))}`);
  if (company?.["iban"] && (type === "invoice" || type === "quote" || type === "order"))
    notes.push(`Coordinate bancarie: IBAN ${String(company["iban"])}`);
  if (company?.["invoice_footer"] && type !== "purchase_invoice")
    notes.push(String(company["invoice_footer"]));
  if (notes.length > 0) {
    y -= 10;
    for (const note of notes) {
      for (const w of pdf.wrap(note, RIGHT - MARGIN, 8.5)) {
        ensure(12);
        pdf.text(MARGIN, y, w, { size: 8.5, gray: 0.2 });
        y -= 11;
      }
      y -= 3;
    }
  }
  footer();

  const safe = `${typeName}-${number || "bozza"}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  return { fileName: `${safe}.pdf`, content: pdf.build() };
}
