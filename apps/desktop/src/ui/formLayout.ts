import type { FieldDef } from "../data/entity";

/**
 * How wide each field is on the 12-column grid of a form. A field gets a natural width from
 * what it holds (a postcode is narrow, a name takes the row), the fields are packed into rows,
 * and every row is then stretched to the full width so no row ends with a hole.
 */

/** Every class written out in full, so the stylesheet builder sees them. */
const COLS: Record<number, string> = {
  1: "sm:col-span-1",
  2: "sm:col-span-2",
  3: "sm:col-span-3",
  4: "sm:col-span-4",
  5: "sm:col-span-5",
  6: "sm:col-span-6",
  7: "sm:col-span-7",
  8: "sm:col-span-8",
  9: "sm:col-span-9",
  10: "sm:col-span-10",
  11: "sm:col-span-11",
  12: "sm:col-span-12",
};

const FULL = new Set([
  "name",
  "title",
  "subject",
  "summary",
  "address",
  "description",
  "notes",
  "iban",
]);
const BY_NAME: Record<string, number> = {
  zip: 4,
  city: 8,
  province: 4,
  country: 8,
  sdi_code: 4,
  pec: 8,
  currency: 4,
  unit: 4,
  port: 4,
  position: 4,
};

export function naturalSpan(field: FieldDef): number {
  if (field.type === "longtext" || FULL.has(field.name)) return 12;
  const named = BY_NAME[field.name];
  if (named) return named;
  switch (field.type) {
    case "date":
    case "datetime":
    case "money":
    case "percent":
    case "integer":
    case "decimal":
      return 4;
    case "text":
      return (field.maxLength ?? 99) <= 10 ? 4 : 6;
    default:
      return 6;
  }
}

/** Stretches a row's spans to 12 columns, keeping their proportions. */
function stretch(spans: number[]): number[] {
  const sum = spans.reduce((a, b) => a + b, 0);
  if (sum >= 12 || spans.length === 0) return spans;
  const scaled = spans.map((s) => Math.floor((s * 12) / sum));
  let left = 12 - scaled.reduce((a, b) => a + b, 0);
  // hand the remainder to the widest fields first
  const order = spans.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) {
    const target = order[k];
    if (target) scaled[target[1]] = (scaled[target[1]] ?? 0) + 1;
  }
  return scaled;
}

export interface PlacedField {
  field: FieldDef;
  /** Tailwind classes for the grid cell (full width on a phone). */
  className: string;
}

export function layoutFields(fields: FieldDef[]): PlacedField[] {
  const rows: FieldDef[][] = [];
  let row: FieldDef[] = [];
  let used = 0;
  for (const field of fields) {
    const span = naturalSpan(field);
    if (used + span > 12 && row.length) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(field);
    used += span;
  }
  if (row.length) rows.push(row);
  return rows.flatMap((r) => {
    const spans = stretch(r.map(naturalSpan));
    return r.map((field, i) => ({
      field,
      className: `col-span-12 ${COLS[spans[i] ?? 12] ?? COLS[12]}`,
    }));
  });
}
