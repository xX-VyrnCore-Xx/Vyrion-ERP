import { useState } from "react";

import { useSync } from "../app/sync";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { formatInstant } from "../ui/format";
import { Badge, Empty, ErrorNote, TABLE, TD, TH } from "../ui/parts";
import type { AuditEntry, Page } from "./types";
import { useRemote } from "./useRemote";

/** Who did what on the server, newest first. */
export function AuditPane() {
  const sync = useSync();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const [action, setAction] = useState("");
  const log = useRemote(
    () =>
      sync.request<Page<AuditEntry>>(
        "GET",
        `/audit-log?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${action ? `&action=${encodeURIComponent(action)}` : ""}`,
      ),
    [cursor, action],
  );
  const next = log.data?.next_cursor ?? null;
  return (
    <Card title="Registro attività">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          aria-label="Filtra per azione"
          placeholder="Azione (es. user.create)"
          value={action}
          onChange={(e) => {
            setAction(e.target.value.trim());
            setCursors([null]);
          }}
          className="rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-fg"
        />
        <Button onClick={log.reload}>Aggiorna</Button>
      </div>
      <ErrorNote message={log.error} />
      {log.data && log.data.items.length === 0 ? (
        <Empty>Nessuna attività registrata.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Quando</th>
                <th className={TH}>Azione</th>
                <th className={TH}>Su</th>
                <th className={TH}>Da</th>
              </tr>
            </thead>
            <tbody>
              {(log.data?.items ?? []).map((e) => (
                <tr key={e.id}>
                  <td className={`${TD} whitespace-nowrap`}>{formatInstant(e.occurred_at)}</td>
                  <td className={TD}>
                    <Badge>{e.action}</Badge>
                  </td>
                  <td className={TD}>{e.entity_type}</td>
                  <td className={`${TD} text-xs text-muted`}>{e.ip_address ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex justify-between">
        <Button disabled={cursors.length <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>
          Più recenti
        </Button>
        <Button disabled={!next} onClick={() => next && setCursors((c) => [...c, next])}>
          Più vecchie
        </Button>
      </div>
    </Card>
  );
}
