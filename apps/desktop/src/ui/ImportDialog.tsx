import { useMemo, useState, type ChangeEvent } from "react";

import { useWorkspace } from "../app/context";
import { Button } from "../components/Button";
import type { EntityDef } from "../data/entity";
import { parseCsv } from "../modules/csv";
import {
  importFields,
  planImport,
  runImport,
  suggestMapping,
  type ImportOutcome,
  type ImportRowResult,
} from "../modules/importer";
import { Badge, Dialog, ErrorNote } from "./parts";

const SELECT = "rounded-lg border border-line bg-bg px-2 py-1.5 text-sm text-fg";

/** Import records from a CSV file: choose the file, check the column mapping, see what will happen. */
export function ImportDialog({ def, onClose }: { def: EntityDef; onClose: () => void }) {
  const ws = useWorkspace();
  const fields = useMemo(() => importFields(def), [def]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [plan, setPlan] = useState<ImportRowResult[] | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (
    nextRows: string[][],
    nextMapping: (string | null)[],
    skip = skipDuplicates,
  ) => {
    setError(null);
    try {
      setPlan(await planImport(ws, def, nextRows, nextMapping, { skipDuplicates: skip }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setOutcome(null);
    try {
      const parsed = parseCsv(await file.text());
      const head = parsed.shift() ?? [];
      if (head.length === 0 || parsed.length === 0) {
        setError("Il file è vuoto o ha solo l'intestazione.");
        return;
      }
      const suggested = suggestMapping(head, fields);
      setFileName(file.name);
      setHeader(head);
      setRows(parsed);
      setMapping(suggested);
      await check(parsed, suggested);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const change = (column: number, name: string | null) => {
    const next = mapping.map((m, i) => (i === column ? name : m === name ? null : m));
    setMapping(next);
    void check(rows, next);
  };

  const ok = plan?.filter((r) => r.status === "ok").length ?? 0;
  const invalid = plan?.filter((r) => r.status === "invalid") ?? [];
  const duplicate = plan?.filter((r) => r.status === "duplicate").length ?? 0;

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      setOutcome(await runImport(ws, def, plan));
      setPlan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Importa ${def.plural.toLowerCase()} da CSV`} onClose={onClose}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto text-sm">
        {outcome ? (
          <div role="status" className="space-y-2">
            <p className="text-fg">
              Importati <strong>{outcome.created}</strong> record.
            </p>
            {outcome.failed.length > 0 ? (
              <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                {outcome.failed.slice(0, 10).map((f) => (
                  <li key={f.line}>
                    Riga {f.line}: {f.error}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end">
              <Button variant="primary" onClick={onClose}>
                Chiudi
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-muted">
              Il file deve avere una riga di intestazione. Separatori «;», «,» o tabulazione;
              importi come 1.234,50 e date come gg/mm/aaaa.
            </p>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              aria-label="File CSV"
              onChange={(e) => void onFile(e)}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-fg"
            />
            <ErrorNote message={error} />
            {fileName && header.length > 0 ? (
              <>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    Colonne di «{fileName}»
                  </h3>
                  <ul className="space-y-1.5">
                    {header.map((h, i) => (
                      <li key={`${h}-${i}`} className="grid grid-cols-2 items-center gap-3">
                        <span className="truncate text-fg">{h || `Colonna ${i + 1}`}</span>
                        <select
                          aria-label={`Campo per ${h}`}
                          className={SELECT}
                          value={mapping[i] ?? ""}
                          onChange={(e) => change(i, e.target.value || null)}
                        >
                          <option value="">— ignora —</option>
                          {fields.map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.label}
                              {f.required ? " *" : ""}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
                <label className="flex items-center gap-2 text-fg">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={skipDuplicates}
                    onChange={(e) => {
                      setSkipDuplicates(e.target.checked);
                      void check(rows, mapping, e.target.checked);
                    }}
                  />
                  Salta le righe già presenti (stessa partita IVA, codice fiscale o email)
                </label>
                {plan ? (
                  <div className="space-y-2" role="status">
                    <div className="flex flex-wrap gap-2">
                      <Badge tone="success">{ok} da importare</Badge>
                      {duplicate > 0 ? (
                        <Badge tone="warning">{duplicate} già presenti</Badge>
                      ) : null}
                      {invalid.length > 0 ? (
                        <Badge tone="danger">{invalid.length} con errori</Badge>
                      ) : null}
                    </div>
                    {invalid.length > 0 ? (
                      <ul className="space-y-1 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
                        {invalid.slice(0, 8).map((r) => (
                          <li key={r.line}>
                            Riga {r.line}: {r.errors.join("; ")}
                          </li>
                        ))}
                        {invalid.length > 8 ? <li>… e altre {invalid.length - 8}</li> : null}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Annulla</Button>
              <Button variant="primary" disabled={busy || ok === 0} onClick={() => void run()}>
                {busy ? "Importo…" : `Importa ${ok} righe`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
