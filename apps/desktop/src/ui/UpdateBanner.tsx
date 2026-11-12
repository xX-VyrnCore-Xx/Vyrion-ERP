import { useUpdates } from "../app/updates";

const percent = (done: number, total: number | null): string =>
  total ? `${Math.min(100, Math.round((done / total) * 100))}%` : "…";

/** Shown at the top of the window when a new version is ready to install. */
export function UpdateBanner() {
  const { supported, state, install, restart } = useUpdates();
  if (!supported) return null;

  if (state.status === "available") {
    return (
      <div
        role="status"
        className="flex items-center justify-between gap-4 border-b border-line bg-success/10 px-8 py-2 text-sm"
      >
        <span>
          È disponibile <strong>Vyrion ERP {state.info.version}</strong>. L'aggiornamento si
          installa da solo e l'app riparte; i dati restano dove sono.
        </span>
        <button
          type="button"
          onClick={() => void install()}
          className="shrink-0 rounded-lg bg-[image:var(--gradient-accent)] px-3 py-1 text-xs font-medium text-accent-contrast shadow-glow hover:brightness-110"
        >
          Aggiorna ora
        </button>
      </div>
    );
  }
  if (state.status === "downloading") {
    return (
      <div role="status" className="border-b border-line bg-success/10 px-8 py-2 text-sm">
        Scarico la versione {state.info.version}:{" "}
        {percent(state.progress.downloaded, state.progress.total)}
      </div>
    );
  }
  if (state.status === "installed") {
    return (
      <div
        role="status"
        className="flex items-center justify-between gap-4 border-b border-line bg-success/10 px-8 py-2 text-sm"
      >
        <span>Versione {state.info.version} installata.</span>
        <button
          type="button"
          onClick={() => void restart()}
          className="shrink-0 rounded-lg bg-[image:var(--gradient-accent)] px-3 py-1 text-xs font-medium text-accent-contrast shadow-glow hover:brightness-110"
        >
          Riavvia ora
        </button>
      </div>
    );
  }
  return null;
}
