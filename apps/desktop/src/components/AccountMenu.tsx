import {
  ChevronsUpDown,
  Database,
  LogOut,
  Moon,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { ConnectionState } from "../hooks/useServerStatus";
import type { Theme } from "../hooks/useTheme";
import { useSyncOptional } from "../app/sync";
import { relativeTime, summarizeSync, type SyncTone } from "../app/syncStatus";
import { t } from "../i18n/it";
import { inDesktop, shell } from "../lib/native";

const SYNC_DOT: Record<SyncTone, string> = {
  ok: "bg-success",
  info: "bg-info animate-pulse",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-muted",
};

const DOT: Record<ConnectionState, string> = {
  unconfigured: "bg-muted",
  checking: "bg-info animate-pulse",
  online: "bg-success",
  degraded: "bg-warning",
  offline: "bg-danger",
};

interface Props {
  connection: ConnectionState;
  companyName: string | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onNavigate: (to: string) => void;
  /** Sidebar folded to icons: only the avatar is shown. */
  compact?: boolean;
}

const ENTRIES: { to: string; label: string; hint: string; icon: LucideIcon }[] = [
  {
    to: "settings/profile",
    label: "Profilo e azienda",
    hint: "Dati dell'azienda",
    icon: UserRound,
  },
  {
    to: "settings/account",
    label: "Account e server",
    hint: "Accesso e sincronizzazione",
    icon: Server,
  },
  {
    to: "settings/app",
    label: "Impostazioni software",
    hint: "Comportamento e aspetto",
    icon: SlidersHorizontal,
  },
  { to: "settings/updates", label: "Aggiornamenti", hint: "Versione e novità", icon: RefreshCw },
  { to: "settings/data", label: "Dati e backup", hint: "Archivio locale cifrato", icon: Database },
];

/** The initials shown in the avatar: two letters of the company name, or "VE". */
export const initials = (name: string | null): string => {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "VE";
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
};

/** Bottom of the sidebar: the profile, with the account, the software settings and the look. */
export function AccountMenu({
  connection,
  companyName,
  theme,
  onThemeChange,
  onNavigate,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const sync = useSyncOptional();
  const summary = sync ? summarizeSync(sync) : null;
  const name = companyName ?? "Profilo locale";
  const go = (to: string) => {
    setOpen(false);
    onNavigate(to);
  };

  return (
    <div ref={root} className="relative border-t border-line p-2">
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account e profilo"
          className={`pop-in absolute bottom-full z-20 mb-1 rounded-xl border border-line bg-surface p-1.5 shadow-pop ${compact ? "left-2 w-64" : "inset-x-2"}`}
        >
          <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-contrast">
              {initials(companyName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-fg">{name}</span>
              <span className="block truncate text-[11px] text-muted">
                {sync?.connected && sync.email ? sync.email : "Solo su questo computer"}
              </span>
            </span>
          </div>
          <div className="mx-1 mb-1.5 rounded-lg border border-line bg-raised px-2.5 py-2">
            <div role="status" className="flex items-center gap-1.5 text-[11.5px] text-fg">
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${summary ? SYNC_DOT[summary.tone] : DOT[connection]}`}
              />
              <span className="truncate">{summary ? summary.label : t.connection[connection]}</span>
            </div>
            {sync?.connected ? (
              <div className="mt-0.5 text-[11px] text-muted">
                Ultimo scambio: {relativeTime(sync.lastSyncAt)}
                {sync.pending ? ` · ${sync.pending} da inviare` : ""}
              </div>
            ) : null}
            <div className="mt-1.5 flex gap-1.5">
              {!sync?.connected ? (
                <button
                  type="button"
                  onClick={() => go("settings/account")}
                  className="rounded-md bg-accent/10 px-2 py-1 text-[11.5px] font-medium text-accent hover:bg-accent/20"
                >
                  Collega al server
                </button>
              ) : sync.needsLogin ? (
                <button
                  type="button"
                  onClick={() => go("settings/account")}
                  className="rounded-md bg-danger/10 px-2 py-1 text-[11.5px] font-medium text-danger hover:bg-danger/20"
                >
                  Accedi di nuovo
                </button>
              ) : (
                <button
                  type="button"
                  disabled={sync.syncing}
                  onClick={() => void sync.syncNow()}
                  className="rounded-md bg-accent/10 px-2 py-1 text-[11.5px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  {sync.syncing ? "Sincronizzazione…" : "Sincronizza ora"}
                </button>
              )}
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          {ENTRIES.map(({ to, label, hint, icon: Icon }) => (
            <button
              key={to}
              type="button"
              role="menuitem"
              onClick={() => go(to)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-raised"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-fg">{label}</span>
                <span className="block truncate text-[11px] text-muted">{hint}</span>
              </span>
            </button>
          ))}
          <div className="my-1 h-px bg-line" />
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[12px] text-muted">Tema</span>
            <div
              role="group"
              aria-label="Tema"
              className="flex rounded-lg border border-line p-0.5"
            >
              {(
                [
                  ["dark", "Scuro", Moon],
                  ["light", "Chiaro", Sun],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  aria-label={`Tema ${label.toLowerCase()}`}
                  onClick={() => onThemeChange(value)}
                  className={`grid size-6 place-items-center rounded-md ${
                    theme === value ? "bg-raised text-accent" : "text-muted hover:text-fg"
                  }`}
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                </button>
              ))}
            </div>
          </div>
          {inDesktop() ? (
            <>
              <div className="my-1 h-px bg-line" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void shell.quit();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-fg hover:bg-raised"
              >
                <LogOut aria-hidden="true" className="size-4 shrink-0 text-muted" />
                Esci da Vyrion ERP
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account e profilo: ${name}`}
        onClick={() => setOpen((v) => !v)}
        title={compact ? name : undefined}
        className={`flex w-full items-center rounded-lg text-left hover:bg-raised ${compact ? "justify-center py-1.5" : "gap-2.5 px-2 py-1.5"}`}
      >
        <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-contrast">
          {initials(companyName)}
          {compact ? (
            <span
              aria-hidden="true"
              className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-surface ${DOT[connection]}`}
            />
          ) : null}
        </span>
        <span className={compact ? "sr-only" : "min-w-0 flex-1"}>
          <span className="block truncate text-[13px] font-medium leading-4 text-fg">{name}</span>
          <span
            role="status"
            className="flex items-center gap-1.5 text-[11px] leading-4 text-muted"
          >
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${DOT[connection]}`}
            />
            <span className="truncate">{t.connection[connection]}</span>
          </span>
        </span>
        {compact ? null : (
          <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
        )}
      </button>
    </div>
  );
}
