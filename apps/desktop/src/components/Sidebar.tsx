import { Activity, Settings, type LucideIcon } from "lucide-react";

import type { ConnectionState } from "../hooks/useServerStatus";
import { t } from "../i18n/it";
import { ConnectionBadge } from "./ConnectionBadge";

export type View = "status" | "settings";

const ITEMS: { view: View; label: string; icon: LucideIcon }[] = [
  { view: "status", label: t.nav.status, icon: Activity },
  { view: "settings", label: t.nav.settings, icon: Settings },
];

interface SidebarProps {
  current: View;
  onNavigate: (view: View) => void;
  connection: ConnectionState;
}

export function Sidebar({ current, onNavigate, connection }: SidebarProps) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span
          aria-hidden="true"
          className="grid size-7 place-items-center rounded-lg bg-linear-to-br from-accent to-info text-sm font-bold text-accent-contrast"
        >
          V
        </span>
        <span className="text-sm font-semibold tracking-tight text-fg">{t.appName}</span>
      </div>
      <nav aria-label={t.nav.label} className="flex-1 px-3">
        <ul className="space-y-1">
          {ITEMS.map(({ view, label, icon: Icon }) => {
            const active = view === current;
            return (
              <li key={view}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onNavigate(view)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-raised font-medium text-fg"
                      : "text-muted hover:bg-raised hover:text-fg"
                  }`}
                >
                  <Icon aria-hidden="true" className={`size-4 ${active ? "text-accent" : ""}`} />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-line px-5 py-4">
        <ConnectionBadge state={connection} />
      </div>
    </aside>
  );
}
