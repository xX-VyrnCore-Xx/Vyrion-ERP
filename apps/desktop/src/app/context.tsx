import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type DependencyList,
} from "react";

import type { Workspace } from "../data/workspace";

interface AppContextValue {
  ws: Workspace;
  volatile: boolean;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp outside of AppContext");
  return value;
}

export const useWorkspace = (): Workspace => useApp().ws;

/** Re-renders whenever data changes anywhere in the workspace. */
export function useRevision(): number {
  const ws = useWorkspace();
  return useSyncExternalStore(ws.subscribe, ws.getRevision);
}

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Runs `load` on mount, when `deps` change and when data changes in the workspace. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): Async<T> {
  const revision = useRevision();
  const [state, setState] = useState<Async<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let current = true;
    load().then(
      (data) => {
        if (current) setState({ data, error: null, loading: false });
      },
      (error: unknown) => {
        if (current)
          setState((s) => ({
            data: s.data,
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          }));
      },
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, ...deps]);
  return state;
}
