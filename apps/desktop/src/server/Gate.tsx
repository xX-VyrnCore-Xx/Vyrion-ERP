import type { ReactNode } from "react";

import { useSync } from "../app/sync";
import { Button } from "../components/Button";
import { ErrorNote } from "../ui/parts";

/** Server administration needs a signed-in link: otherwise say so, with the way to get one. */
export function Gate({ go, children }: { go: (to: string) => void; children: ReactNode }) {
  const sync = useSync();
  if (!sync.connected) {
    return (
      <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
        <p className="mb-4 text-sm text-muted">
          Per gestire il server accedi con un account aziendale.
        </p>
        <Button variant="primary" onClick={() => go("settings/account")}>
          Accedi al server
        </Button>
      </div>
    );
  }
  if (sync.reachable === false) {
    return (
      <div className="space-y-3">
        <ErrorNote message="Server non raggiungibile: questa sezione funziona solo online. Il resto del software continua a lavorare." />
        <Button onClick={() => void sync.syncNow()}>Riprova ora</Button>
      </div>
    );
  }
  return <>{children}</>;
}
