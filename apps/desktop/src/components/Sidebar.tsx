import type { ConnectionState } from "../hooks/useServerStatus";
import { t } from "../i18n/it";
import { NAV } from "../app/nav";
import { ConnectionBadge } from "./ConnectionBadge";

interface SidebarProps {
  /** Current path without the leading "#/". */
  path: string;
  onNavigate: (to: string) => void;
  connection: ConnectionState;
}

export function Sidebar({ path, onNavigate, connection }: SidebarProps) {
  const isActive = (to: string, match: string[] = []) =>
    to === ""
      ? path === ""
      : path === to ||
        path.startsWith(`${to}/`) ||
        match.some((m) => path === m || path.startsWith(m.endsWith("/") ? m : `${m}/`));
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <img src="/favicon.svg" alt="" aria-hidden="true" className="size-8" />
        <span className="text-sm font-semibold tracking-tight text-fg">{t.appName}</span>
      </div>
      <nav aria-label={t.nav.label} className="flex-1 overflow-y-auto px-3 pb-3">
        {NAV.map((section, index) => (
          <div key={section.title ?? index} className="mb-3">
            {section.title ? (
              <h2 className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {section.title}
              </h2>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon, match }) => {
                const active = isActive(to, match);
                return (
                  <li key={to}>
                    <a
                      href={`#/${to}`}
                      aria-current={active ? "page" : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        onNavigate(to);
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                        active
                          ? "bg-raised font-medium text-fg"
                          : "text-muted hover:bg-raised hover:text-fg"
                      }`}
                    >
                      <Icon
                        aria-hidden="true"
                        className={`size-4 ${active ? "text-accent" : ""}`}
                      />
                      {label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-line px-5 py-4">
        <ConnectionBadge state={connection} />
      </div>
    </aside>
  );
}
