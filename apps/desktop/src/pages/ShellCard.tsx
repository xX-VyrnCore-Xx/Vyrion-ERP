import { useState } from "react";

import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { useAsync } from "../app/context";
import { inDesktop, shell } from "../lib/native";
import { ErrorNote } from "../ui/parts";

/** How the application behaves on this computer: window close and quitting for good. */
export function ShellCard() {
  const desktop = inDesktop();
  const prefs = useAsync(async () => (desktop ? shell.prefs() : null), [desktop]);
  const [message, setMessage] = useState<string | null>(null);
  const [override, setOverride] = useState<boolean | null>(null);
  if (!desktop) return null;

  const closeToTray = override ?? prefs.data?.close_to_tray ?? true;
  const change = async (enabled: boolean) => {
    setMessage(null);
    try {
      await shell.setCloseToTray(enabled);
      setOverride(enabled);
    } catch (error) {
      setMessage(
        typeof error === "string" ? error : error instanceof Error ? error.message : String(error),
      );
    }
  };

  return (
    <Card title="Applicazione">
      <div className="space-y-3">
        {prefs.data?.tray_supported ? (
          <>
            <label className="flex items-start gap-3 text-sm text-fg">
              <input
                type="checkbox"
                checked={closeToTray}
                onChange={(e) => void change(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              <span>
                Alla chiusura della finestra, lascia Vyrion ERP attivo nella barra delle
                applicazioni
                <span className="mt-0.5 block text-xs text-muted">
                  L'icona vicino all'orologio ha un menu (clic destro) con azioni rapide e «Esci
                  definitivamente». Un clic sull'icona riapre la finestra. Se la disattivi, chiudere
                  la finestra chiude l'applicazione.
                </span>
              </span>
            </label>
          </>
        ) : null}
        <ErrorNote message={message} />
        <div>
          <Button onClick={() => void shell.quit()}>Esci da Vyrion ERP</Button>
          <p className="mt-1 text-xs text-muted">
            Chiude l'applicazione per davvero, anche se era nascosta nella barra.
          </p>
        </div>
      </div>
    </Card>
  );
}
