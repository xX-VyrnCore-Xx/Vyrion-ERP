import { useState, type FormEvent } from "react";

import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href, type Route } from "../app/router";
import type { EntityDef, FieldDef, Rec } from "../data/entity";
import { AppError, ValidationError, VersionConflictError } from "../data/errors";
import { parseMoney } from "../lib/money";
import { AttachmentsPanel } from "../ui/AttachmentsPanel";
import { Field } from "../ui/Field";
import { sectionsFor } from "../ui/formGroups";
import { initialValues, type FormValues } from "../ui/format";
import { HistoryPanel } from "../ui/HistoryPanel";
import { ConfirmDialog, ErrorNote } from "../ui/parts";
import { filtersFrom } from "./EntityListPage";

/** Entities whose records can carry files. */
const ATTACHABLE = new Set([
  "party",
  "contract",
  "ticket",
  "asset",
  "project",
  "employee",
  "tech_doc",
  "opportunity",
  "license",
]);
/** Referencing entities that are shown in their own screens, not as related lists. */
const HIDDEN_RELATED = new Set(["document_line", "journal_line", "attachment", "journal_entry"]);

function toPayload(
  def: EntityDef,
  values: FormValues,
): { payload: Record<string, unknown>; errors: Record<string, string> } {
  const payload: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of def.fields) {
    if (field.readonly || field.hidden) continue;
    const raw = values[field.name];
    if (field.type === "boolean") payload[field.name] = Boolean(raw);
    else if (field.type === "money") {
      const text = String(raw ?? "").trim();
      if (text === "") payload[field.name] = null;
      else {
        const cents = parseMoney(text);
        if (cents === null) errors[field.name] = "Importo non valido";
        else payload[field.name] = cents;
      }
    } else if (field.type === "datetime") {
      const text = String(raw ?? "");
      payload[field.name] = text ? new Date(text).toISOString() : null;
    } else payload[field.name] = raw;
  }
  return { payload, errors };
}

function useChoices(def: EntityDef) {
  const ws = useWorkspace();
  return useAsync(async () => {
    const out: Record<string, { id: string; title: string }[]> = {};
    for (const field of def.fields) {
      if (field.type !== "ref" || !field.ref) continue;
      const target = ws.registry.get(field.ref);
      const page = await ws.list(field.ref, { limit: 1000 });
      out[field.name] = page.rows
        .map((r) => ({ id: r.id, title: target.title(r) }))
        .sort((a, b) => a.title.localeCompare(b.title, "it"));
    }
    return out;
  }, [def.key]);
}

export function EntityFormPage({
  entityKey,
  id,
  route,
  go,
}: {
  entityKey: string;
  id: string;
  route: Route;
  go: (to: string) => void;
}) {
  const ws = useWorkspace();
  const def = ws.registry.get(entityKey);
  const creating = id === "new";
  const record = useAsync(
    async () => (creating ? null : await ws.get(entityKey, id)),
    [entityKey, id],
  );
  const choices = useChoices(def);

  if (!creating && record.loading) return <p className="text-sm text-muted">Caricamento…</p>;
  if (!creating && !record.data) {
    return (
      <div className="space-y-3">
        <ErrorNote message={record.error ?? "Elemento non trovato."} />
        <Button onClick={() => go(href("e", entityKey))}>Torna all'elenco</Button>
      </div>
    );
  }
  // The inner form is keyed by version so it reloads when the record changes underneath it.
  return (
    <FormBody
      key={`${id}:${record.data?.version ?? 0}`}
      def={def}
      record={record.data}
      choices={choices.data ?? {}}
      prefill={filtersFrom(
        route,
        def.fields.map((f) => f.name),
      )}
      go={go}
    />
  );
}

function FormBody({
  def,
  record,
  choices,
  prefill,
  go,
}: {
  def: EntityDef;
  record: Rec | null;
  choices: Record<string, { id: string; title: string }[]>;
  prefill: Record<string, string>;
  go: (to: string) => void;
}) {
  const ws = useWorkspace();
  const [values, setValues] = useState<FormValues>(() => ({
    ...initialValues(def, record),
    ...prefill,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const lockedReason = record ? (def.lockedReason?.(record) ?? null) : null;
  const related = useAsync(async () => {
    if (!record) return [];
    const rows = [];
    for (const { entity, field } of ws.registry.referencing(def.key)) {
      if (HIDDEN_RELATED.has(entity.key)) continue;
      const [row] = await ws.db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${entity.table} WHERE ${field.name} = ? AND deleted_at IS NULL`,
        [record.id],
      );
      if (Number(row?.n) > 0) rows.push({ entity, field, count: Number(row?.n) });
    }
    return rows;
  }, [record?.id]);

  const fail = (error: unknown) => {
    if (error instanceof ValidationError) {
      setErrors(error.errors);
      setMessage(error.errors["_"] ?? "Controlla i campi evidenziati.");
    } else if (error instanceof VersionConflictError) {
      setMessage(
        "Il record è stato modificato nel frattempo. Ricarica la pagina per vedere la versione aggiornata.",
      );
    } else {
      setMessage(
        error instanceof AppError || error instanceof Error ? error.message : String(error),
      );
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setSaved(false);
    const { payload, errors: local } = toPayload(def, values);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (record) {
        await ws.update(def.key, record.id, payload, record.version);
        setSaved(true);
      } else {
        const created = await ws.create(def.key, payload);
        go(href("e", def.key, created.id));
      }
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!record) return;
    setConfirming(false);
    try {
      await ws.remove(def.key, record.id, record.version);
      go(href("e", def.key));
    } catch (error) {
      fail(error);
    }
  };

  const visible = def.fields.filter((f: FieldDef) => !f.hidden && !(f.readonly && !record));
  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div>
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <a href={href("e", def.key)} className="text-xs text-muted hover:text-accent">
              ← {def.plural}
            </a>
            <h1 className="text-xl font-semibold tracking-tight text-fg">
              {record ? def.title(record) : `Nuovo: ${def.label}`}
            </h1>
          </div>
        </header>
        {lockedReason ? (
          <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            {lockedReason}
          </div>
        ) : null}
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
          <div className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
            {sectionsFor(def.key, visible).map((section) => (
              <fieldset key={section.title ?? "all"} className="m-0 min-w-0 border-0 px-5 py-4">
                {section.title ? (
                  <legend className="mb-3 float-left w-full text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {section.title}
                  </legend>
                ) : null}
                <div className="clear-both grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  {section.fields.map((field) => (
                    <div
                      key={field.name}
                      className={field.type === "longtext" ? "sm:col-span-2" : ""}
                    >
                      <Field
                        field={field}
                        value={values[field.name] ?? ""}
                        onChange={(v) => setValues((s) => ({ ...s, [field.name]: v }))}
                        error={errors[field.name]}
                        disabled={Boolean(lockedReason)}
                        choices={choices[field.name] ?? []}
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <ErrorNote message={message} />
          {saved ? (
            <p role="status" className="text-sm text-success">
              Salvato.
            </p>
          ) : null}
          <div className="sticky -bottom-8 z-10 -mx-1 flex gap-2 border-t border-line bg-bg/90 px-1 py-3 backdrop-blur">
            {!lockedReason ? (
              <Button type="submit" variant="primary" disabled={busy}>
                {record ? "Salva modifiche" : "Crea"}
              </Button>
            ) : null}
            {record && !def.noDelete && !lockedReason ? (
              <Button onClick={() => setConfirming(true)}>Elimina</Button>
            ) : null}
            <Button onClick={() => go(href("e", def.key))}>{record ? "Chiudi" : "Annulla"}</Button>
          </div>
        </form>
      </div>
      {record ? (
        <aside className="space-y-4">
          {related.data?.length ? (
            <Card title="Collegati">
              <ul className="space-y-1 text-sm">
                {related.data.map(({ entity, field, count }) => (
                  <li key={`${entity.key}.${field.name}`}>
                    <a
                      className="text-accent hover:underline"
                      href={`${href("e", entity.key)}?${field.name}=${record.id}`}
                    >
                      {entity.plural} ({count})
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {ATTACHABLE.has(def.key) ? <AttachmentsPanel entity={def.key} id={record.id} /> : null}
          <HistoryPanel entity={def.key} id={record.id} />
        </aside>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title="Eliminare?"
          message={`«${def.title(record as Rec)}» verrà eliminato. L'operazione resta nello storico.`}
          confirmLabel="Elimina"
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
