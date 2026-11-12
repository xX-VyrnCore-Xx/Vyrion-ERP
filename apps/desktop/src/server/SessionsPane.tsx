import { useState } from "react";

import { useSync } from "../app/sync";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { formatInstant } from "../ui/format";
import { Badge, ErrorNote } from "../ui/parts";
import type { LoginEvent, ServerSession } from "./types";
import { useRemote } from "./useRemote";

/** The signed-in sessions of this account and its recent sign-ins. */
export function SessionsPane() {
  const sync = useSync();
  const sessions = useRemote(() => sync.request<ServerSession[]>("GET", "/auth/sessions"), []);
  const history = useRemote(() => sync.request<LoginEvent[]>("GET", "/auth/login-history"), []);
  const [error, setError] = useState<string | null>(null);
  const end = async (id: string) => {
    setError(null);
    try {
      await sync.request("DELETE", `/auth/sessions/${id}`);
      sessions.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Sessioni attive">
        <ErrorNote message={error ?? sessions.error} />
        <ul className="divide-y divide-line/60">
          {(sessions.data ?? []).map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-fg">
                  <span className="truncate">{s.user_agent ?? "Dispositivo"}</span>
                  {s.current ? <Badge tone="success">Questa</Badge> : null}
                </div>
                <div className="text-xs text-muted">
                  {s.ip_address ?? "—"} · ultimo uso {formatInstant(s.last_used_at)}
                </div>
              </div>
              {!s.current ? <Button onClick={() => void end(s.id)}>Termina</Button> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Ultimi accessi">
        <ErrorNote message={history.error} />
        <ul className="divide-y divide-line/60">
          {(history.data ?? []).slice(0, 20).map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-fg">{formatInstant(h.occurred_at)}</span>
              <span className="flex items-center gap-2 text-xs text-muted">
                {h.ip_address ?? "—"}
                <Badge tone={h.success ? "success" : "danger"}>
                  {h.success ? "Riuscito" : (h.failure_reason ?? "Fallito")}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
