import { invoke } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";

import { inDesktop } from "./native";

/** An update found on the GitHub releases. */
export interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

export type DownloadProgress = { downloaded: number; total: number | null };

/** The package that was found by the last check, kept for the install step. */
let found: Update | null = null;

/**
 * In-app updates (desktop only): the shell asks the latest GitHub release for a signed
 * package, verifies the signature with the public key built into the app, installs it, and the
 * application starts again. In a plain browser nothing happens.
 */
export const updates = {
  available: (): boolean => inDesktop(),

  /** Looks for a newer version. Resolves to null when this one is the latest. */
  check: async (): Promise<UpdateInfo | null> => {
    if (!inDesktop()) return null;
    const { check } = await import("@tauri-apps/plugin-updater");
    found = await check();
    return found
      ? { version: found.version, notes: found.body ?? null, date: found.date ?? null }
      : null;
  },

  /** Downloads and installs what the last check found, reporting progress. */
  install: async (onProgress: (progress: DownloadProgress) => void): Promise<void> => {
    if (!found) throw new Error("Nessun aggiornamento da installare: controlla di nuovo.");
    let downloaded = 0;
    let total: number | null = null;
    await found.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
        onProgress({ downloaded, total });
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        onProgress({ downloaded, total });
      }
    });
  },

  /** Starts the application again (the new version). */
  restart: async (): Promise<void> => {
    await invoke("restart_app");
  },
};
