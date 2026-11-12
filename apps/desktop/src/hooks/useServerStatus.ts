import { useCallback, useEffect, useRef, useState } from "react";

import { nextDelay } from "../lib/backoff";
import { fetchReadiness, type ComponentState } from "../lib/health";
import { whenVisible } from "../lib/visibility";

export type ConnectionState = "unconfigured" | "checking" | "online" | "degraded" | "offline";

export interface ServerStatus {
  state: ConnectionState;
  version: string | null;
  components: Record<string, ComponentState> | null;
  lastCheckedAt: Date | null;
  checkNow: () => void;
}

type Snapshot = Omit<ServerStatus, "checkNow" | "state"> & {
  state: Exclude<ConnectionState, "unconfigured">;
  url: string | null;
};

const INITIAL: Snapshot = {
  state: "checking",
  version: null,
  components: null,
  lastCheckedAt: null,
  url: null,
};

/** Polls the backend readiness endpoint and reconnects automatically after outages. */
export function useServerStatus(serverUrl: string | null): ServerStatus {
  const [snapshot, setSnapshot] = useState<Snapshot>(INITIAL);
  const trigger = useRef<() => void>(() => {});

  useEffect(() => {
    if (serverUrl === null) return;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let running = false;
    let cancelWait: () => void = () => undefined;

    const probe = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      clearTimeout(timer);
      const result = await fetchReadiness(serverUrl, { signal: controller.signal });
      running = false;
      if (controller.signal.aborted) return;

      const reachable = result.state !== "offline";
      failures = reachable ? 0 : failures + 1;
      setSnapshot({
        state: result.state,
        version: reachable ? result.version : null,
        components: reachable ? result.components : null,
        lastCheckedAt: new Date(),
        url: serverUrl,
      });
      // Nobody is looking while the window is hidden: wait for it to come back instead of
      // waking the network and the CPU every few seconds.
      timer = setTimeout(
        () => {
          cancelWait = whenVisible(() => void probe());
        },
        nextDelay(reachable, failures),
      );
    };

    trigger.current = () => void probe();
    const onNetworkChange = () => void probe();
    window.addEventListener("online", onNetworkChange);
    window.addEventListener("focus", onNetworkChange);
    void probe();

    return () => {
      controller.abort();
      clearTimeout(timer);
      cancelWait();
      window.removeEventListener("online", onNetworkChange);
      window.removeEventListener("focus", onNetworkChange);
      trigger.current = () => {};
    };
  }, [serverUrl]);

  const checkNow = useCallback(() => trigger.current(), []);

  if (serverUrl === null) {
    return {
      state: "unconfigured",
      version: null,
      components: null,
      lastCheckedAt: null,
      checkNow,
    };
  }
  // A result obtained for a previous URL must not be shown for the new one.
  const current = snapshot.url === serverUrl ? snapshot : INITIAL;
  return {
    state: current.state,
    version: current.version,
    components: current.components,
    lastCheckedAt: current.lastCheckedAt,
    checkNow,
  };
}
