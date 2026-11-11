import type { EntityDef, FieldDef, Rec } from "../data/entity";
import type { Workspace } from "../data/workspace";
import { centsToPlain, formatMoney } from "../lib/money";

const dayFormat = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFormat = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" });

export function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : dayFormat.format(date);
}

export function formatInstant(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormat.format(date);
}

export function formatValue(field: FieldDef, value: unknown, refs: Map<string, string>): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.type) {
    case "money":
      return formatMoney(Number(value));
    case "percent":
      return `${value}%`;
    case "date":
      return formatDay(String(value));
    case "datetime":
      return formatInstant(String(value));
    case "boolean":
      return value ? "Sì" : "No";
    case "select":
      return field.options?.find((o) => o.value === value)?.label ?? String(value);
    case "ref":
      return refs.get(String(value)) ?? "—";
    default:
      return String(value);
  }
}

/** Titles of every record referenced by `rows`, keyed by id. */
export async function resolveRefs(
  ws: Workspace,
  def: EntityDef,
  rows: Rec[],
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (const field of def.fields) {
    if (field.type !== "ref" || !field.ref) continue;
    const ids = [
      ...new Set(rows.map((r) => r[field.name]).filter((v): v is string => typeof v === "string")),
    ];
    if (ids.length === 0) continue;
    const target = ws.registry.get(field.ref);
    const found = await ws.db.query(
      `SELECT * FROM ${target.table} WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
    for (const row of found) titles.set(String(row["id"]), target.title(row as unknown as Rec));
  }
  return titles;
}

// --- form values ----------------------------------------------------------------------

export type FormValues = Record<string, string | boolean>;

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toFormValue(field: FieldDef, value: unknown): string | boolean {
  if (value === null || value === undefined) return field.type === "boolean" ? false : "";
  if (field.type === "boolean") return Boolean(value);
  if (field.type === "money") return centsToPlain(Number(value)).replace(".", ",");
  if (field.type === "datetime") return toLocalInput(String(value));
  return String(value);
}

export function initialValues(def: EntityDef, record: Rec | null): FormValues {
  const values: FormValues = {};
  for (const field of def.fields) {
    values[field.name] = toFormValue(field, record ? record[field.name] : (field.default ?? null));
  }
  return values;
}
