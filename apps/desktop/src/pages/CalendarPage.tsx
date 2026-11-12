import { useState } from "react";

import { Button } from "../components/Button";
import { PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { addMonths } from "../lib/dates";
import { exportCalendar, importCalendar } from "../modules/ics";
import { ErrorNote, Toolbar } from "../ui/parts";
import { saveText } from "../ui/saveText";

interface Item {
  day: string;
  label: string;
  kind: "appointment" | "task" | "contract" | "invoice";
  entity: string;
  id: string;
}

const COLOR: Record<Item["kind"], string> = {
  appointment: "bg-info/15 text-info",
  task: "bg-warning/15 text-warning",
  contract: "bg-accent/15 text-accent",
  invoice: "bg-danger/15 text-danger",
};
const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const MONTH = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" });

export function CalendarPage({ go }: { go: (to: string) => void }) {
  const ws = useWorkspace();
  const [anchor, setAnchor] = useState(() => `${ws.ctx.today().slice(0, 7)}-01`);
  const monthStart = anchor;
  const monthEnd = addMonths(anchor, 1);
  const today = ws.ctx.today();
  const [exchange, setExchange] = useState<{ ok: boolean; text: string } | null>(null);

  const exportIcs = async () => {
    setExchange(null);
    try {
      await saveText(
        "vyrion-calendario.ics",
        await exportCalendar(ws),
        "text/calendar;charset=utf-8",
      );
    } catch (error) {
      setExchange({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  };
  const importIcs = async (file: File | undefined) => {
    if (!file) return;
    setExchange(null);
    try {
      const r = await importCalendar(ws, await file.text());
      ws.touch();
      setExchange({
        ok: true,
        text: `Calendario importato: ${r.created} nuovi, ${r.updated} aggiornati, ${r.unchanged} invariati${r.recurring ? `; ${r.recurring} eventi ricorrenti importati solo alla prima data` : ""}${r.ignored ? `; ${r.ignored} elementi non eventi ignorati` : ""}.`,
      });
    } catch (error) {
      setExchange({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  };

  const data = useAsync(async () => {
    const q = <T extends Record<string, string | number | null>>(sql: string) =>
      ws.db.query<T>(sql, [monthStart, monthEnd]);
    const items: Item[] = [];
    for (const r of await q<{ id: string; title: string; starts_at: string }>(
      "SELECT id, title, starts_at FROM appointments WHERE deleted_at IS NULL AND date(starts_at) >= ? AND date(starts_at) < ?",
    )) {
      items.push({
        day: new Date(r.starts_at).toLocaleDateString("sv-SE"),
        label: `${r.starts_at.slice(11, 16)} ${r.title}`,
        kind: "appointment",
        entity: "appointment",
        id: r.id,
      });
    }
    for (const r of await q<{ id: string; title: string; due_date: string }>(
      "SELECT id, title, due_date FROM tasks WHERE deleted_at IS NULL AND status IN ('todo','doing') AND due_date >= ? AND due_date < ?",
    )) {
      items.push({ day: r.due_date, label: r.title, kind: "task", entity: "task", id: r.id });
    }
    for (const r of await q<{ id: string; title: string; end_date: string }>(
      "SELECT id, title, end_date FROM contracts WHERE deleted_at IS NULL AND status = 'active' AND end_date >= ? AND end_date < ?",
    )) {
      items.push({
        day: r.end_date,
        label: `Scade: ${r.title}`,
        kind: "contract",
        entity: "contract",
        id: r.id,
      });
    }
    for (const r of await q<{ id: string; number: string; due_date: string }>(
      `SELECT id, number, due_date FROM documents WHERE deleted_at IS NULL AND status = 'issued' AND type IN ('invoice','purchase_invoice')
         AND total > COALESCE((SELECT SUM(amount) FROM payments p WHERE p.document_id = documents.id AND p.deleted_at IS NULL), 0)
         AND due_date >= ? AND due_date < ?`,
    )) {
      items.push({
        day: r.due_date,
        label: `Scadenza ${r.number}`,
        kind: "invoice",
        entity: "document",
        id: r.id,
      });
    }
    return items;
  }, [monthStart]);

  // Weeks start on Monday.
  const first = new Date(`${monthStart}T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => {
    const n = i - offset + 1;
    return n >= 1 && n <= daysInMonth
      ? `${monthStart.slice(0, 8)}${String(n).padStart(2, "0")}`
      : null;
  });

  const open = (item: Item) => go(href("e", item.entity, item.id));

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle="Appuntamenti, attività, scadenze di contratti e di pagamento del mese."
      />
      <Toolbar>
        <Button aria-label="Mese precedente" onClick={() => setAnchor(addMonths(anchor, -1))}>
          ←
        </Button>
        <h2 className="min-w-40 text-center text-sm font-semibold capitalize text-fg">
          {MONTH.format(first)}
        </h2>
        <Button aria-label="Mese successivo" onClick={() => setAnchor(addMonths(anchor, 1))}>
          →
        </Button>
        <Button onClick={() => setAnchor(`${today.slice(0, 7)}-01`)}>Oggi</Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button onClick={() => void exportIcs()}>Esporta .ics</Button>
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-line bg-raised px-3.5 py-2 text-sm font-medium text-fg hover:border-accent">
            Importa .ics
            <input
              type="file"
              accept=".ics,text/calendar"
              aria-label="Calendario .ics"
              className="sr-only"
              onChange={(e) => {
                void importIcs(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <Button variant="primary" onClick={() => go(href("e", "appointment", "new"))}>
            Nuovo appuntamento
          </Button>
        </div>
      </Toolbar>
      <ErrorNote message={data.error} />
      {exchange ? (
        exchange.ok ? (
          <p role="status" className="mb-3 text-sm text-success">
            {exchange.text}
          </p>
        ) : (
          <div className="mb-3">
            <ErrorNote message={exchange.text} />
          </div>
        )
      ) : null}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => (
            <div
              key={i}
              className={`min-h-24 border-b border-r border-line/60 p-1.5 ${day === today ? "bg-accent/5" : ""}`}
            >
              {day ? (
                <>
                  <div
                    className={`mb-1 text-xs ${day === today ? "font-semibold text-accent" : "text-muted"}`}
                  >
                    {Number(day.slice(8))}
                  </div>
                  <ul className="space-y-1">
                    {data.data
                      ?.filter((it) => it.day === day)
                      .map((it) => (
                        <li key={`${it.kind}${it.id}`}>
                          <button
                            type="button"
                            onClick={() => open(it)}
                            className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-xs ${COLOR[it.kind]}`}
                          >
                            {it.label}
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
