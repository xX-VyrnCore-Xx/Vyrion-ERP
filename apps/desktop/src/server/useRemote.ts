import { useCallback, useEffect, useState, type DependencyList } from "react";

export interface Remote<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Loads something from the server on mount and on demand (not on local data changes). */
export function useRemote<T>(load: () => Promise<T>, deps: DependencyList): Remote<T> {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<Remote<T>, "reload">>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    let current = true;
    load().then(
      (data) => current && setState({ data, error: null, loading: false }),
      (error: unknown) =>
        current &&
        setState((s) => ({
          data: s.data,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
        })),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
