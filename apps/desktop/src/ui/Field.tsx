import { useId } from "react";

import type { FieldDef } from "../data/entity";

interface Props {
  field: FieldDef;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  error?: string | undefined;
  disabled?: boolean;
  /** For ref fields: the choices. */
  choices?: { id: string; title: string }[];
}

const CONTROL =
  "w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent disabled:opacity-60";

export function Field({ field, value, onChange, error, disabled, choices }: Props) {
  const id = useId();
  const describedBy =
    [error ? `${id}-err` : null, field.help ? `${id}-help` : null].filter(Boolean).join(" ") ||
    undefined;
  const common = {
    id,
    disabled: disabled || field.readonly,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": field.required || undefined,
  } as const;

  let control;
  if (field.type === "boolean") {
    control = (
      <input
        {...common}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
    );
  } else if (field.type === "longtext") {
    control = (
      <textarea
        {...common}
        rows={4}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className={CONTROL}
      />
    );
  } else if (field.type === "select") {
    control = (
      <select
        {...common}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className={CONTROL}
      >
        <option value="">—</option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "ref") {
    control = (
      <select
        {...common}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className={CONTROL}
      >
        <option value="">—</option>
        {choices?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    );
  } else {
    const type =
      field.type === "date"
        ? "date"
        : field.type === "datetime"
          ? "datetime-local"
          : field.type === "integer" || field.type === "decimal" || field.type === "percent"
            ? "number"
            : field.type === "email"
              ? "email"
              : "text";
    control = (
      <input
        {...common}
        type={type}
        {...(type === "number" ? { step: field.type === "integer" ? 1 : "any" } : {})}
        inputMode={field.type === "money" ? "decimal" : undefined}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className={CONTROL}
      />
    );
  }

  const isCheck = field.type === "boolean";
  return (
    <div className={isCheck ? "flex flex-col justify-end" : ""}>
      <label
        htmlFor={id}
        className={`mb-1 block text-xs font-medium text-muted ${isCheck ? "flex items-center gap-2" : ""}`}
      >
        {isCheck ? control : null}
        <span>
          {field.label}
          {field.required ? <span aria-hidden="true"> *</span> : null}
        </span>
      </label>
      {isCheck ? null : control}
      {field.help ? (
        <p id={`${id}-help`} className="mt-1 text-xs text-muted">
          {field.help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
