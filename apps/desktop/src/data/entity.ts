/**
 * Declarative description of a business entity. One definition drives the database table,
 * the validation, the audit trail, the synchronisation queue and the generic screens, so a
 * new entity cannot be added with, say, validation but without an audit trail.
 */

import { isValidDay, isValidInstant } from "../lib/dates";
import { isCidr, isIpAddress } from "../lib/net";
import type { SqlRunner } from "./db";
import type { EntityRepository } from "./repository";
import { ValidationError } from "./errors";

export type ModuleKey = "crm" | "erp" | "it" | "system";

export type FieldType =
  | "text"
  | "longtext"
  | "integer"
  | "decimal"
  | "percent"
  | "money"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "ref"
  | "email"
  | "phone"
  | "url"
  | "ip"
  | "cidr";

export interface Option {
  value: string;
  label: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** For `select`. */
  options?: Option[];
  /** For `ref`: the key of the referenced entity. */
  ref?: string;
  default?: string | number | boolean | null;
  /** Unique among live records; a list names the fields that scope the uniqueness. */
  unique?: boolean | string[];
  min?: number;
  max?: number;
  maxLength?: number;
  help?: string;
  /** Computed or set by business logic: shown, but not editable in generic forms. */
  readonly?: boolean;
  /** Not shown in forms (internal bookkeeping). */
  hidden?: boolean;
  /** Shown as a column in generic lists. */
  list?: boolean;
  /** Included in text search. */
  searchable?: boolean;
  /** Never written to the audit trail (values are masked). */
  sensitive?: boolean;
  /** Extra check on the normalised value; return an error message or null. */
  validate?: (value: unknown) => string | null;
}

export type Rec = {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
} & Record<string, unknown>;

export interface Ctx {
  now(): string;
  today(): string;
  newId(): string;
  deviceId: string;
  /** True once the app is linked to a server: changes are then queued for synchronisation. */
  syncEnabled: boolean;
  actor: string;
}

export type SaveMode = "create" | "update" | "delete";

export interface HookContext {
  tx: SqlRunner;
  ctx: Ctx;
  /** Repository of any entity, for logic that touches other records in the same transaction. */
  repo: (key: string) => EntityRepository;
  mode: SaveMode;
  /** The record as stored before this change (null on create). */
  before: Rec | null;
  /** The record as it will be stored. Hooks may adjust fields of it. */
  record: Rec;
}

export interface EntityDef {
  key: string;
  module: ModuleKey;
  label: string;
  plural: string;
  table: string;
  fields: FieldDef[];
  /** Human readable name of a record (for links, titles, notifications). */
  title: (record: Rec) => string;
  /** "field asc|desc", shown first by default. */
  defaultOrder?: string;
  /** Extra SQL run with the table (indexes, triggers). */
  extraSql?: string[];
  /** If it returns a reason, the record is final and cannot be changed or deleted. */
  lockedReason?: (record: Rec) => string | null;
  /** Records of this entity cannot be deleted at all (ledgers). */
  noDelete?: boolean;
  /** Runs inside the transaction, after validation and before the write. */
  beforeSave?: (hook: HookContext) => Promise<void> | void;
  afterSave?: (hook: HookContext) => Promise<void> | void;
  /** Runs before a record is deleted; throw to refuse. */
  beforeDelete?: (hook: HookContext) => Promise<void> | void;
}

export const SYSTEM_FIELDS = ["id", "version", "created_at", "updated_at", "deleted_at"] as const;

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

export function assertIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return name;
}

export function sqlType(type: FieldType): "TEXT" | "INTEGER" | "REAL" {
  switch (type) {
    case "integer":
    case "money":
    case "boolean":
      return "INTEGER";
    case "decimal":
    case "percent":
      return "REAL";
    default:
      return "TEXT";
  }
}

/** The CREATE TABLE and index statements of an entity. */
export function createTableSql(def: EntityDef, tableOf: (ref: string) => string): string[] {
  const table = assertIdentifier(def.table);
  const columns = [
    "id TEXT PRIMARY KEY",
    "version INTEGER NOT NULL DEFAULT 1",
    "created_at TEXT NOT NULL",
    "updated_at TEXT NOT NULL",
    "deleted_at TEXT",
  ];
  const statements: string[] = [];
  for (const field of def.fields) {
    const name = assertIdentifier(field.name);
    const parts = [name, sqlType(field.type)];
    if (field.required) parts.push("NOT NULL");
    if (field.type === "select" && field.options?.length) {
      const values = field.options.map((o) => `'${o.value.replace(/'/g, "''")}'`).join(", ");
      parts.push(`CHECK (${name} IS NULL OR ${name} IN (${values}))`);
    }
    if (field.type === "boolean") parts.push(`CHECK (${name} IS NULL OR ${name} IN (0, 1))`);
    if (field.type === "ref" && field.ref)
      parts.push(`REFERENCES ${assertIdentifier(tableOf(field.ref))}(id)`);
    columns.push(parts.join(" "));
  }
  statements.push(`CREATE TABLE ${table} (\n  ${columns.join(",\n  ")}\n)`);

  for (const field of def.fields) {
    if (field.type === "ref") {
      statements.push(
        `CREATE INDEX ix_${table}_${field.name} ON ${table}(${field.name}) WHERE deleted_at IS NULL`,
      );
    }
    if (field.unique) {
      const scope = Array.isArray(field.unique) ? field.unique : [];
      const cols = [field.name, ...scope].map(assertIdentifier).join(", ");
      statements.push(
        `CREATE UNIQUE INDEX uq_${table}_${[field.name, ...scope].join("_")} ON ${table}(${cols}) WHERE deleted_at IS NULL`,
      );
    }
  }
  statements.push(`CREATE INDEX ix_${table}_updated ON ${table}(updated_at)`);
  statements.push(...(def.extraSql ?? []));
  return statements;
}

// --- validation -----------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+()\d\s./-]{5,30}$/;

function isBlank(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
  );
}

/**
 * Validates one value against its field and returns the value to store (trimmed,
 * normalised) or an error message. References are checked separately, against the database.
 */
export function normaliseValue(
  field: FieldDef,
  raw: unknown,
): { value: unknown } | { error: string } {
  const result = normaliseBase(field, raw);
  if ("value" in result && result.value !== null && field.validate) {
    const message = field.validate(result.value);
    if (message) return { error: message };
  }
  return result;
}

function normaliseBase(field: FieldDef, raw: unknown): { value: unknown } | { error: string } {
  if (isBlank(raw)) {
    return field.required ? { error: "Campo obbligatorio" } : { value: null };
  }
  switch (field.type) {
    case "text":
    case "longtext": {
      if (typeof raw !== "string") return { error: "Deve essere un testo" };
      const text = raw.trim();
      const limit = field.maxLength ?? (field.type === "text" ? 500 : 20_000);
      return text.length > limit ? { error: `Massimo ${limit} caratteri` } : { value: text };
    }
    case "email": {
      const text = String(raw).trim().toLowerCase();
      return EMAIL.test(text) && text.length <= 320
        ? { value: text }
        : { error: "Indirizzo email non valido" };
    }
    case "phone": {
      const text = String(raw).trim();
      return PHONE.test(text) ? { value: text } : { error: "Numero di telefono non valido" };
    }
    case "url": {
      const text = String(raw).trim();
      try {
        const url = new URL(text);
        if (url.protocol !== "http:" && url.protocol !== "https:")
          return { error: "Solo indirizzi http o https" };
        return { value: text };
      } catch {
        return { error: "Indirizzo web non valido" };
      }
    }
    case "ip": {
      const text = String(raw).trim();
      return isIpAddress(text)
        ? { value: text.toLowerCase() }
        : { error: "Indirizzo IP non valido" };
    }
    case "cidr": {
      const text = String(raw).trim();
      return isCidr(text)
        ? { value: text.toLowerCase() }
        : { error: "Rete non valida (es. 192.168.1.0/24)" };
    }
    case "integer":
    case "money": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isSafeInteger(n)) {
        return {
          error:
            field.type === "money"
              ? "Importo non valido (centesimi interi)"
              : "Deve essere un numero intero",
        };
      }
      if (field.min !== undefined && n < field.min) return { error: `Minimo ${field.min}` };
      if (field.max !== undefined && n > field.max) return { error: `Massimo ${field.max}` };
      return { value: n };
    }
    case "decimal":
    case "percent": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return { error: "Deve essere un numero" };
      const min = field.min ?? (field.type === "percent" ? 0 : undefined);
      const max = field.max ?? (field.type === "percent" ? 100 : undefined);
      if (min !== undefined && n < min) return { error: `Minimo ${min}` };
      if (max !== undefined && n > max) return { error: `Massimo ${max}` };
      return { value: n };
    }
    case "date": {
      const text = String(raw).trim();
      return isValidDay(text) ? { value: text } : { error: "Data non valida (AAAA-MM-GG)" };
    }
    case "datetime": {
      const text = String(raw).trim();
      return isValidInstant(text) ? { value: text } : { error: "Data e ora non valide" };
    }
    case "boolean": {
      if (raw === true || raw === 1 || raw === "1" || raw === "true") return { value: true };
      if (raw === false || raw === 0 || raw === "0" || raw === "false") return { value: false };
      return { error: "Deve essere sì o no" };
    }
    case "select": {
      const text = String(raw);
      return field.options?.some((o) => o.value === text)
        ? { value: text }
        : { error: "Valore non ammesso" };
    }
    case "ref":
      return typeof raw === "string" && raw !== ""
        ? { value: raw }
        : { error: "Riferimento non valido" };
  }
}

/** Validates the editable fields of `input` and returns the normalised values. */
export function validateInput(
  def: EntityDef,
  input: Record<string, unknown>,
  mode: "create" | "update",
): Record<string, unknown> {
  const errors: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const known = new Set(def.fields.map((f) => f.name));
  for (const key of Object.keys(input)) {
    if (!known.has(key) && !(SYSTEM_FIELDS as readonly string[]).includes(key)) {
      errors[key] = "Campo sconosciuto";
    }
  }
  for (const field of def.fields) {
    const present = Object.prototype.hasOwnProperty.call(input, field.name);
    if (mode === "update" && !present) continue;
    const raw = present ? input[field.name] : (field.default ?? null);
    const result = normaliseValue(field, raw);
    if ("error" in result) errors[field.name] = result.error;
    else values[field.name] = result.value;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return values;
}
