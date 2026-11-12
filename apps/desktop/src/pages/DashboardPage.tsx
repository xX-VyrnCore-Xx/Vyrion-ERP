import {
  AlertTriangle,
  CalendarPlus,
  FilePlus2,
  LifeBuoy,
  ListChecks,
  Scale,
  ShieldAlert,
  Target,
  TrendingUp,
  UserPlus,
  Wallet,
  CreditCard,
  Server,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { BarChart, StackedBar, monthLabel } from "../components/Charts";
import { useAsync, useWorkspace } from "../app/context";
import { href } from "../app/router";
import { getSetting, setSetting } from "../data/system";
import { formatMoney } from "../lib/money";
import {
  dismissNotification,
  kpis,
  notifications,
  revenueByMonth,
  type Kpis,
  type Severity,
} from "../modules/insights";
import { aging } from "../modules/reports";
import { Badge, Empty, ErrorNote } from "../ui/parts";
import { formatDay, formatInstant } from "../ui/format";

interface Tile {
  key: keyof Kpis;
  label: string;
  money?: boolean;
  to: string;
  icon: LucideIcon;
  /** Colour of the icon chip. */
  tone: "accent" | "info" | "success" | "warning" | "danger";
  /** The tile turns red when the figure is above zero. */
  alert?: boolean;
}

const GROUPS: { title: string; tiles: Tile[] }[] = [
  {
    title: "Finanza",
    tiles: [
      {
        key: "receivables",
        label: "Crediti verso clienti",
        money: true,
        to: "deadlines",
        icon: Wallet,
        tone: "accent",
      },
      {
        key: "overdue",
        label: "Di cui scaduti",
        money: true,
        to: "deadlines",
        icon: AlertTriangle,
        tone: "warning",
        alert: true,
      },
      {
        key: "payables",
        label: "Debiti verso fornitori",
        money: true,
        to: "deadlines",
        icon: CreditCard,
        tone: "info",
      },
      {
        key: "revenueYtd",
        label: "Ricavi dell'anno",
        money: true,
        to: "reports",
        icon: TrendingUp,
        tone: "success",
      },
    ],
  },
  {
    title: "Vendite e assistenza",
    tiles: [
      {
        key: "pipelineOpen",
        label: "Pipeline aperta",
        money: true,
        to: "pipeline",
        icon: Target,
        tone: "accent",
      },
      {
        key: "pipelineWeighted",
        label: "Pipeline ponderata",
        money: true,
        to: "pipeline",
        icon: Scale,
        tone: "info",
      },
      {
        key: "openTickets",
        label: "Ticket aperti",
        to: "e/ticket",
        icon: LifeBuoy,
        tone: "warning",
      },
      { key: "openTasks", label: "Attività da fare", to: "e/task", icon: ListChecks, tone: "info" },
    ],
  },
  {
    title: "IT",
    tiles: [
      { key: "assets", label: "Asset IT attivi", to: "e/asset", icon: Server, tone: "success" },
      {
        key: "openSecurityEvents",
        label: "Eventi di sicurezza aperti",
        to: "e/security_event",
        icon: ShieldAlert,
        tone: "danger",
        alert: true,
      },
    ],
  },
];

const CHIP: Record<Tile["tone"], string> = {
  accent: "bg-accent/15 text-accent",
  info: "bg-info/15 text-info",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
};

const QUICK: { label: string; to: string[]; icon: LucideIcon }[] = [
  { label: "Nuova fattura", to: ["d", "invoice", "new"], icon: FilePlus2 },
  { label: "Nuovo preventivo", to: ["d", "quote", "new"], icon: FilePlus2 },
  { label: "Nuova anagrafica", to: ["e", "party", "new"], icon: UserPlus },
  { label: "Nuovo ticket", to: ["e", "ticket", "new"], icon: LifeBuoy },
  { label: "Nuovo appuntamento", to: ["e", "appointment", "new"], icon: CalendarPlus },
];

const BUCKETS = [
  { key: "not_due", label: "Non ancora scaduti", tone: "bg-success" },
  { key: "1-30", label: "Scaduti da 1–30 giorni", tone: "bg-info" },
  { key: "31-60", label: "Da 31–60 giorni", tone: "bg-warning" },
  { key: "61-90", label: "Da 61–90 giorni", tone: "bg-danger/70" },
  { key: "90+", label: "Oltre 90 giorni", tone: "bg-danger" },
] as const;

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
    const [figures, alerts, hidden, agenda, revenue, open] = await Promise.all([
      kpis(ws.db, today),
      notifications(ws.db, today, ctx.now()),
      getSetting<string[]>(ws.db, HIDDEN_KEY),
      ws.db.query<{ id: string; title: string; starts_at: string }>(
        "SELECT id, title, starts_at FROM appointments WHERE deleted_at IS NULL AND date(starts_at) >= ? ORDER BY starts_at LIMIT 5",
        [today],
      ),
      revenueByMonth(ws.db, today),
      aging(ws.db, today, "receivable"),
    ]);
    return { figures, alerts, hidden: hidden ?? [], agenda, revenue, open };
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
          {editing ? null : (
            <nav aria-label="Azioni rapide" className="flex flex-wrap gap-2">
              {QUICK.map(({ label, to, icon: Icon }) => (
                <a
                  key={label}
                  href={href(...to)}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg shadow-card transition-colors hover:border-accent/50 hover:text-accent"
                >
                  <Icon aria-hidden="true" className="size-4 text-accent" />
                  {label}
                </a>
              ))}
            </nav>
          )}
          {GROUPS.map((group) => {
            const tiles = group.tiles.filter((tile) => editing || !hidden.has(tile.key));
            if (tiles.length === 0) return null;
            return (
              <section key={group.title} aria-label={group.title}>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {group.title}
                </h2>
                <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {tiles.map((tile) => {
                    const value = loaded?.figures[tile.key] ?? 0;
                    const off = hidden.has(tile.key);
                    const hot = Boolean(tile.alert) && value > 0;
                    const Icon = tile.icon;
                    return (
                      <div
                        key={tile.key}
                        className={`lift rounded-xl border bg-surface p-4 shadow-card ${
                          hot ? "border-danger/40" : "border-line"
                        } ${off ? "opacity-50" : ""}`}
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
                          <a href={href(...tile.to.split("/"))} className="flex items-start gap-3">
                            <span
                              aria-hidden="true"
                              className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                                CHIP[hot ? "danger" : tile.tone]
                              }`}
                            >
                              <Icon className="size-[18px]" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-xs text-muted">
                                {tile.label}
                              </span>
                              <span
                                className={`mt-0.5 block text-2xl font-semibold tabular-nums ${
                                  hot ? "text-danger" : "text-fg"
                                }`}
                              >
                                {tile.money ? formatMoney(value) : value}
                              </span>
                            </span>
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {editing ? null : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card title="Ricavi degli ultimi 12 mesi">
                {data.data.revenue.every((r) => r.amount === 0) ? (
                  <Empty>Nessuna fattura emessa negli ultimi 12 mesi.</Empty>
                ) : (
                  <>
                    <BarChart
                      summary={`Ricavi mensili: ${data.data.revenue
                        .map((r) => `${monthLabel(r.month)} ${formatMoney(r.amount)}`)
                        .join(", ")}`}
                      data={data.data.revenue.map((r) => ({
                        label: monthLabel(r.month),
                        value: r.amount,
                        title: `${monthLabel(r.month)} ${r.month.slice(0, 4)}: ${formatMoney(r.amount)}`,
                      }))}
                    />
                    <p className="mt-2 text-xs text-muted">
                      Imponibile delle fatture emesse al netto delle note di credito.
                    </p>
                  </>
                )}
              </Card>
              <Card title="Crediti per scadenza">
                <StackedBar
                  empty="Nessun credito aperto verso i clienti."
                  format={formatMoney}
                  segments={BUCKETS.map((b) => ({
                    key: b.key,
                    label: b.label,
                    tone: b.tone,
                    value: (loaded?.open ?? [])
                      .filter((r) => r.bucket === b.key)
                      .reduce((sum, r) => sum + r.outstanding, 0),
                  }))}
                />
              </Card>
            </div>
          )}
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
