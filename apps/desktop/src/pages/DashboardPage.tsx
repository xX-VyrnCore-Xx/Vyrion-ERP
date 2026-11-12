import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { getSetting, setSetting } from "../data/system";
import { formatMoney } from "../lib/money";
import {
  dismissNotification,
  kpis,
  notifications,
  type Kpis,
  type Severity,
} from "../modules/insights";
import { Badge, Empty, ErrorNote } from "../ui/parts";
import { formatDay, formatInstant } from "../ui/format";

interface Tile {
  key: keyof Kpis;
  label: string;
  money?: boolean;
  to: string;
}

const TILES: Tile[] = [
  { key: "receivables", label: "Crediti verso clienti", money: true, to: "deadlines" },
  { key: "overdue", label: "Di cui scaduti", money: true, to: "deadlines" },
  { key: "payables", label: "Debiti verso fornitori", money: true, to: "deadlines" },
  { key: "revenueYtd", label: "Ricavi dell'anno", money: true, to: "reports" },
  { key: "pipelineOpen", label: "Pipeline aperta", money: true, to: "pipeline" },
  { key: "pipelineWeighted", label: "Pipeline ponderata", money: true, to: "pipeline" },
  { key: "openTickets", label: "Ticket aperti", to: "e/ticket" },
  { key: "openTasks", label: "Attività da fare", to: "e/task" },
  { key: "assets", label: "Asset IT attivi", to: "e/asset" },
  { key: "openSecurityEvents", label: "Eventi di sicurezza aperti", to: "e/security_event" },
];

const TONE: Record<Severity, "danger" | "warning" | "info"> = {
  danger: "danger",
  warning: "warning",
  info: "info",
};
const LABEL: Record<Severity, string> = { danger: "Urgente", warning: "Attenzione", info: "Info" };
const HIDDEN_KEY = "dashboard.hidden";

export function DashboardPage() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const data = useAsync(async () => {
    const ctx = ws.ctx;
    const today = ctx.today();
    const [figures, alerts, hidden, agenda] = await Promise.all([
      kpis(ws.db, today),
      notifications(ws.db, today, ctx.now()),
      getSetting<string[]>(ws.db, HIDDEN_KEY),
      ws.db.query<{ id: string; title: string; starts_at: string }>(
        "SELECT id, title, starts_at FROM appointments WHERE deleted_at IS NULL AND date(starts_at) >= ? ORDER BY starts_at LIMIT 5",
        [today],
      ),
    ]);
    return { figures, alerts, hidden: hidden ?? [], agenda };
  }, []);

  const toggle = async (key: string) => {
    const hidden = new Set(data.data?.hidden ?? []);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    await setSetting(ws.db, HIDDEN_KEY, [...hidden], ws.ctx.now());
    ws.touch();
  };

  const loaded = data.data;
  const hidden = new Set(loaded?.hidden ?? []);
  const shown = TILES.filter((tile) => editing || !hidden.has(tile.key));

  return (
    <>
      <PageHeader
        title="Panoramica"
        subtitle={`Situazione aggiornata al ${formatDay(ws.ctx.today())}, calcolata dai dati di questa installazione.`}
      />
      <ErrorNote message={data.error} />
      {data.data ? (
        <div className="space-y-6">
          <div className="flex justify-end">
            <Button onClick={() => setEditing(!editing)}>
              {editing ? "Fine" : "Personalizza"}
            </Button>
          </div>
          <section
            aria-label="Indicatori"
            className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            {shown.map((tile) => {
              const value = loaded?.figures[tile.key] ?? 0;
              const off = hidden.has(tile.key);
              return (
                <div
                  key={tile.key}
                  className={`lift rounded-xl border border-line bg-surface p-4 shadow-card ${off ? "opacity-50" : ""}`}
                >
                  {editing ? (
                    <label className="flex items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={!off}
                        onChange={() => void toggle(tile.key)}
                        className="size-4 accent-[var(--accent)]"
                      />
                      {tile.label}
                    </label>
                  ) : (
                    <a href={href(...tile.to.split("/"))} className="block">
                      <div className="text-xs text-muted">{tile.label}</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">
                        {tile.money ? formatMoney(value) : value}
                      </div>
                    </a>
                  )}
                </div>
              );
            })}
          </section>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card title={`Da tenere d'occhio (${data.data.alerts.length})`}>
              {data.data.alerts.length === 0 ? (
                <Empty>Niente di urgente: nessuna scadenza, anomalia o promemoria attivo.</Empty>
              ) : (
                <ul className="divide-y divide-line/60">
                  {data.data.alerts.slice(0, 30).map((n) => (
                    <li key={n.key} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge tone={TONE[n.severity]}>{LABEL[n.severity]}</Badge>
                          <a
                            href={href("e", n.entity, n.id)}
                            className="truncate text-sm font-medium text-fg hover:text-accent"
                          >
                            {n.title}
                          </a>
                        </div>
                        {n.detail ? <p className="mt-0.5 text-xs text-muted">{n.detail}</p> : null}
                      </div>
                      <Button
                        aria-label={`Nascondi: ${n.title}`}
                        onClick={() =>
                          void dismissNotification(ws.db, n.key, ws.ctx.now()).then(() =>
                            ws.touch(),
                          )
                        }
                      >
                        Nascondi
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Prossimi appuntamenti">
              {data.data.agenda.length === 0 ? (
                <p className="text-sm text-muted">Nessun appuntamento in programma.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.data.agenda.map((a) => (
                    <li key={a.id}>
                      <a
                        href={href("e", "appointment", a.id)}
                        className="text-fg hover:text-accent"
                      >
                        {a.title}
                      </a>
                      <div className="text-xs text-muted">{formatInstant(a.starts_at)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
