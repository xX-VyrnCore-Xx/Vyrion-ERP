/**
 * Money is stored and computed as an integer number of cents. Floating point numbers cannot
 * represent most decimal amounts exactly, and a ledger that is off by a cent is wrong.
 */

export type Cents = number;

/** "1.234,56" or "1234.56" or "1234" → 123456. Returns null for anything else. */
export function parseMoney(input: string): Cents | null {
  let text = input.trim().replace(/\s/g, "").replace(/€/g, "");
  if (text === "") return null;
  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  // Italian: dot groups thousands, comma is the decimal separator. Also accept 1234.56.
  const hasComma = text.includes(",");
  if (hasComma) text = text.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const euros = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = euros * 100 + fraction;
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

const formatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

export function formatMoney(cents: Cents): string {
  return formatter.format(cents / 100);
}

const plainFormatter = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** An amount in any currency: "1.220,00 USD" (euro keeps its symbol). */
export function formatCurrency(cents: Cents, currency: string | null | undefined): string {
  const code = (currency ?? "EUR").toUpperCase();
  return code === "EUR" ? formatMoney(cents) : `${plainFormatter.format(cents / 100)} ${code}`;
}

/** "1234.56" for forms and CSV exports: plain, no grouping, always two decimals. */
export function centsToPlain(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Percentage of an amount, rounded half away from zero to the nearest cent. */
export function percentOf(cents: Cents, percent: number): Cents {
  return roundCents((cents * percent) / 100);
}

export function roundCents(value: number): Cents {
  // Half away from zero; Math.round alone rounds -0.5 towards zero.
  const rounded = Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON * Math.abs(value));
  return rounded === 0 ? 0 : rounded;
}
