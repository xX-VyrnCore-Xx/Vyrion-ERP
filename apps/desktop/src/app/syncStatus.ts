import type { SyncState } from "./sync";

export type SyncTone = "ok" | "info" | "warning" | "danger" | "muted";

export interface SyncSummary {
  label: string;
  tone: SyncTone;
}

/** "adesso", "3 minuti fa", "2 ore fa", "ieri"… for the last synchronisation. */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "mai";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "mai";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "adesso";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minuto fa" : `${minutes} minuti fa`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 ora fa" : `${hours} ore fa`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ieri" : `${days} giorni fa`;
}

/** One line that says how the link with the server is doing, and how worried to be. */
export function summarizeSync(
  state: Pick<
    SyncState,
    | "connected"
    | "syncing"
    | "reachable"
    | "retryIn"
    | "pending"
    | "conflicts"
    | "needsLogin"
    | "error"
  >,
): SyncSummary | null {
  if (!state.connected) return null;
  if (state.needsLogin) return { label: "Accedi di nuovo al server", tone: "danger" };
  if (state.conflicts.length)
    return {
      label:
        state.conflicts.length === 1
          ? "1 conflitto da risolvere"
          : `${state.conflicts.length} conflitti da risolvere`,
      tone: "danger",
    };
  if (state.syncing) return { label: "Sincronizzazione…", tone: "info" };
  if (state.reachable === false)
    return {
      label:
        state.pending > 0
          ? `Offline: ${state.pending} modifiche in attesa`
          : "Offline: nuovo tentativo a breve",
      tone: "warning",
    };
  if (state.error) return { label: "Errore di sincronizzazione", tone: "danger" };
  if (state.pending > 0)
    return {
      label: state.pending === 1 ? "1 modifica in attesa" : `${state.pending} modifiche in attesa`,
      tone: "info",
    };
  return { label: "Sincronizzato", tone: "ok" };
}
