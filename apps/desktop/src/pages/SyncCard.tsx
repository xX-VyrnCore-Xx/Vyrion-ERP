import { useState, type FormEvent } from "react";

import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { useSync } from "../app/sync";
import { REASONS } from "../sync/engine";
import { formatInstant } from "../ui/format";
import { Badge, ErrorNote } from "../ui/parts";

const show = (value: unknown): string =>
  value === null || value === undefined || value === "" ? "—" : String(value);

/** Link to the company server (optional, whenever the person wants) and synchronisation. */
export function SyncCard({ serverUrl }: { serverUrl: string | null }) {
  const sync = useSync();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (error: unknown) =>
    setMessage(error instanceof Error ? error.message : String(error));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!serverUrl) return;
    setMessage(null);
    setBusy(true);
    try {
      if (needsCode) {
        await sync.finishConnect(code);
      } else if ((await sync.connect(serverUrl, email.trim(), password)) === "second_factor") {
        setNeedsCode(true);
        return;
      }
      setPassword("");
      setCode("");
      setNeedsCode(false);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg";
  return (
    <Card title="Sincronizzazione">
      {!sync.connected ? (
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <p className="text-sm text-muted">
            Collega questa installazione al server aziendale per condividere i dati con gli altri
            computer. I dati già inseriti vengono inviati al primo collegamento; puoi scollegarti
            quando vuoi e continuare a lavorare da solo.
          </p>
          {!serverUrl ? (
            <p className="text-sm text-warning">
              Inserisci prima l'indirizzo del server qui sopra.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">Server: {serverUrl}</p>
              <label className="block text-xs font-medium text-muted">
                Email
                <input
                  className={`${input} mt-1`}
                  type="email"
                  autoComplete="username"
                  value={email}
                  disabled={needsCode}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="block text-xs font-medium text-muted">
                Password
                <input
                  className={`${input} mt-1`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={needsCode}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {needsCode ? (
                <label className="block text-xs font-medium text-muted">
                  Codice di verifica (app di autenticazione o codice di recupero)
                  <input
                    className={`${input} mt-1`}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
              ) : null}
              <ErrorNote message={message} />
              <Button type="submit" variant="primary" disabled={busy || !email || !password}>
                {busy ? "Collegamento…" : needsCode ? "Conferma" : "Collega"}
              </Button>
            </>
          )}
        </form>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Collegato come</dt>
            <dd>{sync.email}</dd>
            <dt className="text-muted">Server</dt>
            <dd className="break-all">{sync.serverUrl}</dd>
            <dt className="text-muted">Ultima sincronizzazione</dt>
            <dd>{sync.lastSyncAt ? formatInstant(sync.lastSyncAt) : "mai"}</dd>
            <dt className="text-muted">In attesa di invio</dt>
            <dd>{sync.pending}</dd>
          </dl>
          {sync.lastReport ? (
            <p role="status" className="text-sm text-muted">
              Ultimo ciclo: inviati {sync.lastReport.sent}, ricevuti {sync.lastReport.received}
              {sync.lastReport.merged ? `, uniti automaticamente ${sync.lastReport.merged}` : ""}
              {sync.lastReport.problems.length
                ? ` · ${sync.lastReport.problems.length} da controllare`
                : ""}
              .
            </p>
          ) : null}
          {sync.reachable === false ? (
            <p role="status" className="text-sm text-warning">
              Server non raggiungibile: i dati restano sul computer e si inviano da soli appena
              torna disponibile
              {sync.retryIn !== null ? ` (nuovo tentativo tra ${sync.retryIn} s)` : ""}.
            </p>
          ) : (
            <ErrorNote message={sync.error} />
          )}
          {sync.lastReport?.problems.length ? (
            <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              {sync.lastReport.problems.slice(0, 5).map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" disabled={sync.syncing} onClick={() => void sync.syncNow()}>
              {sync.syncing ? "Sincronizzazione…" : "Sincronizza ora"}
            </Button>
            <Button disabled={sync.syncing} onClick={() => void sync.disconnect().catch(fail)}>
              Scollega
            </Button>
          </div>
          <p className="text-xs text-muted">
            Scollegando, i dati restano su questo computer; le modifiche non ancora inviate non
            verranno inviate. La sincronizzazione parte da sola ogni minuto.
          </p>

          {sync.conflicts.length ? (
            <section aria-label="Conflitti da risolvere" className="space-y-3">
              <h3 className="text-sm font-semibold text-fg">
                Conflitti da risolvere <Badge tone="danger">{sync.conflicts.length}</Badge>
              </h3>
              {sync.conflicts.map((c) => (
                <article key={c.id} className="rounded-lg border border-danger/40 p-3 text-sm">
                  <h4 className="font-medium text-fg">
                    {c.entityLabel}:{" "}
                    {show(
                      c.server?.data["name"] ??
                        c.server?.data["title"] ??
                        c.server?.data["description"] ??
                        c.entityId,
                    )}
                  </h4>
                  <p className="mb-2 text-xs text-muted">{REASONS[c.reason] ?? c.reasonText}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-muted">La tua modifica</div>
                      <ul className="text-xs">
                        {Object.entries(c.local)
                          .filter(([k]) => c.fields.length === 0 || c.fields.includes(k))
                          .slice(0, 6)
                          .map(([k, v]) => (
                            <li key={k}>
                              {k}: <span className="text-fg">{show(v)}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted">Sul server</div>
                      <ul className="text-xs">
                        {c.server ? (
                          Object.entries(c.server.data)
                            .filter(([k]) => c.fields.length === 0 || c.fields.includes(k))
                            .slice(0, 6)
                            .map(([k, v]) => (
                              <li key={k}>
                                {k}: <span className="text-fg">{show(v)}</span>
                              </li>
                            ))
                        ) : (
                          <li>nessun dato</li>
                        )}
                        {c.server?.deleted ? <li className="text-warning">eliminato</li> : null}
                      </ul>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {c.canKeepMine ? (
                      <Button onClick={() => void sync.resolve(c.id, "mine").catch(fail)}>
                        Tieni la mia
                      </Button>
                    ) : null}
                    <Button onClick={() => void sync.resolve(c.id, "server").catch(fail)}>
                      Usa quella del server
                    </Button>
                  </div>
                </article>
              ))}
              <ErrorNote message={message} />
            </section>
          ) : null}
        </div>
      )}
    </Card>
  );
}
