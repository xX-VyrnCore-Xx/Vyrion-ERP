import { Button } from "../components/Button";
import { PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { formatMoney } from "../lib/money";
import { ErrorNote, Toolbar } from "../ui/parts";
import { resolveRefs } from "../ui/format";
import { useState } from "react";

export function PipelinePage({ go }: { go: (to: string) => void }) {
  const ws = useWorkspace();
  const [message, setMessage] = useState<string | null>(null);
  const data = useAsync(async () => {
    const stages = (await ws.list("pipeline_stage", { orderBy: "position asc", limit: 50 })).rows;
    const opportunities = (
      await ws.list("opportunity", { orderBy: "expected_close asc", limit: 1000 })
    ).rows;
    const refs = await resolveRefs(ws, ws.registry.get("opportunity"), opportunities);
    return { stages, opportunities, refs };
  }, []);

  const move = async (id: string, version: number, stageId: string) => {
    setMessage(null);
    try {
      await ws.update("opportunity", id, { stage_id: stageId }, version);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle="Le opportunità per fase di trattativa. Il valore ponderato usa la probabilità della fase."
      />
      <Toolbar>
        <Button variant="primary" onClick={() => go(href("e", "opportunity", "new"))}>
          Nuova opportunità
        </Button>
        <a className="text-sm text-accent hover:underline" href={href("e", "opportunity")}>
          Elenco
        </a>
        <a className="text-sm text-accent hover:underline" href={href("e", "pipeline_stage")}>
          Modifica le fasi
        </a>
      </Toolbar>
      <ErrorNote message={message ?? data.error} />
      <div className="flex gap-3 overflow-x-auto pb-2">
        {data.data?.stages.map((stage) => {
          const items = data.data?.opportunities.filter((o) => o["stage_id"] === stage.id) ?? [];
          const total = items.reduce((s, o) => s + Number(o["amount"] ?? 0), 0);
          return (
            <section
              key={stage.id}
              aria-label={String(stage["name"])}
              className="w-72 shrink-0 rounded-xl border border-line bg-surface"
            >
              <header className="border-b border-line px-3 py-2">
                <h2 className="text-sm font-semibold text-fg">{String(stage["name"])}</h2>
                <p className="text-xs text-muted">
                  {items.length} · {formatMoney(total)}
                  {stage["kind"] === "open"
                    ? ` · ponderato ${formatMoney(Math.round((total * Number(stage["probability"])) / 100))}`
                    : ""}
                </p>
              </header>
              <ul className="space-y-2 p-2">
                {items.map((o) => (
                  <li key={o.id} className="rounded-lg border border-line bg-raised p-3 text-sm">
                    <a
                      href={href("e", "opportunity", o.id)}
                      className="font-medium text-fg hover:text-accent"
                    >
                      {String(o["title"])}
                    </a>
                    <div className="text-xs text-muted">
                      {data.data?.refs.get(String(o["party_id"]))}
                    </div>
                    <div className="mt-1 tabular-nums text-fg">
                      {formatMoney(Number(o["amount"] ?? 0))}
                    </div>
                    <select
                      aria-label={`Sposta ${String(o["title"])}`}
                      value={stage.id}
                      onChange={(e) => void move(o.id, o.version, e.target.value)}
                      className="mt-2 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg"
                    >
                      {data.data?.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {String(s["name"])}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
