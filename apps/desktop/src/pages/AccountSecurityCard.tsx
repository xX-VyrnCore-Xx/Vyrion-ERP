import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { useSync } from "../app/sync";
import { formatInstant } from "../ui/format";
import { Badge, ErrorNote } from "../ui/parts";

interface Me {
  user: { full_name: string; email: string; totp_enabled: boolean; last_login_at: string | null };
  second_factor_required: boolean;
}
interface SessionRow {
  id: string;
  last_used_at: string;
  ip_address: string | null;
  user_agent: string | null;
  current: boolean;
}
interface LoginRow {
  id: string;
  occurred_at: string;
  success: boolean;
  ip_address: string | null;
}

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg";
const MIN_PASSWORD = 12;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A short name for a browser/desktop user agent. */
const device = (agent: string | null): string => {
  if (!agent) return "Dispositivo sconosciuto";
  if (/Vyrion|Tauri/i.test(agent)) return "App Vyrion ERP";
  if (/Edg\//.test(agent)) return "Edge";
  if (/Chrome\//.test(agent)) return "Chrome";
  if (/Firefox\//.test(agent)) return "Firefox";
  if (/Safari\//.test(agent)) return "Safari";
  return agent.slice(0, 40);
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

/** Recovery codes, shown once: the person must keep them. */
function Codes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <p className="text-sm text-fg">
        <strong>Conserva questi codici di recupero.</strong> Servono se perdi l'app di
        autenticazione; ognuno vale una sola volta e non verranno più mostrati.
      </p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm text-fg">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            void navigator.clipboard
              .writeText(codes.join("\n"))
              .then(() => setCopied(true))
              .catch(() => undefined);
          }}
        >
          {copied ? "Copiati" : "Copia i codici"}
        </Button>
        <Button variant="primary" onClick={onDone}>
          Li ho salvati
        </Button>
      </div>
    </div>
  );
}

/** Account on the company server: password, two-factor, recovery codes and signed-in devices. */
export function AccountSecurityCard() {
  const sync = useSync();
  // Only with a live link: without it there is no account to manage.
  if (!sync.connected || sync.needsLogin) return null;
  return <AccountPanel />;
}

function AccountPanel() {
  const { request } = useSync();
  const [me, setMe] = useState<Me | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [logins, setLogins] = useState<LoginRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [panel, setPanel] = useState<"password" | "enable" | "disable" | "codes" | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState("");

  const [rev, setRev] = useState(0);
  const load = useCallback(() => setRev((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    Promise.all([
      request<Me>("GET", "/auth/me"),
      request<SessionRow[]>("GET", "/auth/sessions"),
      request<LoginRow[]>("GET", "/auth/login-history?limit=8"),
    ]).then(
      ([m, s, l]) => {
        if (!live) return;
        // A server that answers with something unexpected must not break the page.
        setMe(m?.user ? m : null);
        setSessions(Array.isArray(s) ? s : []);
        setLogins(Array.isArray(l) ? l : []);
        setError(null);
      },
      (e: unknown) => {
        if (live) setError(errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [request, rev]);

  const reset = () => {
    setPanel(null);
    setSetup(null);
    setCurrent("");
    setNext("");
    setAgain("");
    setCode("");
  };

  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const done = await job();
      if (typeof done === "string" && done) setNotice(done);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const changePassword = (event: FormEvent) => {
    event.preventDefault();
    if (next.length < MIN_PASSWORD)
      return setError(`La nuova password deve avere almeno ${MIN_PASSWORD} caratteri.`);
    if (next !== again) return setError("Le due password nuove non coincidono.");
    void run(async () => {
      const result = await request<{ sessions_revoked: number }>("POST", "/auth/password/change", {
        current_password: current,
        new_password: next,
      });
      reset();
      return result.sessions_revoked
        ? `Password cambiata. Sono stati scollegati ${result.sessions_revoked} altri dispositivi.`
        : "Password cambiata.";
    });
  };

  const beginEnable = () =>
    void run(async () => {
      const r = await request<{ secret: string; otpauth_uri: string }>("POST", "/auth/2fa/setup");
      setSetup({ secret: r.secret, uri: r.otpauth_uri });
      setPanel("enable");
    });

  const confirmEnable = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const r = await request<{ recovery_codes: string[] }>("POST", "/auth/2fa/enable", { code });
      reset();
      setCodes(r.recovery_codes);
      return "Verifica in due passaggi attivata.";
    });
  };

  const regenerate = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const r = await request<{ recovery_codes: string[] }>("POST", "/auth/2fa/recovery-codes", {
        password: current,
        code,
      });
      reset();
      setCodes(r.recovery_codes);
    });
  };

  const disable = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await request("POST", "/auth/2fa/disable", { password: current, code });
      reset();
      return "Verifica in due passaggi disattivata.";
    });
  };

  const signOutOthers = () =>
    void run(async () => {
      const others = sessions.filter((s) => !s.current);
      await Promise.all(others.map((s) => request("DELETE", `/auth/sessions/${s.id}`)));
      return others.length ? "Gli altri dispositivi sono stati scollegati." : null;
    });

  const twoFactor = me?.user.totp_enabled ?? false;
  const others = sessions.filter((s) => !s.current);

  return (
    <Card title="Il tuo account sul server">
      <div className="space-y-5">
        {me ? (
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-contrast">
              {me.user.full_name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0] ?? "")
                .join("")
                .toUpperCase() || "?"}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-fg">{me.user.full_name}</div>
              <div className="truncate text-xs text-muted">
                {me.user.email}
                {me.user.last_login_at
                  ? ` · ultimo accesso ${formatInstant(me.user.last_login_at)}`
                  : ""}
              </div>
            </div>
            <span className="ml-auto">
              <Badge tone={twoFactor ? "success" : "warning"}>
                {twoFactor ? "2FA attiva" : "2FA non attiva"}
              </Badge>
            </span>
          </div>
        ) : null}

        {me?.second_factor_required ? (
          <div
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            Il server richiede la verifica in due passaggi per gli amministratori: attivala qui
            sotto per continuare a usare l'account.
          </div>
        ) : null}
        <ErrorNote message={error} />
        {notice ? (
          <p role="status" className="text-sm text-success">
            {notice}
          </p>
        ) : null}
        {codes ? <Codes codes={codes} onDone={() => setCodes(null)} /> : null}

        <section aria-label="Password" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">Password</h3>
              <p className="text-xs text-muted">
                Cambiandola, gli altri dispositivi vengono scollegati; questo resta collegato.
              </p>
            </div>
            {panel !== "password" ? (
              <Button
                onClick={() => {
                  reset();
                  setPanel("password");
                }}
              >
                Cambia password
              </Button>
            ) : null}
          </div>
          {panel === "password" ? (
            <form onSubmit={changePassword} className="grid max-w-md gap-3">
              <Field label="Password attuale">
                <input
                  className={input}
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
              <Field label={`Nuova password (almeno ${MIN_PASSWORD} caratteri)`}>
                <input
                  className={input}
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              </Field>
              <Field label="Ripeti la nuova password">
                <input
                  className={input}
                  type="password"
                  autoComplete="new-password"
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={busy || !current || !next}>
                  Salva la password
                </Button>
                <Button onClick={reset}>Annulla</Button>
              </div>
            </form>
          ) : null}
        </section>

        <section aria-label="Verifica in due passaggi" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">Verifica in due passaggi</h3>
              <p className="text-xs text-muted">
                Oltre alla password serve un codice dall'app di autenticazione.
              </p>
            </div>
            {panel === null || panel === "password" ? (
              twoFactor ? (
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      reset();
                      setPanel("codes");
                    }}
                  >
                    Nuovi codici di recupero
                  </Button>
                  <Button
                    onClick={() => {
                      reset();
                      setPanel("disable");
                    }}
                  >
                    Disattiva
                  </Button>
                </div>
              ) : (
                <Button variant="primary" disabled={busy || !me} onClick={beginEnable}>
                  Attiva
                </Button>
              )
            ) : null}
          </div>
          {panel === "enable" && setup ? (
            <form onSubmit={confirmEnable} className="grid max-w-md gap-3">
              <p className="text-sm text-muted">
                Nell'app di autenticazione (Google Authenticator, Microsoft Authenticator, Aegis…)
                aggiungi un account con inserimento manuale usando questa chiave:
              </p>
              <code className="select-all break-all rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm text-fg">
                {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
              </code>
              <Field label="Codice a 6 cifre mostrato dall'app">
                <input
                  className={input}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={busy || code.length < 6}>
                  Conferma e attiva
                </Button>
                <Button onClick={reset}>Annulla</Button>
              </div>
            </form>
          ) : null}
          {panel === "codes" || panel === "disable" ? (
            <form
              onSubmit={panel === "codes" ? regenerate : disable}
              className="grid max-w-md gap-3"
            >
              <p className="text-sm text-muted">
                {panel === "codes"
                  ? "I codici attuali smetteranno di funzionare. Conferma con password e codice."
                  : "Conferma con password e codice per togliere la protezione."}
              </p>
              <Field label="Password">
                <input
                  className={input}
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
              <Field label="Codice dell'app (o codice di recupero)">
                <input
                  className={input}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={busy || !current || !code}>
                  {panel === "codes" ? "Genera nuovi codici" : "Disattiva"}
                </Button>
                <Button onClick={reset}>Annulla</Button>
              </div>
            </form>
          ) : null}
        </section>

        <section aria-label="Dispositivi" className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-fg">Dispositivi collegati</h3>
            {others.length ? (
              <Button disabled={busy} onClick={signOutOthers}>
                Scollega gli altri ({others.length})
              </Button>
            ) : null}
          </div>
          <ul className="divide-y divide-line/60 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-fg">
                    {device(s.user_agent)}
                    {s.current ? (
                      <span className="ml-2">
                        <Badge tone="info">questo</Badge>
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {s.ip_address ?? "indirizzo ignoto"} · attivo {formatInstant(s.last_used_at)}
                  </div>
                </div>
                {s.current ? null : (
                  <Button
                    disabled={busy}
                    onClick={() => void run(() => request("DELETE", `/auth/sessions/${s.id}`))}
                  >
                    Scollega
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {logins.length ? (
          <section aria-label="Ultimi accessi" className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">Ultimi accessi</h3>
            <ul className="space-y-1 text-xs text-muted">
              {logins.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${l.success ? "bg-success" : "bg-danger"}`}
                  />
                  {formatInstant(l.occurred_at)} · {l.success ? "riuscito" : "non riuscito"}
                  {l.ip_address ? ` · ${l.ip_address}` : ""}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Card>
  );
}
