import { Card } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { formatInstant } from "./format";

const ACTIONS: Record<string, string> = {
  create: "Creato",
  update: "Modificato",
  delete: "Eliminato",
};

/** The audit trail of one record: who changed what and when. */
export function HistoryPanel({ entity, id }: { entity: string; id: string }) {
  const ws = useWorkspace();
  const def = ws.registry.get(entity);
  const history = useAsync(
    () =>
      ws.db.query<{ seq: number; at: string; actor: string; action: string; changes: string }>(
        "SELECT seq, at, actor, action, changes FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY seq DESC LIMIT 50",
        [entity, id],
      ),
    [entity, id],
  );
  const label = (name: string) => def.fields.find((f) => f.name === name)?.label ?? name;
  return (
    <Card title="Storico modifiche">
      {history.data?.length === 0 ? (
        <p className="text-sm text-muted">Nessuna modifica registrata.</p>
      ) : null}
      <ol className="space-y-3 text-sm">
        {history.data?.map((row) => {
          const changes = Object.entries(
            JSON.parse(row.changes) as Record<string, { old: unknown; new: unknown }>,
          ).filter(([name]) => !name.startsWith("_"));
          return (
            <li key={row.seq}>
              <div className="text-fg">
                {ACTIONS[row.action] ?? row.action} ·{" "}
                <span className="text-muted">
                  {formatInstant(row.at)} · {row.actor}
                </span>
              </div>
              {row.action === "update" ? (
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {changes.slice(0, 8).map(([name, c]) => (
                    <li key={name}>
                      {label(name)}: <span className="line-through">{String(c.old ?? "—")}</span> →{" "}
                      {String(c.new ?? "—")}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
