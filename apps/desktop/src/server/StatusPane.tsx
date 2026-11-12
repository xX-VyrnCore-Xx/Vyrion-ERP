import { RefreshCw } from "lucide-react";

import { useSync } from "../app/sync";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConnectionBadge } from "../components/ConnectionBadge";
import type { ServerStatus } from "../hooks/useServerStatus";
import { formatInstant } from "../ui/format";
import { Badge, ErrorNote } from "../ui/parts";
import { useWorkspace } from "../app/context";
import { useRemote } from "./useRemote";

const COMPONENTS: Record<string, string> = { database: "Database", redis: "Cache (Redis)" };

interface ServerFacts {
  head_seq: number;
  records: number;
  changes: number;
  last_change_at: string | null;
  devices: { device_id: string; changes: number; last_seen_at: string }[];
}

/** What the server holds and which devices have sent data to it. */
function ServerFactsCard() {
  const sync = useSync();
  const ws = useWorkspace();
  const facts = useRemote(
    () => sync.request<ServerFacts>("GET", "/sync/status"),
    [sync.lastSyncAt],
  );
  const data = facts.data;
  return (
    <Card title="Dati sul server">
      <ErrorNote message={facts.error} />
      {data ? (
        <div className="space-y-4">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Record</dt>
              <dd className="tabular-nums text-fg">{data.records}</dd>
            </div>
            <div>
              <dt className="text-muted">Modifiche registrate</dt>
              <dd className="tabular-nums text-fg">{data.changes}</dd>
            </div>
            <div>
              <dt className="text-muted">Ultima modifica</dt>
              <dd className="text-fg">
                {data.last_change_at ? formatInstant(data.last_change_at) : "—"}
              </dd>
            </div>
          </dl>
          {data.devices.length > 0 ? (
            <ul className="divide-y divide-line/60 text-sm">
              {data.devices.map((d) => (
                <li key={d.device_id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-fg">
                    Dispositivo {d.device_id.slice(0, 8)}
                    {d.device_id === ws.deviceId ? (
                      <span className="ml-2">
                        <Badge tone="success">Questo</Badge>
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted">
                    {d.changes} modifiche · ultima {formatInstant(d.last_seen_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">{facts.loading ? "Carico…" : "Nessun dato."}</p>
      )}
    </Card>
  );
}

/** Server health plus the state of the link: what is waiting, what changed, what clashes. */
export function StatusPane({
  serverUrl,
  status,
  go,
}: {
  serverUrl: string | null;
  status: ServerStatus;
  go: (to: string) => void;
}) {
  const sync = useSync();
  const offline = sync.connected && sync.reachable === false;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Server">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ConnectionBadge state={status.state} />
          {sync.connected ? (
            <Badge tone={offline ? "warning" : "success"}>
              {offline ? "Sincronizzazione in pausa" : "Sincronizzato"}
            </Badge>
          ) : null}
        </div>
        {status.state === "unconfigured" ? (
          <>
            <p className="mb-4 text-sm text-muted">
              Nessun server configurato: il software lavora solo in locale.
            </p>
            <Button variant="primary" onClick={() => go("settings/account")}>
              Imposta il server
            </Button>
          </>
        ) : (
          <>
            <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted">Indirizzo</dt>
              <dd className="truncate text-fg">{serverUrl}</dd>
              <dt className="text-muted">Versione</dt>
              <dd className="text-fg">{status.version ?? "—"}</dd>
              <dt className="text-muted">Ultimo controllo</dt>
              <dd className="text-fg">
                {status.lastCheckedAt ? status.lastCheckedAt.toLocaleTimeString("it-IT") : "mai"}
              </dd>
            </dl>
            <Button onClick={status.checkNow}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Controlla ora
            </Button>
          </>
        )}
      </Card>

      <Card title="Componenti">
        {status.components ? (
          <ul className="divide-y divide-line">
            {Object.entries(status.components).map(([name, c]) => (
              <li key={name} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-fg">{COMPONENTS[name] ?? name}</span>
                <span className="flex items-center gap-3">
                  {c.latencyMs !== null ? (
                    <span className="tabular-nums text-muted">{c.latencyMs} ms</span>
                  ) : null}
                  <span className={c.status === "ok" ? "text-success" : "text-danger"}>
                    {c.status === "ok" ? "Operativo" : "Errore"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nessun dato: il server non è raggiungibile.</p>
        )}
      </Card>

      <div className="lg:col-span-2">
        <Card title="Sincronizzazione">
          {!sync.connected ? (
            <>
              <p className="mb-4 text-sm text-muted">
                Accedi al server per condividere i dati: le modifiche fatte offline si inviano da
                sole appena il server è di nuovo raggiungibile.
              </p>
              <Button variant="primary" onClick={() => go("settings/account")}>
                Accedi al server
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-muted">Collegato come</dt>
                  <dd className="truncate text-fg">{sync.email}</dd>
                </div>
                <div>
                  <dt className="text-muted">Ultima sincronizzazione</dt>
                  <dd className="text-fg">
                    {sync.lastSyncAt ? formatInstant(sync.lastSyncAt) : "mai"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Modifiche da inviare</dt>
                  <dd className="tabular-nums text-fg">{sync.pending}</dd>
                </div>
                <div>
                  <dt className="text-muted">Conflitti</dt>
                  <dd className="tabular-nums text-fg">{sync.conflicts.length}</dd>
                </div>
              </dl>
              {offline ? (
                <p role="status" className="text-sm text-warning">
                  Server non raggiungibile: i dati restano sul computer.
                  {sync.retryIn !== null
                    ? ` Nuovo tentativo tra ${sync.retryIn} s, oppure subito appena torna la rete.`
                    : ""}
                </p>
              ) : sync.lastReport ? (
                <p role="status" className="text-sm text-muted">
                  Ultimo ciclo: inviati {sync.lastReport.sent}, ricevuti {sync.lastReport.received}
                  {sync.lastReport.merged ? `, uniti ${sync.lastReport.merged}` : ""}.
                </p>
              ) : null}
              <ErrorNote message={offline ? null : sync.error} />
              {sync.conflicts.length > 0 ? (
                <ul className="space-y-2">
                  {sync.conflicts.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
                    >
                      <span className="text-fg">
                        {c.entityLabel} · {c.reasonText}
                      </span>
                      <span className="flex gap-2">
                        {c.canKeepMine ? (
                          <Button onClick={() => void sync.resolve(c.id, "mine")}>
                            Tieni la mia
                          </Button>
                        ) : null}
                        <Button onClick={() => void sync.resolve(c.id, "server")}>
                          Usa quella del server
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button variant="primary" disabled={sync.syncing} onClick={() => void sync.syncNow()}>
                <RefreshCw aria-hidden="true" className="size-4" />
                {sync.syncing ? "Sincronizzazione…" : "Sincronizza ora"}
              </Button>
            </div>
          )}
        </Card>
      </div>
      {sync.connected && !offline ? (
        <div className="lg:col-span-2">
          <ServerFactsCard />
        </div>
      ) : null}
    </div>
  );
}
