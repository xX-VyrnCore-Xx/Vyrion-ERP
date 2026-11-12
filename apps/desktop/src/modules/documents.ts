import { addDays } from "../lib/dates";
import { percentOf, roundCents, type Cents } from "../lib/money";
import { opts } from "./common";

export const DOC_TYPES = opts([
  ["quote", "Preventivo"],
  ["order", "Ordine"],
  ["invoice", "Fattura"],
  ["credit_note", "Nota di credito"],
  ["purchase_invoice", "Fattura di acquisto"],
]);
export type DocType = "quote" | "order" | "invoice" | "credit_note" | "purchase_invoice";

export const DOC_STATUS = opts([
  ["draft", "Bozza"],
  ["sent", "Inviato"],
  ["accepted", "Accettato"],
  ["rejected", "Rifiutato"],
  ["invoiced", "Fatturato"],
  ["cancelled", "Annullato"],
  ["issued", "Emessa"],
]);

/** Which statuses each document type may have. Invoices are only draft or issued. */
export const ALLOWED_STATUS: Record<DocType, string[]> = {
  quote: ["draft", "sent", "accepted", "rejected", "invoiced"],
  order: ["draft", "accepted", "invoiced", "cancelled"],
  invoice: ["draft", "issued"],
  credit_note: ["draft", "issued"],
  purchase_invoice: ["draft", "issued"],
};

export const FISCAL_TYPES: DocType[] = ["invoice", "credit_note", "purchase_invoice"];
export const isFiscal = (type: string): boolean => (FISCAL_TYPES as string[]).includes(type);
export const isSalesFiscal = (type: string): boolean =>
  type === "invoice" || type === "credit_note";

export const VAT_NATURES = opts([
  ["N1", "N1 · Escluse ex art. 15"],
  ["N2.1", "N2.1 · Non soggette (artt. 7-7-septies)"],
  ["N2.2", "N2.2 · Non soggette – regime forfettario"],
  ["N3.5", "N3.5 · Non imponibili – dichiarazioni d'intento"],
  ["N4", "N4 · Esenti"],
  ["N5", "N5 · Regime del margine"],
  ["N6.9", "N6.9 · Inversione contabile – altri casi"],
  ["N7", "N7 · IVA assolta in altro stato UE"],
]);

/** Stamp duty (bollo) on documents with exempt or non-taxable amounts above this base. */
export const STAMP_THRESHOLD: Cents = 7747;
export const STAMP_AMOUNT: Cents = 200;

export interface LineInput {
  quantity: number;
  unit_price: Cents;
  discount?: number | null;
  vat_rate: number;
  vat_nature?: string | null;
}

export interface VatBreakdown {
  rate: number;
  nature: string | null;
  base: Cents;
  vat: Cents;
}

export interface Totals {
  net: Cents;
  vat: Cents;
  stamp: Cents;
  /** Pension fund contribution (cassa previdenziale), added to the taxable base. */
  cassa: Cents;
  /** Document total: net + cassa + VAT + stamp duty. */
  total: Cents;
  /** Withholding tax (ritenuta d'acconto) held back from the payment. */
  withholding: Cents;
  /** VAT the customer pays directly to the tax authority (split payment). */
  splitVat: Cents;
  /** What is actually paid or collected: total − withholding − split VAT. */
  payable: Cents;
  breakdown: VatBreakdown[];
  /**
   * For a document in a foreign currency: the same totals in that currency (what the customer
   * is invoiced). The amounts above are then in euro, converted at the document's rate.
   */
  foreign?: Totals;
  currency?: string;
}

export interface TotalsExtras {
  /** Currency of the lines (default EUR) and its exchange rate: units of that currency per 1 EUR. */
  currency?: string | null;
  rate?: number | null;
  /** Cassa previdenziale, % of the lines. It follows the VAT of the lines it is computed on. */
  cassaRate?: number | null;
  /** Ritenuta d'acconto: rate, % of the base that is subject to it, and whether the cassa is in the base. */
  withholding?: { rate: number; basePct: number; onCassa: boolean } | null;
  /** Split payment (scissione dei pagamenti): the VAT is not collected by the seller. */
  split?: boolean;
}

export function lineNet(line: Pick<LineInput, "quantity" | "unit_price" | "discount">): Cents {
  return roundCents(line.quantity * line.unit_price * (1 - (line.discount ?? 0) / 100));
}

/**
 * Totals of a document. VAT is computed once per rate on the sum of the lines (the way the
 * electronic invoice reports it), not line by line, so rounding does not accumulate.
 * In the flat-rate regime there is no VAT at all (nature N2.2) and bollo applies above the
 * threshold; in the ordinary regime bollo applies to the exempt/non-taxable (N1–N4) base.
 */
export function computeTotals(
  lines: LineInput[],
  regime: "forfettario" | "ordinario",
  extras: TotalsExtras = {},
): Totals {
  const rate = extras.rate ?? 0;
  const currency = (extras.currency ?? "EUR").toUpperCase();
  if (currency === "EUR" || !(rate > 0)) return computeNative(lines, regime, extras);
  // Foreign currency: totals are computed in that currency (no stamp duty: it is a euro amount),
  // then each part is converted to euro so that the euro figures add up exactly.
  const native = computeNative(lines, regime, { ...extras, noStamp: true });
  const eur = (cents: Cents): Cents => Math.round(cents / rate);
  const net = eur(native.net);
  const cassa = eur(native.cassa);
  const vat = eur(native.vat);
  const withholding = eur(native.withholding);
  const splitVat = extras.split ? vat : 0;
  const total = net + cassa + vat;
  return {
    net,
    vat,
    stamp: 0,
    cassa,
    total,
    withholding,
    splitVat,
    payable: total - withholding - splitVat,
    breakdown: native.breakdown.map((g) => ({ ...g, base: eur(g.base), vat: eur(g.vat) })),
    foreign: native,
    currency,
  };
}

function computeNative(
  lines: LineInput[],
  regime: "forfettario" | "ordinario",
  extras: TotalsExtras & { noStamp?: boolean },
): Totals {
  const groups = new Map<string, VatBreakdown>();
  let net = 0;
  let stampBase = 0;
  for (const line of lines) {
    const amount = lineNet(line);
    net += amount;
    const rate = regime === "forfettario" ? 0 : line.vat_rate;
    const nature =
      rate === 0 ? (regime === "forfettario" ? "N2.2" : (line.vat_nature ?? null)) : null;
    const key = `${rate}|${nature ?? ""}`;
    const group = groups.get(key) ?? { rate, nature, base: 0, vat: 0 };
    group.base += amount;
    groups.set(key, group);
    if (rate === 0 && (regime === "forfettario" || (nature !== null && /^N[1-4]/.test(nature))))
      stampBase += amount;
  }
  const breakdown = [...groups.values()].sort((a, b) => b.rate - a.rate);
  // The cassa is computed on each group and taxed like it: its VAT rate is the group's.
  let cassa = 0;
  const cassaRate = extras.cassaRate ?? 0;
  if (cassaRate > 0) {
    for (const group of breakdown) {
      const part = percentOf(group.base, cassaRate);
      cassa += part;
      group.base += part;
    }
  }
  for (const group of breakdown) group.vat = percentOf(group.base, group.rate);
  const vat = breakdown.reduce((sum, g) => sum + g.vat, 0);
  const stamp = !extras.noStamp && stampBase > STAMP_THRESHOLD ? STAMP_AMOUNT : 0;
  const total = net + cassa + vat + stamp;
  const w = extras.withholding;
  // Withholding is on the fees (and the cassa, if so chosen), never on the VAT.
  const withholding =
    w && w.rate > 0 ? percentOf(percentOf(net + (w.onCassa ? cassa : 0), w.basePct), w.rate) : 0;
  const splitVat = extras.split ? vat : 0;
  return {
    net,
    vat,
    stamp,
    cassa,
    total,
    withholding,
    splitVat,
    payable: total - withholding - splitVat,
    breakdown,
  };
}

export function dueDate(issueDate: string, termsDays: number): string {
  return addDays(issueDate, Math.max(0, termsDays));
}

/** The cassa / withholding / split settings stored on a document, as the totals need them. */
export function extrasFromRecord(doc: Record<string, unknown>): TotalsExtras {
  const rate = Number(doc["withholding_rate"] ?? 0) || 0;
  return {
    cassaRate: Number(doc["cassa_rate"] ?? 0) || 0,
    withholding:
      rate > 0
        ? {
            rate,
            basePct: Number(doc["withholding_base_pct"] ?? 100),
            onCassa:
              doc["withholding_on_cassa"] === undefined || doc["withholding_on_cassa"] === null
                ? true
                : Boolean(doc["withholding_on_cassa"]),
          }
        : null,
    split: Boolean(doc["split_payment"]),
    currency: (doc["currency"] as string | null) ?? null,
    rate:
      doc["exchange_rate"] === null || doc["exchange_rate"] === undefined
        ? null
        : Number(doc["exchange_rate"]),
  };
}

/** The foreign currency of a document, or null when it is in euro. */
export function foreignCurrency(doc: Record<string, unknown>): string | null {
  const c = String(doc["currency"] ?? "EUR").toUpperCase();
  return c === "EUR" ? null : c;
}
