import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

const COLLAPSED_KEY = "vyrion.sidebar.collapsed";
/** Pause before a pop-up menu opens or closes under the pointer, so crossing a row is not a click. */
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 220;

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

/**
 * The sections of an item, in a small menu beside the sidebar. They are not unfolded inside it:
 * the sidebar keeps the same height whatever is open, so it never needs to scroll.
 */
function Flyout({
  item,
  anchor,
  place,
  onNavigate,
  onEnter,
  onLeave,
}: {
  item: NavItem;
  anchor: DOMRect;
  place: Place;
  onNavigate: (to: string) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.top - 6);
  // Keep the menu inside the window: slide it up when it would run past the bottom edge.
  useLayoutEffect(() => {
    const height = box.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(anchor.top - 6, window.innerHeight - height - 8)));
  }, [anchor.top]);
  return (
    <div
      ref={box}
      style={{ position: "fixed", left: anchor.right, top, zIndex: 40 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="pl-1.5"
    >
      <ul
        aria-label={`Sottomenu ${item.label}`}
        className="pop-in min-w-48 rounded-xl border border-line bg-surface p-1.5 shadow-pop"
      >
        <li
          aria-hidden="true"
          className="px-2.5 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted"
        >
          {item.label}
        </li>
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
                className={`block truncate rounded-lg px-2.5 py-1.5 text-[13px] leading-5 transition-colors ${
                  active ? "bg-accent/10 font-medium text-accent" : "text-fg hover:bg-raised"
                }`}
              >
                {child.label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Sidebar({
  place,
  onNavigate,
  connection,
  companyName,
  theme,
  onThemeChange,
}: SidebarProps) {
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

  // Which item's sections are showing, and where its row is (for placing the menu).
  const placeKey = `${place.path}?${place.query.toString()}`;
  const [opened, setOpen] = useState<{ to: string; anchor: DOMRect; at: string } | null>(null);
  // A menu left open belongs to the page it was opened on: going elsewhere closes it.
  const open = opened && opened.at === placeKey ? opened : null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const schedule = (job: () => void, delay: number) => {
    clear();
    timer.current = setTimeout(job, delay);
  };
  useEffect(() => clear, []);
  const show = (item: NavItem, row: HTMLElement | null) => {
    if (!row) return;
    const aside = row.closest("aside")?.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    setOpen({
      at: placeKey,
      to: item.to,
      // the menu starts where the sidebar ends, level with the row
      anchor: new DOMRect(rect.x, rect.y, (aside?.right ?? rect.right) - rect.x, rect.height),
    });
  };
  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(null);
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const away = (event: MouseEvent) => {
      if (!(event.target as Element).closest?.("aside, [aria-label^='Sottomenu']")) close();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", away);
    };
  }, [open, close]);

  const go = (to: string) => {
    close();
    onNavigate(to);
  };

  const renderItem = (item: NavItem) => {
    const here = itemIsHere(item, place);
    const hasChildren = (item.children?.length ?? 0) > 0;
    const showing = open?.to === item.to;
    const Icon = item.icon;
    return (
      <li
        key={item.to}
        onMouseEnter={(e) => {
          // the element must be taken now: the event object is gone when the timer fires
          const row = e.currentTarget.querySelector<HTMLElement>("[data-row]");
          if (hasChildren) schedule(() => show(item, row), OPEN_DELAY_MS);
          else close();
        }}
        onMouseLeave={() => (showing ? schedule(close, CLOSE_DELAY_MS) : clear())}
      >
        <div
          data-row
          style={{ height: "var(--nav-row)" }}
          className={`group relative flex items-center rounded-lg transition-colors ${
            here ? "bg-accent/10" : "hover:bg-raised"
          }`}
        >
          {here ? (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
            />
          ) : null}
          <a
            href={`#/${item.to}`}
            aria-current={here ? "page" : undefined}
            aria-label={collapsed ? item.label : undefined}
            title={collapsed && !hasChildren ? item.label : undefined}
            onClick={(e) => {
              e.preventDefault();
              go(item.to);
            }}
            style={{ fontSize: "var(--nav-font)" }}
            className={`flex h-full min-w-0 flex-1 items-center rounded-lg leading-none ${
              collapsed ? "justify-center px-0" : "gap-2.5 px-2.5"
            } ${here ? "font-medium text-fg" : "text-muted group-hover:text-fg"}`}
          >
            <Icon
              aria-hidden="true"
              className={`shrink-0 ${collapsed ? "size-[17px]" : "size-[15px]"} ${here ? "text-accent" : ""}`}
            />
            {collapsed ? null : <span className="truncate">{item.label}</span>}
          </a>
          {hasChildren && !collapsed ? (
            <button
              type="button"
              aria-expanded={showing}
              aria-haspopup="true"
              aria-label={`Mostra le sezioni di ${item.label}`}
              onClick={(e) => {
                if (showing) close();
                else show(item, e.currentTarget.closest("[data-row]"));
              }}
              className="mr-1 grid size-5 shrink-0 place-items-center rounded text-muted hover:text-fg"
            >
              <ChevronRight aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
        {showing && open ? (
          <Flyout
            item={item}
            anchor={open.anchor}
            place={place}
            onNavigate={go}
            onEnter={clear}
            onLeave={() => schedule(close, CLOSE_DELAY_MS)}
          />
        ) : null}
      </li>
    );
  };

  return (
    <aside
      aria-label={t.nav.label}
      data-collapsed={collapsed}
      className={`flex shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      <div
        className={`flex items-center ${collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-3.5 py-2.5"}`}
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
          className="mx-auto mb-0.5 grid size-7 place-items-center rounded-md text-muted hover:bg-raised hover:text-fg"
        >
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        </button>
      ) : null}
      {/* Rows shrink with the window's height, so the whole menu fits without scrolling; the
          scroll bar only appears (and stays discreet) in a window that is really too short. */}
      <nav aria-label={t.nav.label} className="nav-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-1">
        {NAV.map((section, index) => {
          const title = section.title;
          // The CRM, ERP and IT groups always stay open: only the sections of an item fold.
          return (
            <div key={title ?? index} className={title ? "mt-1.5" : ""}>
              {title ? (
                collapsed ? (
                  <div aria-hidden="true" className="mx-3 mb-1 mt-1 h-px bg-line" />
                ) : (
                  <h2 className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase leading-4 tracking-wider text-muted">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-full ${SECTION_MARK[title] ?? "bg-muted"}`}
                    />
                    {title}
                  </h2>
                )
              ) : null}
              <ul>{section.items.map(renderItem)}</ul>
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
