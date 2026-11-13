import { Bell, BellOff, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { dismissNotification, notifications, type Severity } from "../modules/insights";

const LABEL: Record<Severity, string> = { danger: "Urgente", warning: "Attenzione", info: "Info" };
const MARK: Record<Severity, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};
/** The panel lists this many; the dashboard has the rest. */
const SHOWN = 12;

/** The bell: opens a panel with what needs attention, each item reachable and hideable. */
export function NotificationsMenu({ go }: { go: (to: string) => void }) {
  const ws = useWorkspace();
  const alerts = useAsync(() => notifications(ws.db, ws.ctx.today(), ws.ctx.now()), []);
  const list = alerts.data ?? [];
  const urgent = list.filter((n) => n.severity === "danger").length;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

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

  const hide = (keys: string[]) =>
    void Promise.all(keys.map((k) => dismissNotification(ws.db, k, ws.ctx.now()))).then(() =>
      ws.touch(),
    );

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={list.length ? `Avvisi: ${list.length} da controllare` : "Avvisi: nessuno"}
        title="Avvisi"
        onClick={() => setOpen((v) => !v)}
        className={`relative grid size-9 place-items-center rounded-lg border text-muted transition-colors hover:text-fg ${
          open ? "border-accent/50 bg-raised text-fg" : "border-line bg-raised"
        }`}
      >
        <Bell aria-hidden="true" className="size-4" />
        {list.length ? (
          <span
            className={`absolute -right-1.5 -top-1.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-surface ${
              urgent ? "bg-danger" : "bg-warning"
            }`}
          >
            {list.length > 99 ? "99+" : list.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Avvisi"
          className="pop-in absolute right-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-semibold text-fg">
              Avvisi
              {list.length ? <span className="ml-1.5 text-muted">({list.length})</span> : null}
            </h2>
            {list.length > 1 ? (
              <button
                type="button"
                onClick={() => hide(list.map((n) => n.key))}
                className="text-xs text-muted hover:text-fg"
              >
                Nascondi tutti
              </button>
            ) : null}
          </div>
          {list.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <BellOff aria-hidden="true" className="size-6 text-muted" />
              <p className="text-sm text-fg">Tutto a posto</p>
              <p className="text-xs text-muted">
                Nessuna scadenza, anomalia o promemoria da controllare.
              </p>
            </div>
          ) : (
            <ul className="max-h-[min(26rem,60vh)] divide-y divide-line/60 overflow-y-auto">
              {list.slice(0, SHOWN).map((n) => (
                <li
                  key={n.key}
                  className="group flex items-start gap-2 px-4 py-2.5 hover:bg-raised"
                >
                  <span
                    aria-hidden="true"
                    title={LABEL[n.severity]}
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${MARK[n.severity]}`}
                  />
                  <a
                    href={href("e", n.entity, n.id)}
                    onClick={() => setOpen(false)}
                    className="min-w-0 flex-1"
                  >
                    <span className="block truncate text-[13px] font-medium text-fg">
                      {n.title}
                    </span>
                    {n.detail ? (
                      <span className="block truncate text-xs text-muted">{n.detail}</span>
                    ) : null}
                  </a>
                  <button
                    type="button"
                    aria-label={`Nascondi: ${n.title}`}
                    title="Nascondi"
                    onClick={() => hide([n.key])}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-muted opacity-60 hover:bg-line/60 hover:text-fg group-hover:opacity-100"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line px-4 py-2 text-xs">
            {list.length > SHOWN ? (
              <span className="mr-2 text-muted">Altri {list.length - SHOWN} nella panoramica.</span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                go("");
              }}
              className="font-medium text-accent hover:underline"
            >
              Apri la panoramica
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
