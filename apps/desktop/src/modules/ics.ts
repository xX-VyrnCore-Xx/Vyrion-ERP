/**
 * Calendar exchange in the iCalendar format (.ics), understood by Outlook, Google Calendar,
 * Apple Calendar and the like: export appointments (and tasks) from Vyrion, import events from
 * a file. Importing the same file again updates instead of duplicating.
 */

import type { Rec } from "../data/entity";
import type { Workspace } from "../data/workspace";

const OWN_SUFFIX = "@vyrion.local";

// --- writing -----------------------------------------------------------------------------

const escapeText = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a content line at 75 octets (RFC 5545): continuation lines start with a space. */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const width = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // the leading space counts
    if (size + width > limit) {
      parts.push(current);
      current = ch;
      size = width;
    } else {
      current += ch;
      size += width;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const utc = (iso: string): string =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

const dayCompact = (day: string): string => day.replace(/-/g, "");

export interface ExportOptions {
  /** Include tasks with a due date (as VTODO). Default true. */
  tasks?: boolean;
}

export async function exportCalendar(ws: Workspace, options: ExportOptions = {}): Promise<string> {
  const now = utc(ws.ctx.now());
  const out: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VyrnCore Enterprises//Vyrion ERP//IT",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Vyrion ERP",
  ];
  const appointments = (await ws.db.query(
    "SELECT * FROM appointments WHERE deleted_at IS NULL ORDER BY starts_at",
  )) as unknown as Rec[];
  for (const a of appointments) {
    const start = String(a["starts_at"]);
    out.push("BEGIN:VEVENT", `UID:${a.id}${OWN_SUFFIX}`, `DTSTAMP:${now}`, `DTSTART:${utc(start)}`);
    // An event with no end lasts an hour, so calendars do not show it as zero-length.
    const end =
      (a["ends_at"] as string | null) ?? new Date(Date.parse(start) + 3_600_000).toISOString();
    out.push(`DTEND:${utc(end)}`, `SUMMARY:${escapeText(String(a["title"]))}`);
    if (a["location"]) out.push(`LOCATION:${escapeText(String(a["location"]))}`);
    if (a["notes"]) out.push(`DESCRIPTION:${escapeText(String(a["notes"]))}`);
    if (a["reminder_minutes"] !== null && a["reminder_minutes"] !== undefined) {
      out.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(String(a["title"]))}`,
        `TRIGGER:-PT${Number(a["reminder_minutes"])}M`,
        "END:VALARM",
      );
    }
    out.push("END:VEVENT");
  }
  if (options.tasks !== false) {
    const tasks = (await ws.db.query(
      "SELECT * FROM tasks WHERE deleted_at IS NULL AND due_date IS NOT NULL ORDER BY due_date",
    )) as unknown as Rec[];
    const status: Record<string, string> = {
      todo: "NEEDS-ACTION",
      doing: "IN-PROCESS",
      done: "COMPLETED",
      cancelled: "CANCELLED",
    };
    const priority: Record<string, string> = { high: "1", urgent: "1", normal: "5", low: "9" };
    for (const t of tasks) {
      out.push(
        "BEGIN:VTODO",
        `UID:${t.id}${OWN_SUFFIX}`,
        `DTSTAMP:${now}`,
        `DUE;VALUE=DATE:${dayCompact(String(t["due_date"]))}`,
        `SUMMARY:${escapeText(String(t["title"]))}`,
        `STATUS:${status[String(t["status"])] ?? "NEEDS-ACTION"}`,
        `PRIORITY:${priority[String(t["priority"])] ?? "5"}`,
      );
      if (t["notes"]) out.push(`DESCRIPTION:${escapeText(String(t["notes"]))}`);
      out.push("END:VTODO");
    }
  }
  out.push("END:VCALENDAR");
  return `${out.map(fold).join("\r\n")}\r\n`;
}

// --- reading -----------------------------------------------------------------------------

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

const unescapeText = (text: string): string =>
  text.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** Unfolds lines and splits them into properties. */
function properties(lines: string[]): Property[] {
  const out: Property[] = [];
  for (const line of lines) {
    const colon = (() => {
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        else if (line[i] === ":" && !quoted) return i;
      }
      return -1;
    })();
    if (colon < 0) continue;
    const [name = "", ...rest] = line.slice(0, colon).split(";");
    const params: Record<string, string> = {};
    for (const p of rest) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/"/g, "");
    }
    out.push({ name: name.toUpperCase(), params, value: line.slice(colon + 1) });
  }
  return out;
}

/** Offset of a time zone from UTC at an instant, in minutes. */
function zoneOffset(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

export interface ParsedTime {
  instant: string;
  allDay: boolean;
}

/** DTSTART/DTEND in any of its forms: UTC, with TZID, floating (local time) or a whole day. */
export function parseTime(prop: Property): ParsedTime | null {
  const v = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hasTime = m[4] !== undefined;
  const [h, mi, s] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  const allDay = !hasTime || prop.params["VALUE"] === "DATE";
  if (m[7]) return { instant: new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString(), allDay };
  const zone = prop.params["TZID"];
  if (zone && hasTime) {
    try {
      const guess = Date.UTC(y, mo - 1, d, h, mi, s);
      let ms = guess - zoneOffset(guess, zone) * 60_000;
      ms = guess - zoneOffset(ms, zone) * 60_000; // settle across a DST change
      return { instant: new Date(ms).toISOString(), allDay };
    } catch {
      /* an unknown zone name: read it as local time below */
    }
  }
  return { instant: new Date(y, mo - 1, d, h, mi, s).toISOString(), allDay };
}

export interface ImportedEvent {
  uid: string | null;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  notes: string | null;
  recurring: boolean;
}

export interface CalendarRead {
  events: ImportedEvent[];
  /** Components that are not events (tasks, journals) and were left out. */
  ignored: number;
}

export function readCalendar(text: string): CalendarRead {
  const lines = text
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/)
    .filter(Boolean);
  const events: ImportedEvent[] = [];
  let ignored = 0;
  let block: string[] | null = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") block = [];
    else if (upper === "END:VEVENT" && block) {
      const props = properties(block);
      block = null;
      const find = (name: string) => props.find((p) => p.name === name);
      const start = find("DTSTART") ? parseTime(find("DTSTART") as Property) : null;
      if (!start) {
        ignored++;
        continue;
      }
      const end = find("DTEND") ? parseTime(find("DTEND") as Property) : null;
      // An all-day DTEND is the day after the last one: the event ends at the end of the last day.
      const endsAt = end
        ? end.allDay
          ? new Date(Date.parse(end.instant) - 1000).toISOString()
          : end.instant
        : null;
      events.push({
        uid: find("UID")?.value.trim() || null,
        title: unescapeText(find("SUMMARY")?.value ?? "").trim() || "(senza titolo)",
        startsAt: start.instant,
        endsAt: endsAt && endsAt >= start.instant ? endsAt : null,
        location: unescapeText(find("LOCATION")?.value ?? "").trim() || null,
        notes: unescapeText(find("DESCRIPTION")?.value ?? "").trim() || null,
        recurring: Boolean(find("RRULE")),
      });
    } else if (upper.startsWith("BEGIN:") && !block && upper !== "BEGIN:VCALENDAR") {
      if (upper !== "BEGIN:VTIMEZONE" && upper !== "BEGIN:VALARM") ignored++;
    } else if (block) block.push(line);
  }
  return { events, ignored };
}

export interface CalendarImport {
  created: number;
  updated: number;
  unchanged: number;
  /** Recurring events: only the first occurrence is imported. */
  recurring: number;
  ignored: number;
}

export async function importCalendar(ws: Workspace, text: string): Promise<CalendarImport> {
  const read = readCalendar(text);
  const result: CalendarImport = {
    created: 0,
    updated: 0,
    unchanged: 0,
    recurring: 0,
    ignored: read.ignored,
  };
  for (const e of read.events) {
    if (e.recurring) result.recurring++;
    let existing: Rec | null = null;
    if (e.uid) {
      // Our own export carries the record's id; foreign events are told apart by their UID.
      if (e.uid.endsWith(OWN_SUFFIX))
        existing = await ws.get("appointment", e.uid.slice(0, -OWN_SUFFIX.length));
      if (!existing) {
        const [row] = (await ws.db.query(
          "SELECT * FROM appointments WHERE ics_uid = ? AND deleted_at IS NULL",
          [e.uid],
        )) as unknown as Rec[];
        existing = row ?? null;
      }
    }
    const values = {
      title: e.title,
      starts_at: e.startsAt,
      ends_at: e.endsAt,
      location: e.location,
      notes: e.notes,
    };
    if (existing) {
      // Instants are compared as moments: "…:00Z" and "…:00.000Z" are the same time.
      const same = (key: string, v: string | null): boolean => {
        const current = (existing?.[key] ?? null) as string | null;
        return key === "starts_at" || key === "ends_at"
          ? current === v ||
              (current !== null && v !== null && Date.parse(current) === Date.parse(v))
          : current === v;
      };
      const changed = Object.entries(values).filter(([k, v]) => !same(k, v));
      if (changed.length === 0) result.unchanged++;
      else {
        await ws.update("appointment", existing.id, Object.fromEntries(changed));
        result.updated++;
      }
    } else {
      await ws.create("appointment", {
        ...values,
        ics_uid: e.uid && !e.uid.endsWith(OWN_SUFFIX) ? e.uid : null,
      });
      result.created++;
    }
  }
  return result;
}
