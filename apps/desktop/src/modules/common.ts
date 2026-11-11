import type { FieldDef, Option } from "../data/entity";
import { isValidCodiceFiscale, isValidIban, isValidPartitaIva } from "../lib/fiscal";

export const opts = (pairs: [string, string][]): Option[] =>
  pairs.map(([value, label]) => ({ value, label }));

export const labelOf = (options: Option[], value: unknown): string =>
  options.find((o) => o.value === value)?.label ?? String(value ?? "");

export const PRIORITY = opts([
  ["low", "Bassa"],
  ["normal", "Normale"],
  ["high", "Alta"],
  ["urgent", "Urgente"],
]);

export const vatNumber = (name = "vat_number", label = "Partita IVA"): FieldDef => ({
  name,
  label,
  type: "text",
  searchable: true,
  maxLength: 11,
  validate: (v) =>
    isValidPartitaIva(String(v))
      ? null
      : "Partita IVA non valida (11 cifre, controllo non superato)",
});

export const taxCode = (): FieldDef => ({
  name: "tax_code",
  label: "Codice fiscale",
  type: "text",
  searchable: true,
  maxLength: 16,
  validate: (v) => (isValidCodiceFiscale(String(v)) ? null : "Codice fiscale non valido"),
});

export const iban = (name = "iban", label = "IBAN"): FieldDef => ({
  name,
  label,
  type: "text",
  maxLength: 34,
  validate: (v) => (isValidIban(String(v)) ? null : "IBAN non valido"),
});
