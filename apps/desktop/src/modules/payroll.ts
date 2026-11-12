/**
 * Payroll statements per month (prospetto gestionale): generate from the employee card and the
 * attendance, register in the books, mark as paid. See `payrollMath.ts` for what it does not do.
 */

import type { SqlRunner } from "../data/db";
import type { Rec } from "../data/entity";
import { ConflictError, ValidationError } from "../data/errors";
import type { Workspace } from "../data/workspace";
import { ACC, ensureAccount, postEntry } from "./accounting";
import { monthlyAttendance } from "./attendance";
import { payrolling } from "./erp";

/** Overtime is paid at the hourly rate plus this surcharge (%): the real one depends on the agreement. */
export const OVERTIME_SURCHARGE = 25;

const monthParts = (period: string): { year: number; month: number } => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) throw new ValidationError({ period: "Usa il formato AAAA-MM" });
  return { year: Number(m[1]), month: Number(m[2]) };
};
const lastDay = (period: string) => {
  const { year, month } = monthParts(period);
  return `${period}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
};

/**
 * Creates the draft payslip of an employee for a month from the employee card (gross, rates)
 * and the overtime of the attendance. Refuses a month that already has one.
 */
export async function generatePayslip(
  ws: Workspace,
  employeeId: string,
  period: string,
): Promise<Rec> {
  const { year, month } = monthParts(period);
  return ws.transact(async (tx, ctx, repo) => {
    const [employee] = (await tx.query(
      "SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL",
      [employeeId],
    )) as unknown as Rec[];
    if (!employee) throw new ConflictError("Dipendente non trovato");
    const gross = Number(employee["gross_monthly"] ?? 0);
    if (!gross) throw new ConflictError("Imposta il lordo mensile nella scheda del dipendente");
    const [existing] = await tx.query(
      "SELECT id FROM payslips WHERE employee_id = ? AND period = ? AND deleted_at IS NULL",
      [employeeId, period],
    );
    if (existing)
      throw new ConflictError("Esiste già una busta paga di questo mese per il dipendente");
    const row = (await monthlyAttendance(tx, year, month)).find((r) => r.employeeId === employeeId);
    const weekly = employee["weekly_hours"] === null ? 40 : Number(employee["weekly_hours"] ?? 40);
    // monthly hours ≈ weekly × 52 / 12
    const hourly = weekly > 0 ? gross / ((weekly * 52) / 12) : 0;
    const overtimePay = Math.round(
      ((row?.overtimeMinutes ?? 0) / 60) * hourly * (1 + OVERTIME_SURCHARGE / 100),
    );
    return repo("payslip").create(tx, ctx, {
      employee_id: employeeId,
      period,
      base_pay: gross,
      overtime_pay: overtimePay,
      contrib_employee_pct: Number(employee["contrib_employee_pct"] ?? 0),
      contrib_employer_pct: Number(employee["contrib_employer_pct"] ?? 0),
      tax_pct: Number(employee["tax_pct"] ?? 0),
    });
  });
}

async function load(tx: SqlRunner, id: string): Promise<Rec> {
  const [row] = (await tx.query("SELECT * FROM payslips WHERE id = ? AND deleted_at IS NULL", [
    id,
  ])) as unknown as Rec[];
  if (!row) throw new ConflictError("Busta paga non trovata");
  return row;
}

/** Books the payslip: personnel cost against the debts to the employee, the social security and the tax authority. */
export async function registerPayslip(ws: Workspace, id: string): Promise<Rec> {
  return ws.transact(async (tx, ctx, repo) => {
    const p = await load(tx, id);
    if (p["status"] !== "draft") throw new ConflictError("La busta paga è già registrata");
    for (const code of [
      ACC.personnelCost,
      ACC.employeesPayable,
      ACC.socialSecurity,
      ACC.employeeTax,
    ])
      await ensureAccount(tx, ctx, repo, code);
    const n = (k: string) => Number(p[k] ?? 0);
    const [employee] = (await tx.query("SELECT first_name, last_name FROM employees WHERE id = ?", [
      p["employee_id"] as string,
    ])) as unknown as { first_name: string; last_name: string }[];
    await postEntry(tx, ctx, repo, {
      date: lastDay(String(p["period"])),
      description:
        `Retribuzioni ${p["period"]} · ${employee?.last_name ?? ""} ${employee?.first_name ?? ""}`.trim(),
      sourceId: id,
      lines: [
        {
          account: ACC.personnelCost,
          debit: n("gross") + n("contrib_employer") + n("reimbursements"),
        },
        { account: ACC.employeesPayable, credit: n("net") },
        { account: ACC.socialSecurity, credit: n("contrib_employee") + n("contrib_employer") },
        { account: ACC.employeeTax, credit: n("income_tax") },
      ],
    });
    payrolling.add(id);
    try {
      return await repo("payslip").update(tx, ctx, id, { status: "registered" });
    } finally {
      payrolling.delete(id);
    }
  });
}

/** Pays the net amount to the employee (bank transfer or cash). */
export async function payPayslip(
  ws: Workspace,
  id: string,
  date: string,
  method: "bank" | "cash" = "bank",
): Promise<Rec> {
  return ws.transact(async (tx, ctx, repo) => {
    const p = await load(tx, id);
    if (p["status"] === "draft") throw new ConflictError("Registra prima la busta paga");
    if (p["status"] === "paid") throw new ConflictError("La busta paga è già stata pagata");
    await postEntry(tx, ctx, repo, {
      date,
      description: `Pagamento retribuzioni ${p["period"]}`,
      sourceId: id,
      source: "payment",
      lines: [
        { account: ACC.employeesPayable, debit: Number(p["net"] ?? 0) },
        { account: method === "bank" ? ACC.bank : ACC.cash, credit: Number(p["net"] ?? 0) },
      ],
    });
    payrolling.add(id);
    try {
      return await repo("payslip").update(tx, ctx, id, { status: "paid", paid_date: date });
    } finally {
      payrolling.delete(id);
    }
  });
}

export interface PayrollTotals {
  gross: number;
  contribEmployee: number;
  contribEmployer: number;
  incomeTax: number;
  net: number;
  totalCost: number;
}

/** Totals of the payslips of a month (every status). */
export async function payrollTotals(db: SqlRunner, period: string): Promise<PayrollTotals> {
  const [row] = (await db.query(
    `SELECT COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(contrib_employee),0) AS ce,
            COALESCE(SUM(contrib_employer),0) AS cr, COALESCE(SUM(income_tax),0) AS tax,
            COALESCE(SUM(net),0) AS net, COALESCE(SUM(total_cost),0) AS cost
     FROM payslips WHERE period = ? AND deleted_at IS NULL`,
    [period],
  )) as unknown as Record<string, number>[];
  return {
    gross: Number(row?.["gross"]),
    contribEmployee: Number(row?.["ce"]),
    contribEmployer: Number(row?.["cr"]),
    incomeTax: Number(row?.["tax"]),
    net: Number(row?.["net"]),
    totalCost: Number(row?.["cost"]),
  };
}
