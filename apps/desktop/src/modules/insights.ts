import type { SqlRunner } from "../data/db";
import type { Registry } from "../data/registry";
import { addDays } from "../lib/dates";

export type Severity = "info" | "warning" | "danger";

export interface Notification {
  /** Stable per condition, so a dismissed one stays dismissed until its state changes. */
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  entity: string;
  id: string;
}

interface Source {
  sql: string;
  params: (today: string, now: string) => (string | number)[];
  build: (
    row: Record<string, string | number | null>,
    today: string,
  ) => Omit<Notification, "key"> & { key?: string };
}

const q = (strings: TemplateStringsArray): string => strings.join("").replace(/\s+/g, " ").trim();

const SOURCES: Source[] = [
  {
    sql: q`SELECT d.id, d.number, d.due_date, p.name AS party, COALESCE(d.payable, d.total) - COALESCE((SELECT SUM(amount) FROM payments x WHERE x.document_id = d.id AND x.deleted_at IS NULL), 0) AS open
           FROM documents d JOIN parties p ON p.id = d.party_id
           WHERE d.type = 'invoice' AND d.status = 'issued' AND d.deleted_at IS NULL AND d.due_date < ? AND open > 0`,
    params: (today) => [today],
    build: (r) => ({
      severity: "danger",
      title: `Fattura ${r["number"]} scaduta`,
      detail: `${r["party"]} · scaduta il ${r["due_date"]}`,
      entity: "document",
      id: String(r["id"]),
    }),
  },
  {
    sql: q`SELECT d.id, d.number, d.due_date, p.name AS party,
                  COALESCE(d.payable, d.total) - COALESCE((SELECT SUM(amount) FROM payments x WHERE x.document_id = d.id AND x.deleted_at IS NULL), 0) AS open
           FROM documents d JOIN parties p ON p.id = d.party_id
           WHERE d.type = 'purchase_invoice' AND d.status = 'issued' AND d.deleted_at IS NULL AND d.due_date <= ? AND open > 0`,
    params: (today) => [addDays(today, 7)],
    build: (r) => ({
      severity: "warning",
      title: `Da pagare: ${r["number"]}`,
      detail: `${r["party"]} · scadenza ${r["due_date"]}`,
      entity: "document",
      id: String(r["id"]),
    }),
  },
  {
    sql: q`SELECT id, title, due_date FROM tasks WHERE deleted_at IS NULL AND status IN ('todo', 'doing') AND due_date IS NOT NULL AND due_date <= ?`,
    params: (today) => [today],
    build: (r) => ({
      severity: "warning",
      title: `Attività: ${r["title"]}`,
      detail: `Scadenza ${r["due_date"]}`,
      entity: "task",
      id: String(r["id"]),
    }),
  },
  {
    sql: q`SELECT c.id, c.title, c.end_date, c.notice_days, p.name AS party FROM contracts c JOIN parties p ON p.id = c.party_id
           WHERE c.deleted_at IS NULL AND c.status = 'active' AND c.end_date IS NOT NULL AND date(c.end_date, '-' || c.notice_days || ' days') <= ?`,
    params: (today) => [today],
    build: (r) => ({
      severity: "warning",
      title: `Contratto in scadenza: ${r["title"]}`,
      detail: `${r["party"]} · scade il ${r["end_date"]} (preavviso ${r["notice_days"]} giorni)`,
      entity: "contract",
      id: String(r["id"]),
    }),
  },
  {
    sql: q`SELECT t.id, t.number, t.subject, t.priority, p.name AS party FROM tickets t JOIN parties p ON p.id = t.party_id
           WHERE t.deleted_at IS NULL AND t.status IN ('open', 'in_progress') AND t.priority IN ('high', 'urgent')`,
    params: () => [],
    build: (r) => ({
      severity: r["priority"] === "urgent" ? "danger" : "warning",
      title: `Ticket ${r["number"]} (${r["priority"] === "urgent" ? "urgente" : "alta priorità"})`,
      detail: `${r["party"]} · ${r["subject"]}`,
      entity: "ticket",
      id: String(r["id"]),
    }),
  },
  {
    sql: q`SELECT id, product, expires_on FROM licenses WHERE deleted_at IS NULL AND expires_on IS NOT NULL AND expires_on <= ?`,
    params: (today) => [addDays(today, 30)],
    build: (r) => ({
      severity: "warning",
      title: `Licenza in scadenza: ${r["product"]}`,
      detail: `Scade il ${r["expires_on"]}`,
      entity: "license",
      id: String(r["id"]),
    }),
  },
  {
    sql: q`SELECT id, tag, name, warranty_until FROM assets WHERE deleted_at IS NULL AND status <> 'retired' AND warranty_until IS NOT NULL AND warranty_until <= ?`,
    params: (today) => [addDays(today, 30)],
    build: (r) => ({
      severity: "info",
      title: `Garanzia in scadenza: ${r["tag"]}`,
      detail: `${r["name"]} · ${r["warranty_until"]}`,
      entity: "asset",
      id: String(r["id"]),
    }),
  },
  {
    sql: q`SELECT s.id, s.summary, s.severity FROM security_events s WHERE s.deleted_at IS NULL AND s.status <> 'resolved' AND s.severity IN ('high', 'critical')`,
    params: () => [],
    build: (r) => ({
      severity: "danger",
      title: `Evento di sicurezza ${r["severity"] === "critical" ? "critico" : "grave"}`,
      detail: String(r["summary"]),
      entity: "security_event",
      id: String(r["id"]),
    }),
  },
  {
    // The last run failed, or none arrived within one and a half times the expected interval.
    sql: q`SELECT j.id, j.name, j.expected_every_hours,
                  (SELECT status FROM backup_runs r WHERE r.job_id = j.id AND r.deleted_at IS NULL ORDER BY r.finished_at DESC LIMIT 1) AS last_status,
                  (SELECT MAX(finished_at) FROM backup_runs r WHERE r.job_id = j.id AND r.deleted_at IS NULL) AS last_at
           FROM backup_jobs j WHERE j.deleted_at IS NULL AND j.enabled = 1`,
    params: () => [],
    build: (r) => ({
      severity: "danger",
      title: `Backup: ${r["name"]}`,
      detail: "",
      entity: "backup_job",
      id: String(r["id"]),
    }),
  },
  {
    sql: q`SELECT p.id, p.name, ROUND(SUM(m.quantity), 3) AS q, p.min_stock FROM products p JOIN stock_movements m ON m.product_id = p.id AND m.deleted_at IS NULL
           WHERE p.deleted_at IS NULL AND p.track_stock = 1 GROUP BY p.id HAVING q <= p.min_stock AND p.min_stock > 0`,
    params: () => [],
    build: (r) => ({
      severity: "warning",
      title: `Scorta bassa: ${r["name"]}`,
      detail: `Disponibili ${r["q"]} (minimo ${r["min_stock"]})`,
      entity: "product",
      id: String(r["id"]),
    }),
  },
  {
    // Lots with goods still in stock that expire within 30 days or already have.
    sql: q`SELECT l.id, l.code, l.expiry_date, p.name, ROUND(SUM(m.quantity), 3) AS q
           FROM stock_lots l JOIN products p ON p.id = l.product_id
           JOIN stock_movements m ON m.lot_id = l.id AND m.deleted_at IS NULL
           WHERE l.deleted_at IS NULL AND l.expiry_date IS NOT NULL AND l.expiry_date <= date(?, '+30 day')
           GROUP BY l.id HAVING q > 0`,
    params: (today) => [today],
    build: (r, today) => ({
      severity: String(r["expiry_date"]) < today ? "danger" : "warning",
      title: `${String(r["expiry_date"]) < today ? "Lotto scaduto" : "Lotto in scadenza"}: ${r["name"]} ${r["code"]}`,
      detail: `${r["q"]} in giacenza, scade il ${r["expiry_date"]}`,
      entity: "stock_lot",
      id: String(r["id"]),
    }),
  },
  {
    // An appointment with a reminder, from the moment the reminder is due until it starts.
    sql: q`SELECT a.id, a.title, a.starts_at, a.reminder_minutes FROM appointments a
           WHERE a.deleted_at IS NULL AND a.reminder_minutes IS NOT NULL
             AND a.starts_at > ? AND (strftime('%s', a.starts_at) - strftime('%s', ?)) <= a.reminder_minutes * 60`,
    params: (_today, now) => [now, now],
    build: (r) => ({
      severity: "warning",
      title: `Tra poco: ${r["title"]}`,
      detail: `Alle ${new Date(String(r["starts_at"])).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`,
      entity: "appointment",
      id: String(r["id"]),
    }),
  },
  {
    sql: q`SELECT t.id, t.title, t.remind_on FROM tasks t
           WHERE t.deleted_at IS NULL AND t.status IN ('todo', 'doing')
             AND t.remind_on IS NOT NULL AND t.remind_on <= ?`,
    params: (today) => [today],
    build: (r) => ({
      severity: "warning",
      title: `Promemoria: ${r["title"]}`,
      detail: `Da ricordare dal ${r["remind_on"]}`,
      entity: "task",
      id: String(r["id"]),
    }),
  },
  {
    sql: q`SELECT a.id, a.title, a.starts_at FROM appointments a WHERE a.deleted_at IS NULL AND date(a.starts_at) = ?`,
    params: (today) => [today],
    build: (r) => ({
      severity: "info",
      title: `Oggi: ${r["title"]}`,
      detail: String(r["starts_at"]).slice(11, 16),
      entity: "appointment",
      id: String(r["id"]),
    }),
  },
  {
    // The most recent result of each enabled check is "down".
    sql: q`SELECT c.id, c.name, c.host, c.port FROM monitor_checks c WHERE c.deleted_at IS NULL AND c.enabled = 1
           AND (SELECT up FROM monitor_results r WHERE r.check_id = c.id ORDER BY r.at DESC, r.id DESC LIMIT 1) = 0`,
    params: () => [],
    build: (r) => ({
      severity: "danger",
      title: `Non raggiungibile: ${r["name"]}`,
      detail: `${r["host"]}:${r["port"]}`,
      entity: "monitor_check",
      id: String(r["id"]),
    }),
  },
];

/** Everything that needs attention today, computed from the data; nothing is stored. */
export async function notifications(
  db: SqlRunner,
  today: string,
  now: string,
): Promise<Notification[]> {
  const found: Notification[] = [];
  for (const source of SOURCES) {
    const rows = await db.query(source.sql, source.params(today, now));
    for (const row of rows) {
      const built = source.build(row, today);
      if (built.entity === "backup_job") {
        const status = row["last_status"] as string | null;
        const lastAt = row["last_at"] as string | null;
        const limit = Number(row["expected_every_hours"]) * 1.5 * 3_600_000;
        if (!lastAt) built.detail = "Nessuna esecuzione registrata";
        else if (status === "failed")
          built.detail = `Ultima esecuzione fallita (${lastAt.slice(0, 10)})`;
        else if (Date.parse(now) - Date.parse(lastAt) > limit)
          built.detail = `Nessuna esecuzione dal ${lastAt.slice(0, 10)}`;
        else continue;
      }
      found.push({ ...built, key: `${built.entity}:${built.id}:${built.title}` } as Notification);
    }
  }
  const dismissed = new Set(
    (await db.query<{ key: string }>("SELECT key FROM dismissed_notifications")).map((r) => r.key),
  );
  const rank: Record<Severity, number> = { danger: 0, warning: 1, info: 2 };
  return found
    .filter((n) => !dismissed.has(n.key))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
}

export async function dismissNotification(db: SqlRunner, key: string, at: string): Promise<void> {
  await db.execute(
    "INSERT INTO dismissed_notifications (key, dismissed_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
    [key, at],
  );
}

export interface SearchHit {
  entity: string;
  id: string;
  label: string;
  title: string;
}

const LIKE = /[\\%_]/g;

/** Looks in the searchable fields of every entity. Soft-deleted records never match. */
export async function globalSearch(
  db: SqlRunner,
  registry: Registry,
  term: string,
  perEntity = 5,
): Promise<SearchHit[]> {
  const text = term.trim();
  if (text.length < 2) return [];
  const pattern = `%${text.replace(LIKE, (c) => `\\${c}`)}%`;
  const hits: SearchHit[] = [];
  for (const def of registry.entities) {
    const fields = def.fields.filter((f) => f.searchable);
    if (fields.length === 0 || def.key === "attachment") continue;
    const rows = await db.query(
      `SELECT * FROM ${def.table} WHERE deleted_at IS NULL AND (${fields.map((f) => `${f.name} LIKE ? ESCAPE '\\'`).join(" OR ")}) LIMIT ${perEntity}`,
      fields.map(() => pattern),
    );
    for (const row of rows) {
      hits.push({
        entity: def.key,
        id: String(row["id"]),
        label: def.label,
        title: def.title(row as never),
      });
    }
  }
  return hits;
}

export interface Kpis {
  receivables: number;
  overdue: number;
  payables: number;
  revenueYtd: number;
  pipelineOpen: number;
  pipelineWeighted: number;
  openTickets: number;
  openTasks: number;
  assets: number;
  openSecurityEvents: number;
}

export async function kpis(db: SqlRunner, today: string): Promise<Kpis> {
  const one = async (sql: string, params: (string | number)[] = []): Promise<number> =>
    Number((await db.query<{ v: number | null }>(sql, params))[0]?.v ?? 0);
  const openAmount = (types: string, extra = "") =>
    `SELECT SUM(COALESCE(d.payable, d.total) - COALESCE((SELECT SUM(amount) FROM payments x WHERE x.document_id = d.id AND x.deleted_at IS NULL), 0)) AS v
     FROM documents d WHERE d.status = 'issued' AND d.deleted_at IS NULL AND d.type IN (${types}) ${extra}`;
  const year = today.slice(0, 4);
  return {
    receivables: await one(openAmount("'invoice'")),
    overdue: await one(openAmount("'invoice'", "AND d.due_date < ?"), [today]),
    payables: await one(openAmount("'purchase_invoice'")),
    revenueYtd:
      (await one(
        `SELECT SUM(net_total) AS v FROM documents WHERE type = 'invoice' AND status = 'issued' AND deleted_at IS NULL AND date >= ?`,
        [`${year}-01-01`],
      )) -
      (await one(
        `SELECT SUM(net_total) AS v FROM documents WHERE type = 'credit_note' AND status = 'issued' AND deleted_at IS NULL AND date >= ?`,
        [`${year}-01-01`],
      )),
    pipelineOpen: await one(
      `SELECT SUM(o.amount) AS v FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id WHERE o.deleted_at IS NULL AND s.kind = 'open'`,
    ),
    pipelineWeighted: await one(
      `SELECT SUM(o.amount * s.probability / 100.0) AS v FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id WHERE o.deleted_at IS NULL AND s.kind = 'open'`,
    ),
    openTickets: await one(
      `SELECT COUNT(*) AS v FROM tickets WHERE deleted_at IS NULL AND status IN ('open', 'in_progress', 'waiting')`,
    ),
    openTasks: await one(
      `SELECT COUNT(*) AS v FROM tasks WHERE deleted_at IS NULL AND status IN ('todo', 'doing')`,
    ),
    assets: await one(
      `SELECT COUNT(*) AS v FROM assets WHERE deleted_at IS NULL AND status <> 'retired'`,
    ),
    openSecurityEvents: await one(
      `SELECT COUNT(*) AS v FROM security_events WHERE deleted_at IS NULL AND status <> 'resolved'`,
    ),
  };
}

/** Net revenue (invoices minus credit notes) of each of the last `months` months, oldest first. */
export async function revenueByMonth(
  db: SqlRunner,
  today: string,
  months = 12,
): Promise<{ month: string; amount: number }[]> {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const list: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const index = year * 12 + (month - 1) - i;
    list.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
  }
  const rows = await db.query<{ m: string; v: number | null }>(
    `SELECT substr(date, 1, 7) AS m,
            SUM(CASE WHEN type = 'credit_note' THEN -net_total ELSE net_total END) AS v
     FROM documents
     WHERE status = 'issued' AND deleted_at IS NULL AND type IN ('invoice', 'credit_note')
       AND date >= ? AND date <= ?
     GROUP BY m`,
    [`${list[0]}-01`, `${list[list.length - 1]}-31`],
  );
  const by = new Map(rows.map((r) => [r.m, Number(r.v ?? 0)]));
  return list.map((m) => ({ month: m, amount: by.get(m) ?? 0 }));
}
