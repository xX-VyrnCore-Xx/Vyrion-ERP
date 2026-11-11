import { useEffect } from "react";

import { inDesktop } from "../lib/native";

/**
 * The tray menu (Windows) talks to the page through two events: "go to this screen" and
 * "synchronise now". Outside the desktop shell there is no tray and nothing is registered.
 */
export function useTrayEvents(go: (to: string) => void, syncNow: () => Promise<void>): void {
  useEffect(() => {
    if (!inDesktop()) return;
    let active = true;
    const unlisteners: (() => void)[] = [];
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const navigate = await listen<string>("tray-navigate", (event) => go(event.payload));
      const sync = await listen("tray-sync", () => void syncNow());
      if (active) unlisteners.push(navigate, sync);
      else {
        navigate();
        sync();
      }
    });
    return () => {
      active = false;
      for (const stop of unlisteners) stop();
    };
  }, [go, syncNow]);
}
