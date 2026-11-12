import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { NAV, isHere, itemIsHere, type NavItem, type Place } from "../app/nav";
import type { ConnectionState } from "../hooks/useServerStatus";
import type { Theme } from "../hooks/useTheme";
import { t } from "../i18n/it";
import { AccountMenu } from "./AccountMenu";

interface SidebarProps {
  /** Where the person is (hash path without "#/", and its query). */
  place: Place;
  onNavigate: (to: string) => void;
  connection: ConnectionState;
  /** The company's name, once set; shown as the profile's name. */
  companyName: string | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

/** Which sub-menus were opened or closed by hand. */
interface NavMemory {
  items: Record<string, boolean>;
}
const MEMORY_KEY = "vyrion.nav";
const COLLAPSED_KEY = "vyrion.sidebar.collapsed";

/** Colour of the small mark that tells the groups apart. */
const SECTION_MARK: Record<string, string> = {
  CRM: "bg-accent",
  ERP: "bg-info",
  IT: "bg-success",
};

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function readMemory(): NavMemory {
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NavMemory>;
      return { items: parsed.items ?? {} };
    }
  } catch {
    /* the layout is remembered only for this session */
  }
  return { items: {} };
}

export function Sidebar({
  place,
  onNavigate,
  connection,
  companyName,
  theme,
  onThemeChange,
}: SidebarProps) {
  const [memory, setMemory] = useState<NavMemory>(readMemory);
  useEffect(() => {
    try {
      window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    } catch {
      /* ignore */
    }
  }, [memory]);

  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  // Ctrl/Cmd + B folds the sidebar to icons, like in most editors.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setCollapsed((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const setItemOpen = useCallback((to: string, open: boolean) => {
    setMemory((m) => ({ ...m, items: { ...m.items, [to]: open } }));
  }, []);

  const renderItem = (item: NavItem) => {
    const here = itemIsHere(item, place);
    const hasChildren = (item.children?.length ?? 0) > 0 && !collapsed;
    const open = hasChildren && (memory.items[item.to] ?? here);
    const Icon = item.icon;
    return (
      <li key={item.to}>
        <div
          className={`group relative flex items-center rounded-lg transition-colors ${
            here ? "bg-accent/10" : "hover:bg-raised"
          }`}
        >
          {here ? (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
            />
          ) : null}
          <a
            href={`#/${item.to}`}
            aria-current={here && !hasChildren ? "page" : undefined}
            aria-label={collapsed ? item.label : undefined}
            title={collapsed ? item.label : undefined}
            onClick={(e) => {
              e.preventDefault();
              if (hasChildren) setItemOpen(item.to, true);
              onNavigate(item.to);
            }}
            className={`flex min-w-0 flex-1 items-center rounded-lg text-[13px] leading-5 ${
              collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-1.5"
            } ${here ? "font-medium text-fg" : "text-muted group-hover:text-fg"}`}
          >
            <Icon
              aria-hidden="true"
              className={`shrink-0 ${collapsed ? "size-[18px]" : "size-4"} ${here ? "text-accent" : ""}`}
            />
            {collapsed ? null : <span className="truncate">{item.label}</span>}
          </a>
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "Chiudi" : "Apri"} il sottomenu ${item.label}`}
              onClick={() => setItemOpen(item.to, !open)}
              className="mr-1 grid size-5 shrink-0 place-items-center rounded text-muted hover:text-fg"
            >
              {open ? (
                <ChevronDown aria-hidden="true" className="size-3.5" />
              ) : (
                <ChevronRight aria-hidden="true" className="size-3.5" />
              )}
            </button>
          ) : null}
        </div>
        {open ? (
          <ul
            aria-label={`Sottomenu ${item.label}`}
            className="expand-in mb-1 ml-[17px] mt-0.5 space-y-px border-l border-line pl-2"
          >
            {item.children?.map((child) => {
              const active = isHere(child.to, place, child.match, child.fallback);
              return (
                <li key={child.to}>
                  <a
                    href={`#/${child.to}`}
                    aria-current={active ? "page" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate(child.to);
                    }}
                    className={`block truncate rounded-md px-2.5 py-1 text-[12.5px] leading-5 transition-colors ${
                      active
                        ? "bg-accent/10 font-medium text-accent"
                        : "text-muted hover:bg-raised hover:text-fg"
                    }`}
                  >
                    {child.label}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <aside
      aria-label={t.nav.label}
      data-collapsed={collapsed}
      className={`flex shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150 ${
        collapsed ? "w-14" : "w-60"
      }`}
    >
      <div
        className={`flex items-center ${collapsed ? "justify-center px-0 py-3" : "gap-2.5 px-3.5 py-3.5"}`}
      >
        <img src="/favicon.svg" alt="" aria-hidden="true" className="size-6 shrink-0" />
        {collapsed ? null : (
          <span className="flex-1 truncate text-[14px] font-semibold tracking-tight text-fg">
            {t.appName}
          </span>
        )}
        {collapsed ? null : (
          <button
            type="button"
            aria-label="Riduci la barra laterale"
            title="Riduci (Ctrl+B)"
            onClick={() => setCollapsed(true)}
            className="grid size-6 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg"
          >
            <PanelLeftClose aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      {collapsed ? (
        <button
          type="button"
          aria-label="Espandi la barra laterale"
          title="Espandi (Ctrl+B)"
          onClick={() => setCollapsed(false)}
          className="mx-auto mb-1 grid size-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg"
        >
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        </button>
      ) : null}
      <nav aria-label={t.nav.label} className="flex-1 overflow-y-auto px-2 pb-3">
        {NAV.map((section, index) => {
          const title = section.title;
          // The CRM, ERP and IT groups always stay open: only the sub-menus fold.
          return (
            <div key={title ?? index} className={title ? "mt-3" : "mb-1"}>
              {title ? (
                collapsed ? (
                  <div aria-hidden="true" className="mx-3 mb-1.5 h-px bg-line" />
                ) : (
                  <h2 className="flex items-center gap-1.5 px-2.5 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-full ${SECTION_MARK[title] ?? "bg-muted"}`}
                    />
                    {title}
                  </h2>
                )
              ) : null}
              <ul className="space-y-px">{section.items.map(renderItem)}</ul>
            </div>
          );
        })}
      </nav>
      <AccountMenu
        connection={connection}
        companyName={companyName}
        theme={theme}
        onThemeChange={onThemeChange}
        onNavigate={onNavigate}
        compact={collapsed}
      />
    </aside>
  );
}
