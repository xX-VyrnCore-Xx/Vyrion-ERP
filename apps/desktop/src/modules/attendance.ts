/**
 * Attendance: expected hours, worked hours and overtime per employee and month, and the import
 * of punches exported by a time clock (timbratore).
 *
 * Expected hours = working days (Monday–Friday, without the Italian national holidays and
 * without approved leave) × weekly hours ÷ 5. Overtime is what exceeds them. How overtime is
 * paid depends on the collective agreement: the figures here are a working tool.
 */

import type { SqlRunner } from "../data/db";
import type { Rec } from "../data/entity";
import { ValidationError } from "../data/errors";
import type { Workspace } from "../data/workspace";
import { parseCsv } from "./csv";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Easter Sunday (Gauss' algorithm for the Gregorian calendar). */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** National holidays in Italy (the patron saint's day of a city is not included). */
export function holidays(year: number): Set<string> {
  const fixed = [
    "01-01",
    "01-06",
    "04-25",
    "05-01",
    "06-02",
    "08-15",
    "11-01",
    "12-08",
    "12-25",
    "12-26",
  ];
  const monday = easter(year);
  monday.setUTCDate(monday.getUTCDate() + 1);
  return new Set([...fixed.map((d) => `${year}-${d}`), iso(monday)]);
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

/** Working days (Mon–Fri, not a national holiday) of a month, as ISO dates. */
export function workingDays(year: number, month: number): string[] {
  const off = holidays(year);
  const { to } = monthRange(year, month);
  const days: string[] = [];
  for (let day = 1; day <= Number(to.slice(8)); day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = date.getUTCDay();
    const text = iso(date);
    if (weekday !== 0 && weekday !== 6 && !off.has(text)) days.push(text);
  }
  return days;
}

export interface AttendanceRow {
  employeeId: string;
  name: string;
  weeklyHours: number;
  expectedMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  missingMinutes: number;
  /** Working days covered by approved leave, by kind. */
  leaveDays: { vacation: number; sick: number; permit: number };
  daysWorked: number;
}

/** Hours of every employee employed during the month. */
export async function monthlyAttendance(
  db: SqlRunner,
  year: number,
  month: number,
): Promise<AttendanceRow[]> {
  const { from, to } = monthRange(year, month);
  const days = workingDays(year, month);
  const employees = (await db.query(
    `SELECT * FROM employees WHERE deleted_at IS NULL
       AND (hire_date IS NULL OR hire_date <= ?) AND (end_date IS NULL OR end_date >= ?)
     ORDER BY last_name, first_name`,
    [to, from],
  )) as unknown as Rec[];
  const rows: AttendanceRow[] = [];
  for (const employee of employees) {
    const id = employee.id;
    const weekly = employee["weekly_hours"] === null ? 40 : Number(employee["weekly_hours"] ?? 40);
    const daily = Math.round((weekly * 60) / 5);
    const hired = (employee["hire_date"] as string | null) ?? from;
    const ended = (employee["end_date"] as string | null) ?? to;
    const employed = days.filter((d) => d >= hired && d <= ended);
    const leaves = (await db.query(
      `SELECT kind, start_date, end_date FROM leaves WHERE employee_id = ? AND deleted_at IS NULL
         AND status = 'approved' AND start_date <= ? AND end_date >= ?`,
      [id, to, from],
    )) as unknown as {
      kind: keyof AttendanceRow["leaveDays"];
      start_date: string;
      end_date: string;
    }[];
    const leaveDays = { vacation: 0, sick: 0, permit: 0 };
    let expectedDays = 0;
    for (const day of employed) {
      const leave = leaves.find((l) => l.start_date <= day && l.end_date >= day);
      if (leave) leaveDays[leave.kind] += 1;
      else expectedDays += 1;
    }
    const [sum] = (await db.query(
      `SELECT COALESCE(SUM(worked_minutes), 0) AS minutes, COUNT(*) AS n FROM attendances
       WHERE employee_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?`,
      [id, from, to],
    )) as unknown as { minutes: number; n: number }[];
    const worked = Number(sum?.minutes ?? 0);
    const expected = expectedDays * daily;
    rows.push({
      employeeId: id,
      name: `${employee["first_name"]} ${employee["last_name"]}`,
      weeklyHours: weekly,
      expectedMinutes: expected,
      workedMinutes: worked,
      overtimeMinutes: Math.max(0, worked - expected),
      missingMinutes: Math.max(0, expected - worked),
      leaveDays,
      daysWorked: Number(sum?.n ?? 0),
    });
  }
  return rows;
}

export const hours = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;

export interface PunchImport {
  created: number;
  updated: number;
  problems: { line: number; reason: string }[];
}

const normal = (text: string) => text.trim().toLowerCase();

function toDay(text: string): string | null {
  const t = text.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  const itMatch = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const parts = isoMatch
    ? { y: isoMatch[1], m: isoMatch[2], d: isoMatch[3] }
    : itMatch
      ? { y: itMatch[3], m: itMatch[2], d: itMatch[1] }
      : null;
  if (!parts?.y || !parts.m || !parts.d) return null;
  const day = `${parts.y}-${parts.m.padStart(2, "0")}-${parts.d.padStart(2, "0")}`;
  const date = new Date(Date.UTC(Number(parts.y), Number(parts.m) - 1, Number(parts.d)));
  return iso(date) === day ? day : null;
}

const toTime = (text: string): string | null => {
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(text.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh < 24 && mm < 60 ? `${pad(hh)}:${pad(mm)}` : null;
};

/**
 * Reads a time clock export: one row per day with the employee (email, or "Cognome Nome"),
 * date, in, out and optionally the break in minutes. A day already recorded is updated.
 * Rows that cannot be read are reported and skipped.
 */
export async function importPunches(ws: Workspace, text: string): Promise<PunchImport> {
  const rows = parseCsv(text);
  const header = (rows.shift() ?? []).map(normal);
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const who = find(/email|mail|dipendente|nome|matricola|cognome/);
  const date = find(/^data|giorno/);
  const inn = find(/entrata|ingresso|^in$/);
  const out = find(/uscita|^out$/);
  const pause = find(/pausa|break/);
  if (who < 0 || date < 0 || inn < 0 || out < 0)
    throw new ValidationError({
      file: "Non trovo le colonne: servono Dipendente (o Email), Data, Entrata e Uscita (Pausa è facoltativa)",
    });
  const result: PunchImport = { created: 0, updated: 0, problems: [] };
  const employees = (await ws.db.query(
    "SELECT id, first_name, last_name, email FROM employees WHERE deleted_at IS NULL",
  )) as unknown as { id: string; first_name: string; last_name: string; email: string | null }[];
  const find2 = (key: string) => {
    const k = normal(key);
    const hit = employees.filter(
      (e) =>
        normal(e.email ?? "") === k ||
        normal(`${e.last_name} ${e.first_name}`) === k ||
        normal(`${e.first_name} ${e.last_name}`) === k,
    );
    return hit.length === 1 ? (hit[0] ?? null) : null;
  };
  let line = 1;
  for (const cells of rows) {
    line += 1;
    const employee = find2(cells[who] ?? "");
    const day = toDay(cells[date] ?? "");
    const tin = toTime(cells[inn] ?? "");
    const tout = toTime(cells[out] ?? "");
    if (!employee) {
      result.problems.push({ line, reason: `dipendente non riconosciuto «${cells[who] ?? ""}»` });
      continue;
    }
    if (!day) {
      result.problems.push({ line, reason: `data non valida «${cells[date] ?? ""}»` });
      continue;
    }
    if (!tin || !tout) {
      result.problems.push({ line, reason: "orario non valido (usa HH:MM)" });
      continue;
    }
    const minutes = pause >= 0 ? Number((cells[pause] ?? "").trim() || 0) : 0;
    if (!Number.isInteger(minutes) || minutes < 0) {
      result.problems.push({ line, reason: `pausa non valida «${cells[pause] ?? ""}»` });
      continue;
    }
    try {
      await ws.transact(async (tx, ctx, repo) => {
        const [existing] = (await tx.query(
          "SELECT id FROM attendances WHERE employee_id = ? AND date = ? AND deleted_at IS NULL",
          [employee.id, day],
        )) as unknown as { id: string }[];
        const values = {
          employee_id: employee.id,
          date: day,
          clock_in: tin,
          clock_out: tout,
          break_minutes: minutes,
          source: "import",
        };
        if (existing) {
          await repo("attendance").update(tx, ctx, existing.id, values);
          result.updated += 1;
        } else {
          await repo("attendance").create(tx, ctx, values);
          result.created += 1;
        }
      });
    } catch (error) {
      result.problems.push({
        line,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
