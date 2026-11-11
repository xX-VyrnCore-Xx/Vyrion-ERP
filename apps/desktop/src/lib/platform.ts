import { invoke, isTauri } from "@tauri-apps/api/core";

export interface SystemInfo {
  os: string;
  arch: string;
}

/** Host details from the Rust side; null when running in a plain browser (dev, tests). */
export async function getSystemInfo(): Promise<SystemInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<SystemInfo>("system_info");
  } catch {
    return null;
  }
}
