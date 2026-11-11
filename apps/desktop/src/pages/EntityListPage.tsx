import { useState } from "react";

import { Button } from "../components/Button";
import { PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href, type Route } from "../app/router";
import type { Rec } from "../data/entity";
import { toCsv } from "../modules/reports";
import { formatValue, resolveRefs } from "../ui/format";
import { Empty, ErrorNote, TABLE, TD, TH, Toolbar } from "../ui/parts";
import { saveText } from "../ui/saveText";

const PAGE = 50;

/** Filters come from the address: `?party_id=…` shows only the records of that party. */
export function filtersFrom(route: Route, fieldNames: string[]): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [name, value] of route.query) if (fieldNames.includes(name)) filters[name] = value;
  return filters;
}

export function EntityListPage({
  entityKey,
  route,
  go,
}: {
  entityKey: string;
  route: Route;
  go: (to: string) => void;
}) {
  const ws = useWorkspace();
  const def = ws.registry.get(entityKey);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const filters = filtersFrom(
    route,
    def.fields.map((f) => f.name),
  );
  const filterKey = JSON.stringify(filters);
  const columns = def.fields.filter((f) => f.list);

  const result = useAsync(async () => {
    const data = await ws.list(entityKey, { search, filters, limit: PAGE, offset: page * PAGE });
    return { ...data, refs: await resolveRefs(ws, def, data.rows) };
  }, [entityKey, search, page, filterKey]);

  const query = new URLSearchParams(filters).toString();
  const newHref = `${href("e", entityKey, "new")}${query ? `?${query}` : ""}`;

  const exportCsv = async () => {
    setExportError(null);
    try {
      const all = await ws.list(entityKey, { search, filters, limit: 1000 });
      const refs = await resolveRefs(ws, def, all.rows);
      const csv = toCsv(
        def.fields.filter((f) => !f.hidden).map((f) => ({ key: f.name, label: f.label })),
        all.rows.map((row) =>
          Object.fromEntries(
            def.fields.map((f) => [
              f.name,
              f.type === "money"
                ? Number(row[f.name] ?? 0) / 100
                : f.type === "ref" || f.type === "select" || f.type === "boolean"
                  ? formatValue(f, row[f.name], refs)
                  : row[f.name],
            ]),
          ),
        ),
      );
      await saveText(`${def.plural.toLowerCase().replace(/\s+/g, "-")}.csv`, csv);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  };

  const total = result.data?.total ?? 0;
  const rows: Rec[] = result.data?.rows ?? [];

  return (
    <>
      <PageHeader
        title={def.plural}
        subtitle={`${total} ${total === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()}`}
      />
      <Toolbar>
        <input
          type="search"
          aria-label={`Cerca in ${def.plural}`}
          placeholder="Cerca…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="w-64 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg placeholder:text-muted"
        />
        {query ? <Button onClick={() => go(href("e", entityKey))}>Rimuovi filtro</Button> : null}
        <div className="ml-auto flex gap-2">
          <Button onClick={() => void exportCsv()}>Esporta CSV</Button>
          <Button variant="primary" onClick={() => go(newHref)}>
            Nuovo
          </Button>
        </div>
      </Toolbar>
      <ErrorNote message={result.error ?? exportError} />
      {result.data && rows.length === 0 ? (
        <Empty>
          {search
            ? "Nessun risultato per la ricerca."
            : `Nessun elemento. Usa «Nuovo» per aggiungerne uno.`}
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className={TABLE}>
            <thead>
              <tr>
                {columns.map((f) => (
                  <th
                    key={f.name}
                    scope="col"
                    className={`${TH} ${f.type === "money" ? "text-right" : ""}`}
                  >
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-raised">
                  {columns.map((f, index) => {
                    const text = formatValue(f, row[f.name], result.data?.refs ?? new Map());
                    return (
                      <td
                        key={f.name}
                        className={`${TD} ${f.type === "money" ? "text-right tabular-nums" : ""}`}
                      >
                        {index === 0 ? (
                          <a
                            href={href("e", entityKey, row.id)}
                            className="font-medium text-fg hover:text-accent"
                          >
                            {text || "(senza nome)"}
                          </a>
                        ) : (
                          text
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted">
          <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
            Precedente
          </Button>
          <span>
            {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} di {total}
          </span>
          <Button disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>
            Successivo
          </Button>
        </div>
      ) : null}
    </>
  );
}
