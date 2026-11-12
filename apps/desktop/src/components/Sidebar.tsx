import { ChevronDown, ChevronRight } from "lucide-react";
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

/** Which section groups are folded and which sub-menus were opened or closed by hand. */
interface NavMemory {
  folded: Record<string, boolean>;
  items: Record<string, boolean>;
}
const MEMORY_KEY = "vyrion.nav";

function readMemory(): NavMemory {
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NavMemory>;
      return { folded: parsed.folded ?? {}, items: parsed.items ?? {} };
    }
  } catch {
    /* the layout is remembered only for this session */
  }
  return { folded: {}, items: {} };
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

  const toggleSection = useCallback((title: string) => {
    setMemory((m) => ({ ...m, folded: { ...m.folded, [title]: !m.folded[title] } }));
  }, []);
  const setItemOpen = useCallback((to: string, open: boolean) => {
    setMemory((m) => ({ ...m, items: { ...m.items, [to]: open } }));
  }, []);

  const renderItem = (item: NavItem) => {
    const here = itemIsHere(item, place);
    const hasChildren = (item.children?.length ?? 0) > 0;
    const open = hasChildren && (memory.items[item.to] ?? here);
    const Icon = item.icon;
    return (
      <li key={item.to}>
        <div
          className={`group flex items-center rounded-md transition-colors ${
            here ? "bg-raised" : "hover:bg-raised"
          }`}
        >
          <a
            href={`#/${item.to}`}
            aria-current={here && !hasChildren ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              if (hasChildren) setItemOpen(item.to, true);
              onNavigate(item.to);
            }}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-[13px] leading-5 ${
              here ? "font-medium text-fg" : "text-muted group-hover:text-fg"
            }`}
          >
            <Icon
              aria-hidden="true"
              className={`size-[15px] shrink-0 ${here ? "text-accent" : ""}`}
            />
            <span className="truncate">{item.label}</span>
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
            className="mb-0.5 ml-[15px] mt-0.5 space-y-px border-l border-line pl-1.5"
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
                    className={`block truncate rounded-md px-2 py-[3px] text-[12.5px] leading-5 transition-colors ${
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
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2 px-3.5 py-3">
        <img src="/favicon.svg" alt="" aria-hidden="true" className="size-6" />
        <span className="text-[13px] font-semibold tracking-tight text-fg">{t.appName}</span>
      </div>
      <nav aria-label={t.nav.label} className="flex-1 overflow-y-auto px-2 pb-2">
        {NAV.map((section, index) => {
          const title = section.title;
          const folded = title !== null && memory.folded[title] === true;
          // A folded group still shows the entry the person is on.
          const items = folded
            ? section.items.filter((item) => itemIsHere(item, place))
            : section.items;
          return (
            <div key={title ?? index} className="mb-1.5">
              {title ? (
                <button
                  type="button"
                  aria-expanded={!folded}
                  onClick={() => toggleSection(title)}
                  className="flex w-full items-center justify-between rounded px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted hover:text-fg"
                >
                  {title}
                  {folded ? (
                    <ChevronRight aria-hidden="true" className="size-3" />
                  ) : (
                    <ChevronDown aria-hidden="true" className="size-3" />
                  )}
                </button>
              ) : null}
              <ul className="space-y-px">{items.map(renderItem)}</ul>
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
      />
    </aside>
  );
}
