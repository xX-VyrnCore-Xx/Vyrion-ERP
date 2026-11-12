/**
 * Import of records from a CSV file into any entity: the person maps the columns, every row
 * is checked with the entity's own validation, and the valid ones are created one by one
 * (each with its audit trail and sync entry). Rows that fail are reported, not silently lost.
 */

import type { EntityDef, FieldDef } from "../data/entity";
import { ValidationError } from "../data/errors";
import { validateInput } from "../data/entity";
import type { Workspace } from "../data/workspace";
import { isValidDay } from "../lib/dates";
import { parseMoney } from "../lib/money";
import { normalize } from "../search/text";

/** Entities whose records come from business rules (ledgers, numbering): never imported. */
const NOT_IMPORTABLE = new Set([
  "document",
  "document_line",
  "journal_entry",
  "journal_line",
  "payment",
  "stock_movement",
  "attachment",
  "company",
  "backup_run",
]);

export const isImportable = (def: EntityDef): boolean =>
  !NOT_IMPORTABLE.has(def.key) && !def.noDelete;

/** Fields a person can fill from a file (no computed ones, no references by internal id). */
export const importFields = (def: EntityDef): FieldDef[] =>
  def.fields.filter((f) => !f.readonly && !f.hidden && f.type !== "ref");

/** Suggests, for each column, the field it most likely belongs to (by label or name). */
export function suggestMapping(headers: string[], fields: FieldDef[]): (string | null)[] {
  const taken = new Set<string>();
  return headers.map((header) => {
    const h = normalize(header);
    if (!h) return null;
    const hit = fields.find(
      (f) => !taken.has(f.name) && (normalize(f.label) === h || normalize(f.name) === h),
    );
    const loose =
      hit ??
      fields.find(
        (f) =>
          !taken.has(f.name) &&
          (normalize(f.label).startsWith(h) || h.startsWith(normalize(f.label))) &&
          h.length >= 3,
      );
    if (loose) taken.add(loose.name);
    return loose?.name ?? null;
  });
}

const TRUE = new Set(["si", "s", "true", "1", "vero", "yes", "y", "x"]);
const FALSE = new Set(["no", "n", "false", "0", "falso"]);

/** One cell → the value the entity expects, or an error message in Italian. */
export function coerceCell(field: FieldDef, raw: string): { value: unknown } | { error: string } {
  const text = raw.trim();
  if (text === "") return { value: null };
  switch (field.type) {
    case "money": {
      const cents = parseMoney(text);
      return cents === null ? { error: `«${text}» non è un importo` } : { value: cents };
    }
    case "integer": {
      const n = Number(text.replace(/\./g, "").replace(",", "."));
      return Number.isInteger(n) ? { value: n } : { error: `«${text}» non è un numero intero` };
    }
    case "decimal":
    case "percent": {
      const n = Number(text.replace("%", "").replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? { value: n } : { error: `«${text}» non è un numero` };
    }
    case "boolean": {
      const t = normalize(text);
      if (TRUE.has(t)) return { value: true };
      if (FALSE.has(t)) return { value: false };
      return { error: `«${text}» non è sì/no` };
    }
    case "date": {
      const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
      const iso = it
        ? `${it[3]}-${(it[2] as string).padStart(2, "0")}-${(it[1] as string).padStart(2, "0")}`
        : text;
      return isValidDay(iso) ? { value: iso } : { error: `«${text}» non è una data (gg/mm/aaaa)` };
    }
    case "select": {
      const t = normalize(text);
      const option = (field.options ?? []).find(
        (o) => normalize(o.label) === t || normalize(o.value) === t,
      );
      return option
        ? { value: option.value }
        : { error: `«${text}» non è un valore ammesso per ${field.label}` };
    }
    default:
      return { value: text };
  }
}

export interface ImportRowResult {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  status: "ok" | "invalid" | "duplicate";
  record?: Record<string, unknown>;
  errors: string[];
}

/** Keys that identify "the same" record besides the database's own uniqueness. */
const DUPLICATE_KEYS: Record<string, string[]> = {
  party: ["vat_number", "tax_code", "email"],
  contact: ["email"],
  product: ["sku"],
  employee: ["tax_code", "email"],
  asset: ["serial_number"],
};

const lower = (v: unknown): string =>
  String(v ?? "")
    .trim()
    .toLowerCase();

/**
 * Checks every row without writing anything. `mapping[i]` is the field of column i (or null).
 * With `skipDuplicates`, a row whose identifying value already exists (or repeats earlier in
 * the file) is marked as duplicate instead of being created twice.
 */
export async function planImport(
  ws: Workspace,
  def: EntityDef,
  rows: string[][],
  mapping: (string | null)[],
  options: { skipDuplicates: boolean },
): Promise<ImportRowResult[]> {
  const fields = new Map(def.fields.map((f) => [f.name, f]));
  const keys = (DUPLICATE_KEYS[def.key] ?? []).filter((k) => fields.has(k));
  const seen = new Map<string, Set<string>>(keys.map((k) => [k, new Set<string>()]));
  if (options.skipDuplicates) {
    for (const key of keys) {
      const existing = await ws.db.query(
        `SELECT ${key} FROM ${def.table} WHERE deleted_at IS NULL AND ${key} IS NOT NULL AND ${key} <> ''`,
      );
      for (const r of existing) seen.get(key)?.add(lower(r[key]));
    }
  }
  const results: ImportRowResult[] = [];
  for (const [index, cells] of rows.entries()) {
    const line = index + 2;
    const errors: string[] = [];
    const record: Record<string, unknown> = {};
    mapping.forEach((name, column) => {
      if (!name) return;
      const field = fields.get(name);
      if (!field) return;
      const coerced = coerceCell(field, cells[column] ?? "");
      if ("error" in coerced) errors.push(`${field.label}: ${coerced.error}`);
      else if (coerced.value !== null) record[name] = coerced.value;
    });
    if (errors.length === 0) {
      try {
        validateInput(def, record, "create");
      } catch (error) {
        if (error instanceof ValidationError)
          for (const [name, message] of Object.entries(error.errors))
            errors.push(`${fields.get(name)?.label ?? name}: ${message}`);
        else throw error;
      }
    }
    if (errors.length > 0) {
      results.push({ line, status: "invalid", errors });
      continue;
    }
    if (options.skipDuplicates) {
      const clash = keys.find((k) => record[k] && seen.get(k)?.has(lower(record[k])));
      if (clash) {
        results.push({
          line,
          status: "duplicate",
          errors: [`${fields.get(clash)?.label ?? clash} già presente`],
        });
        continue;
      }
      for (const k of keys) if (record[k]) seen.get(k)?.add(lower(record[k]));
    }
    results.push({ line, status: "ok", record, errors: [] });
  }
  return results;
}

export interface ImportOutcome {
  created: number;
  failed: { line: number; error: string }[];
}

/** Creates the valid rows of a plan. A row refused at write time (e.g. a unique value) is reported. */
export async function runImport(
  ws: Workspace,
  def: EntityDef,
  plan: ImportRowResult[],
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { created: 0, failed: [] };
  for (const row of plan) {
    if (row.status !== "ok" || !row.record) continue;
    try {
      await ws.create(def.key, row.record);
      outcome.created++;
    } catch (error) {
      outcome.failed.push({
        line: row.line,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcome;
}
