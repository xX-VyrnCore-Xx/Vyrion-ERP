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

import { updates, type DownloadProgress, type UpdateInfo } from "../lib/updates";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current"; checkedAt: number }
  | { status: "available"; info: UpdateInfo }
  | { status: "downloading"; info: UpdateInfo; progress: DownloadProgress }
  | { status: "installed"; info: UpdateInfo }
  | { status: "error"; message: string };

interface UpdatesValue {
  supported: boolean;
  state: UpdateState;
  autoCheck: boolean;
  setAutoCheck: (enabled: boolean) => void;
  /** `quiet` hides errors (the automatic check must not nag when GitHub is unreachable). */
  check: (quiet?: boolean) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
}

const PREF_KEY = "vyrion.autoUpdate";
/** First automatic check shortly after start, then every six hours while the app is open. */
const FIRST_CHECK_MS = 15_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

const readPref = (): boolean => {
  try {
    return window.localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
};

const message = (error: unknown): string =>
  typeof error === "string" ? error : error instanceof Error ? error.message : String(error);

const Ctx = createContext<UpdatesValue | null>(null);

export function UpdatesProvider({ children }: { children: ReactNode }) {
  const supported = updates.available();
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [autoCheck, setAuto] = useState<boolean>(readPref);
  const busy = useRef(false);

  const check = useCallback(
    async (quiet = false) => {
      if (!supported || busy.current) return;
      busy.current = true;
      if (!quiet) setState({ status: "checking" });
      try {
        const info = await updates.check();
        setState(
          info ? { status: "available", info } : { status: "current", checkedAt: Date.now() },
        );
      } catch (error) {
        if (!quiet) setState({ status: "error", message: message(error) });
        else setState((s) => (s.status === "checking" ? { status: "idle" } : s));
      } finally {
        busy.current = false;
      }
    },
    [supported],
  );

  const install = useCallback(async () => {
    if (state.status !== "available") return;
    const info = state.info;
    busy.current = true;
    setState({ status: "downloading", info, progress: { downloaded: 0, total: null } });
    try {
      await updates.install((progress) => setState({ status: "downloading", info, progress }));
      setState({ status: "installed", info });
    } catch (error) {
      setState({ status: "error", message: message(error) });
    } finally {
      busy.current = false;
    }
  }, [state]);

  const setAutoCheck = useCallback((enabled: boolean) => {
    setAuto(enabled);
    try {
      window.localStorage.setItem(PREF_KEY, enabled ? "on" : "off");
    } catch {
      /* the choice only lasts until the app is closed */
    }
  }, []);

  useEffect(() => {
    if (!supported || !autoCheck) return;
    const first = window.setTimeout(() => void check(true), FIRST_CHECK_MS);
    const every = window.setInterval(() => void check(true), EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [supported, autoCheck, check]);

  const value = useMemo<UpdatesValue>(
    () => ({ supported, state, autoCheck, setAutoCheck, check, install, restart: updates.restart }),
    [supported, state, autoCheck, setAutoCheck, check, install],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUpdates(): UpdatesValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useUpdates needs an UpdatesProvider");
  return value;
}
