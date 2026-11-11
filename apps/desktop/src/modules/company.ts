import type { SqlRunner } from "../data/db";
import { validateInput, type EntityDef, type FieldDef } from "../data/entity";
import { getSetting, setSetting } from "../data/system";
import { iban, opts, taxCode, vatNumber } from "./common";
import { LEGAL_FORMS } from "./crm";

export const REGIMES = opts([
  ["forfettario", "Regime forfettario"],
  ["ordinario", "Regime ordinario"],
]);

/** The company that uses the app. Legal form and tax regime are independent choices. */
export const COMPANY_FIELDS: FieldDef[] = [
  { name: "name", label: "Ragione sociale", type: "text", required: true },
  {
    name: "legal_form",
    label: "Forma giuridica",
    type: "select",
    options: LEGAL_FORMS,
    required: true,
    default: "srl",
  },
  {
    name: "regime",
    label: "Regime fiscale",
    type: "select",
    options: REGIMES,
    required: true,
    default: "ordinario",
  },
  vatNumber(),
  taxCode(),
  { name: "address", label: "Indirizzo", type: "text" },
  { name: "zip", label: "CAP", type: "text", maxLength: 5 },
  { name: "city", label: "Città", type: "text" },
  { name: "province", label: "Provincia", type: "text", maxLength: 2 },
  { name: "email", label: "Email", type: "email" },
  { name: "pec", label: "PEC", type: "email" },
  { name: "phone", label: "Telefono", type: "phone" },
  { name: "sdi_code", label: "Codice SDI", type: "text", maxLength: 7 },
  iban(),
  { name: "default_vat_rate", label: "Aliquota IVA predefinita %", type: "percent", default: 22 },
  { name: "invoice_footer", label: "Note a piè di fattura", type: "longtext" },
];

const PSEUDO: EntityDef = {
  key: "company",
  module: "system",
  label: "Azienda",
  plural: "Azienda",
  table: "company",
  fields: COMPANY_FIELDS,
  title: () => "Azienda",
};

export interface Company extends Record<string, unknown> {
  name: string;
  legal_form: string;
  regime: "forfettario" | "ordinario";
  default_vat_rate: number;
}

const KEY = "company.profile";

export async function getCompany(db: SqlRunner): Promise<Company | null> {
  return getSetting<Company>(db, KEY);
}

export async function saveCompany(
  db: SqlRunner,
  input: Record<string, unknown>,
  at: string,
): Promise<Company> {
  const values = validateInput(PSEUDO, input, "create") as Company;
  await setSetting(db, KEY, values, at);
  return values;
}
