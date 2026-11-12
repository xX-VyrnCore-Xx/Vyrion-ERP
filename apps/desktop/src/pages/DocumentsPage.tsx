import { useState } from "react";

import { Button } from "../components/Button";
import { PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href, type Route } from "../app/router";
import { formatMoney } from "../lib/money";
import { DOC_TYPES, isFiscal } from "../modules/documents";
import { formatDay, resolveRefs } from "../ui/format";
import { Badge, Empty, ErrorNote, TABLE, TD, TH, Toolbar } from "../ui/parts";

const TAB_LABEL: Record<string, string> = {
  quote: "Preventivi",
  order: "Ordini",
  invoice: "Fatture",
  credit_note: "Note di credito",
  purchase_invoice: "Acquisti",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Bozza",
  sent: "Inviato",
  accepted: "Accettato",
  rejected: "Rifiutato",
  invoiced: "Fatturato",
  cancelled: "Annullato",
  issued: "Emesso",
};

export function DocumentsPage({ route, go }: { route: Route; go: (to: string) => void }) {
  const ws = useWorkspace();
  const type = route.query.get("type") ?? "invoice";
  const [search, setSearch] = useState("");
  const def = ws.registry.get("document");
  const result = useAsync(async () => {
    const page = await ws.list("document", {
      filters: { type },
      search,
      limit: 200,
      orderBy: "date desc",
    });
    const refs = await resolveRefs(ws, def, page.rows);
    const paid = await ws.db.query<{ document_id: string; paid: number }>(
      "SELECT document_id, SUM(amount) AS paid FROM payments WHERE deleted_at IS NULL GROUP BY document_id",
    );
    return { ...page, refs, paid: new Map(paid.map((p) => [p.document_id, Number(p.paid)])) };
  }, [type, search]);

  return (
    <>
      <PageHeader
        title="Documenti"
        subtitle="Preventivi, ordini, fatture, note di credito e fatture di acquisto."
      />
      <div
        role="tablist"
        aria-label="Tipo di documento"
        className="mb-4 flex flex-wrap gap-1 border-b border-line"
      >
        {DOC_TYPES.map((o) => (
          <a
            key={o.value}
            role="tab"
            aria-selected={type === o.value}
            href={`#/documents?type=${o.value}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${type === o.value ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {TAB_LABEL[o.value]}
          </a>
        ))}
      </div>
      <Toolbar>
        <input
          type="search"
          aria-label="Cerca documenti"
          placeholder="Cerca per numero…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg placeholder:text-muted"
        />
        <Button variant="primary" className="ml-auto" onClick={() => go(href("d", type, "new"))}>
          Nuovo
        </Button>
      </Toolbar>
      <ErrorNote message={result.error} />
      {result.data && result.data.rows.length === 0 ? (
        <Empty>Nessun documento di questo tipo.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className={TABLE}>
            <thead>
              <tr>
                {["Numero", "Data", "Anagrafica", "Stato", "Scadenza", "Totale", "Residuo"].map(
                  (h, i) => (
                    <th key={h} scope="col" className={`${TH} ${i >= 5 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {result.data?.rows.map((row) => {
                const total = Number(row["total"]);
                const open =
                  Number(row["payable"] ?? row["total"]) - (result.data?.paid.get(row.id) ?? 0);
                const overdue =
                  isFiscal(type) &&
                  row["status"] === "issued" &&
                  open > 0 &&
                  String(row["due_date"] ?? "9999") < ws.ctx.today();
                return (
                  <tr key={row.id} className="hover:bg-raised">
                    <td className={TD}>
                      <a
                        href={href("d", type, row.id)}
                        className="font-medium text-fg hover:text-accent"
                      >
                        {String(row["number"] ?? "Bozza")}
                      </a>
                    </td>
                    <td className={TD}>{formatDay(String(row["date"]))}</td>
                    <td className={TD}>{result.data?.refs.get(String(row["party_id"])) ?? "—"}</td>
                    <td className={TD}>
                      <Badge
                        tone={row["status"] === "draft" ? "neutral" : overdue ? "danger" : "info"}
                      >
                        {overdue
                          ? "Scaduto"
                          : (STATUS_LABEL[String(row["status"])] ?? String(row["status"]))}
                      </Badge>
                    </td>
                    <td className={TD}>
                      {row["due_date"] ? formatDay(String(row["due_date"])) : ""}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMoney(total)}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {isFiscal(type) && row["status"] === "issued" ? formatMoney(open) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
