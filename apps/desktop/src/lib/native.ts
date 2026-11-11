import { invoke, isTauri } from "@tauri-apps/api/core";

/** True inside the desktop shell; false in a plain browser (development). */
export const inDesktop = (): boolean => isTauri();

export interface AppInfo {
  version: string;
  data_dir: string;
  os: string;
  arch: string;
}
export interface DbStatus {
  ready: boolean;
  error: string | null;
  path: string;
  key_store: string;
  size_bytes: number;
  sqlite_version: string | null;
  cipher_version: string | null;
}
export interface BackupInfo {
  path: string;
  size_bytes: number;
  [key: string]: unknown;
}
export interface RestoreOutcome {
  previous_copy: string | null;
}
export interface IntegrityReport {
  ok: boolean;
  [key: string]: unknown;
}
export interface DiskInfo {
  name: string;
  mount: string;
  file_system: string;
  total_bytes: number;
  available_bytes: number;
}
export interface SystemSnapshot {
  hostname: string | null;
  os_name: string | null;
  os_version: string | null;
  arch: string;
  cpu_brand: string;
  cpu_count: number;
  cpu_usage_percent: number;
  memory_total_bytes: number;
  memory_used_bytes: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
  uptime_seconds: number;
  disks: DiskInfo[];
}
export interface TcpCheck {
  ok: boolean;
  elapsed_ms: number;
  address: string | null;
  error: string | null;
}
export interface StoredFile {
  hash: string;
  size_bytes: number;
  name: string;
  is_new: boolean;
}

export const native = {
  appInfo: () => invoke<AppInfo>("app_info"),
  dbStatus: () => invoke<DbStatus>("db_status"),
  integrityCheck: () => invoke<IntegrityReport>("db_integrity_check"),
  backup: (dest: string, passphrase: string) =>
    invoke<BackupInfo>("db_backup", { dest, passphrase }),
  restore: (source: string, passphrase: string) =>
    invoke<RestoreOutcome>("db_restore", { source, passphrase }),
  systemSnapshot: () => invoke<SystemSnapshot>("system_snapshot"),
  tcpCheck: (host: string, port: number, timeoutMs = 3000) =>
    invoke<TcpCheck>("net_check_tcp", { host, port, timeoutMs }),
  storeAttachment: (source: string) => invoke<StoredFile>("attachment_store", { source }),
  verifyAttachment: (hash: string) => invoke<boolean>("attachment_verify", { hash }),
  exportAttachment: (hash: string, dest: string) =>
    invoke<null>("attachment_export", { hash, dest }),
  deleteAttachment: async (hash: string): Promise<void> => {
    await invoke("attachment_delete", { hash });
  },
  openAttachment: async (hash: string, name: string): Promise<void> => {
    await invoke("attachment_open", { hash, name });
  },
};

export async function pickFile(title: string, extensions?: string[]): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    title,
    multiple: false,
    directory: false,
    ...(extensions ? { filters: [{ name: title, extensions }] } : {}),
  });
  return typeof result === "string" ? result : null;
}

export async function pickSavePath(title: string, defaultPath: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save({ title, defaultPath })) ?? null;
}

export interface ShellPrefs {
  tray_supported: boolean;
  close_to_tray: boolean;
}

export const shell = {
  prefs: () => invoke<ShellPrefs>("get_shell_prefs"),
  setCloseToTray: async (enabled: boolean): Promise<void> => {
    await invoke("set_close_to_tray", { enabled });
  },
  /** Ends the application for good (same as «Esci definitivamente» in the tray). */
  quit: async (): Promise<void> => {
    await invoke("quit_app");
  },
};
