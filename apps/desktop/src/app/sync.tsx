import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { isHidden } from "../lib/visibility";
import type { Workspace } from "../data/workspace";
import { getSetting, setSetting } from "../data/system";
import {
  HttpTransport,
  login,
  logout,
  secondFactor,
  ServerError,
  type SyncSession,
} from "../sync/api";
import { SyncEngine, type ConflictView, type SyncReport } from "../sync/engine";

const SESSION = "sync.session";
const AUTO_EVERY_MS = 60_000;
/** With the window hidden only one tick in this many runs. */
const HIDDEN_FACTOR = 5;

export interface SyncState {
  connected: boolean;
  email: string | null;
  serverUrl: string | null;
  syncing: boolean;
  pending: number;
  conflicts: ConflictView[];
  lastSyncAt: string | null;
  lastReport: SyncReport | null;
  error: string | null;
}

export interface SyncApi extends SyncState {
  /** Returns "second_factor" when the account needs a code, then call `finishConnect`. */
  connect(
    serverUrl: string,
    email: string,
    password: string,
  ): Promise<"connected" | "second_factor">;
  finishConnect(code: string): Promise<void>;
  syncNow(): Promise<void>;
  resolve(conflictId: number, choice: "mine" | "server"): Promise<void>;
  disconnect(): Promise<void>;
}

const EMPTY: SyncState = {
  connected: false,
  email: null,
  serverUrl: null,
  syncing: false,
  pending: 0,
  conflicts: [],
  lastSyncAt: null,
  lastReport: null,
  error: null,
};

const Context = createContext<SyncApi | null>(null);

export const useSync = (): SyncApi => {
  const value = useContext(Context);
  if (!value) throw new Error("useSync outside of SyncProvider");
  return value;
};

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Keeps the app linked to the server once the person has signed in: syncs at start, every
 * minute and when the window regains focus. Failures (offline, server down) never block the
 * app; they only show up here, and the next attempt tries again.
 */
export function SyncProvider({ ws, children }: { ws: Workspace; children: ReactNode }) {
  const [state, setState] = useState<SyncState>(EMPTY);
  const engineRef = useRef<SyncEngine | null>(null);
  const challenge = useRef<{ serverUrl: string; email: string; token: string } | null>(null);
  const busy = useRef(false);

  const patch = useCallback((next: Partial<SyncState>) => setState((s) => ({ ...s, ...next })), []);

  const refresh = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    patch({
      pending: await engine.pendingCount(),
      conflicts: await engine.conflicts(),
      lastSyncAt: await engine.lastSyncAt(),
    });
  }, [patch]);

  const build = useCallback(
    (session: SyncSession): SyncEngine => {
      const transport = new HttpTransport(session, ws.deviceId, (renewed) =>
        setSetting(ws.db, SESSION, renewed, ws.ctx.now()),
      );
      return new SyncEngine(ws, transport);
    },
    [ws],
  );

  const run = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || busy.current) return;
    busy.current = true;
    patch({ syncing: true, error: null });
    try {
      const report = await engine.syncNow();
      patch({ lastReport: report });
    } catch (error) {
      const text =
        error instanceof ServerError && error.code === "network"
          ? "Server non raggiungibile: i dati restano sul computer e si invieranno appena possibile."
          : message(error);
      patch({ error: text });
    } finally {
      busy.current = false;
      patch({ syncing: false });
      await refresh();
    }
  }, [patch, refresh]);

  // Resume the saved link at start.
  useEffect(() => {
    let current = true;
    void (async () => {
      const session = await getSetting<SyncSession>(ws.db, SESSION);
      if (!session || !current) return;
      engineRef.current = build(session);
      patch({ connected: true, email: session.email, serverUrl: session.serverUrl });
      await refresh();
      await run();
    })();
    return () => {
      current = false;
    };
  }, [ws, build, patch, refresh, run]);

  useEffect(() => {
    if (!state.connected) return;
    // While the window is hidden the link still syncs, but five times less often.
    let skipped = 0;
    const timer = setInterval(() => {
      if (isHidden() && ++skipped % HIDDEN_FACTOR !== 0) return;
      void run();
    }, AUTO_EVERY_MS);
    const onFocus = () => void run();
    const onVisible = () => {
      if (!isHidden()) void run();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.connected, run]);

  const start = useCallback(
    async (session: SyncSession) => {
      await setSetting(ws.db, SESSION, session, ws.ctx.now());
      const engine = build(session);
      engineRef.current = engine;
      patch({ connected: true, email: session.email, serverUrl: session.serverUrl, error: null });
      await engine.adopt(); // queue the data entered before the link, once
      await run();
    },
    [ws, build, patch, run],
  );

  const api = useMemo<SyncApi>(
    () => ({
      ...state,
      async connect(serverUrl, email, password) {
        const outcome = await login(serverUrl, email, password);
        if (outcome.status === "second_factor") {
          challenge.current = { serverUrl, email, token: outcome.challenge };
          return "second_factor";
        }
        await start(outcome.session);
        return "connected";
      },
      async finishConnect(code) {
        const pending = challenge.current;
        if (!pending) throw new Error("Accedi di nuovo");
        const session = await secondFactor(pending.serverUrl, pending.email, pending.token, code);
        challenge.current = null;
        await start(session);
      },
      syncNow: run,
      async resolve(conflictId, choice) {
        await engineRef.current?.resolve(conflictId, choice);
        await refresh();
        await run();
      },
      async disconnect() {
        const session = await getSetting<SyncSession>(ws.db, SESSION);
        await engineRef.current?.disconnect();
        if (session) await logout(session);
        await setSetting(ws.db, SESSION, null, ws.ctx.now());
        engineRef.current = null;
        setState(EMPTY);
      },
    }),
    [state, run, start, refresh, ws],
  );

  return <Context.Provider value={api}>{children}</Context.Provider>;
}
