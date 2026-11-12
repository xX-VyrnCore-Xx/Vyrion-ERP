import type { FieldDef } from "../data/entity";

/**
 * How the form of some entities is split into titled sections. Fields that are not listed
 * go in a last "Altro" section, so nothing is ever left out; entities without an entry keep
 * the plain single block.
 */
const GROUPS: Record<string, { title: string; fields: string[] }[]> = {
  party: [
    { title: "Dati principali", fields: ["name", "kind", "legal_form"] },
    { title: "Dati fiscali", fields: ["vat_number", "tax_code", "sdi_code", "pec", "iban"] },
    { title: "Contatti", fields: ["email", "phone", "website"] },
    { title: "Indirizzo", fields: ["address", "zip", "city", "province", "country"] },
    { title: "Condizioni commerciali", fields: ["payment_terms_days", "hourly_rate"] },
    { title: "Note", fields: ["notes"] },
  ],
  employee: [
    {
      title: "Anagrafica",
      fields: ["first_name", "last_name", "role", "email", "phone", "hire_date", "end_date"],
    },
    { title: "Orario e costo", fields: ["weekly_hours", "hourly_cost"] },
    {
      title: "Retribuzione (prospetto paga)",
      fields: ["gross_monthly", "contrib_employee_pct", "contrib_employer_pct", "tax_pct"],
    },
    { title: "Note", fields: ["notes"] },
  ],
  product: [
    { title: "Identificazione", fields: ["sku", "name", "kind", "unit", "description"] },
    { title: "Prezzi e IVA", fields: ["sale_price", "purchase_price", "vat_rate"] },
    { title: "Magazzino", fields: ["track_stock", "track_lots", "min_stock"] },
  ],
};

export interface FieldSection {
  title: string | null;
  fields: FieldDef[];
}

export function sectionsFor(entity: string, fields: FieldDef[]): FieldSection[] {
  const groups = GROUPS[entity];
  if (!groups) return [{ title: null, fields }];
  const byName = new Map(fields.map((f) => [f.name, f]));
  const used = new Set<string>();
  const sections: FieldSection[] = [];
  for (const g of groups) {
    const list = g.fields.map((n) => byName.get(n)).filter((f): f is FieldDef => Boolean(f));
    list.forEach((f) => used.add(f.name));
    if (list.length) sections.push({ title: g.title, fields: list });
  }
  const rest = fields.filter((f) => !used.has(f.name));
  if (rest.length) sections.push({ title: "Altro", fields: rest });
  return sections;
}
