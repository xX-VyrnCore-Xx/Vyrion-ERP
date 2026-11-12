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
/** Retry delays after the server could not be reached, in seconds; the last repeats. */
const RETRY_STEPS = [5, 10, 20, 40, 60];
/** Wait after the last local change before sending it. */
const WRITE_DEBOUNCE_MS = 1500;

export interface SyncState {
  connected: boolean;
  /** Whether the last attempt reached the server (null before the first attempt). */
  reachable: boolean | null;
  /** Seconds until the next automatic retry while the server is unreachable. */
  retryIn: number | null;
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
  /** A signed-in call to the server API; rejects when not connected. */
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

const EMPTY: SyncState = {
  connected: false,
  reachable: null,
  retryIn: null,
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
  const transportRef = useRef<HttpTransport | null>(null);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdown = useRef<ReturnType<typeof setInterval> | null>(null);

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
      transportRef.current = transport;
      return new SyncEngine(ws, transport);
    },
    [ws],
  );

  const runRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const clearRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (countdown.current) clearInterval(countdown.current);
    retryTimer.current = null;
    countdown.current = null;
  }, []);

  const run = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || busy.current) return;
    busy.current = true;
    clearRetry();
    patch({ syncing: true, error: null });
    let unreachable = false;
    try {
      const report = await engine.syncNow();
      failures.current = 0;
      patch({ lastReport: report, reachable: true, retryIn: null });
    } catch (error) {
      unreachable =
        error instanceof ServerError && (error.code === "network" || error.code === "timeout");
      const text = unreachable
        ? "Server non raggiungibile: i dati restano sul computer e si invieranno appena possibile."
        : message(error);
      patch({ error: text, ...(unreachable ? { reachable: false } : { reachable: true }) });
    } finally {
      busy.current = false;
      patch({ syncing: false });
      await refresh();
    }
    if (unreachable) {
      // Keep trying with growing pauses, and show the person when the next attempt comes.
      const step = RETRY_STEPS[Math.min(failures.current, RETRY_STEPS.length - 1)] ?? 60;
      failures.current++;
      let left = step;
      patch({ retryIn: left });
      countdown.current = setInterval(() => {
        left = Math.max(0, left - 1);
        patch({ retryIn: left });
      }, 1000);
      retryTimer.current = setTimeout(() => void runRef.current(), step * 1000);
    }
  }, [patch, refresh, clearRetry]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

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
    // The network is back: do not wait for the timer, send and fetch right now.
    const onOnline = () => {
      failures.current = 0;
      void run();
    };
    const onOffline = () => patch({ reachable: false });
    // Local changes go out a moment after the last one, not only once a minute.
    let writeTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = ws.subscribe(() => {
      clearTimeout(writeTimer);
      writeTimer = setTimeout(() => {
        void (async () => {
          if ((await engineRef.current?.pendingCount()) ?? 0) await run();
          else await refresh();
        })();
      }, WRITE_DEBOUNCE_MS);
    });
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      clearTimeout(writeTimer);
      unsubscribe();
      clearRetry();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.connected, run, ws, patch, refresh, clearRetry]);

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
      request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const transport = transportRef.current;
        if (!transport) return Promise.reject(new Error("Non sei collegato al server"));
        return transport.request<T>(method, path, body);
      },
      async disconnect() {
        const session = await getSetting<SyncSession>(ws.db, SESSION);
        await engineRef.current?.disconnect();
        if (session) await logout(session);
        await setSetting(ws.db, SESSION, null, ws.ctx.now());
        engineRef.current = null;
        transportRef.current = null;
        clearRetry();
        setState(EMPTY);
      },
    }),
    [state, run, start, refresh, ws, clearRetry],
  );

  return <Context.Provider value={api}>{children}</Context.Provider>;
}
