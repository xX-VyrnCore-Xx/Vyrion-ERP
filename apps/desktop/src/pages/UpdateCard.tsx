import { useEffect, useState } from "react";

import { useUpdates } from "../app/updates";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { inDesktop, native } from "../lib/native";

/** Settings: the installed version, a manual check and the automatic-check switch. */
export function UpdateCard() {
  const { supported, state, autoCheck, setAutoCheck, check, install, restart } = useUpdates();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!inDesktop()) return;
    void native.appInfo().then(
      (info) => setVersion(info.version),
      () => setVersion(null),
    );
  }, []);
  if (!supported) return null;

  const busy = state.status === "checking" || state.status === "downloading";
  let line: string;
  switch (state.status) {
    case "checking":
      line = "Controllo in corso…";
      break;
    case "current":
      line = "Hai già l'ultima versione.";
      break;
    case "available":
      line = `Disponibile la versione ${state.info.version}.`;
      break;
    case "downloading":
      line = `Scarico la versione ${state.info.version}…`;
      break;
    case "installed":
      line = `Versione ${state.info.version} installata: riavvia per usarla.`;
      break;
    case "error":
      line = `Impossibile controllare gli aggiornamenti: ${state.message}`;
      break;
    default:
      line = "Non hai ancora controllato in questa sessione.";
  }

  return (
    <Card title="Aggiornamenti">
      <div className="space-y-3 text-sm">
        <p className="text-fg">
          Versione installata: <strong>{version ?? "—"}</strong>
        </p>
        <p className={state.status === "error" ? "text-danger" : "text-muted"} role="status">
          {line}
        </p>
        {state.status === "available" && state.info.notes ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-raised p-3 text-xs text-muted">
            {state.info.notes}
          </pre>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {state.status === "available" ? (
            <Button variant="primary" onClick={() => void install()}>
              Installa l'aggiornamento
            </Button>
          ) : state.status === "installed" ? (
            <Button variant="primary" onClick={() => void restart()}>
              Riavvia ora
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void check()}>
              Controlla aggiornamenti
            </Button>
          )}
        </div>
        <label className="flex items-start gap-3 text-fg">
          <input
            type="checkbox"
            checked={autoCheck}
            onChange={(e) => setAutoCheck(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--accent)]"
          />
          <span>
            Controlla automaticamente gli aggiornamenti
            <span className="mt-0.5 block text-xs text-muted">
              Poco dopo l'avvio e ogni sei ore l'app chiede a GitHub se esiste una versione più
              recente (non invia i tuoi dati). L'aggiornamento parte solo quando lo confermi. I
              pacchetti sono firmati: l'app rifiuta quelli non autentici.
            </span>
          </span>
        </label>
      </div>
    </Card>
  );
}
