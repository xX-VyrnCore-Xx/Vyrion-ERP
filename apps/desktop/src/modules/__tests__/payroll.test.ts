// @vitest-environment node
import { describe, expect, it } from "vitest";

import { testWorkspace } from "../../test/workspace";
import { holidays, importPunches, monthlyAttendance, workingDays } from "../attendance";
import { trialBalance } from "../reports";
import { generatePayslip, payPayslip, payrollTotals, registerPayslip } from "../payroll";
import { computePayslip } from "../payrollMath";

const clock = () => new Date("2026-06-15T10:00:00Z");

async function setup() {
  const ws = await testWorkspace("ordinario", clock);
  const mario = await ws.create("employee", {
    first_name: "Mario",
    last_name: "Rossi",
    email: "mario@example.com",
    hire_date: "2025-01-01",
    weekly_hours: 40,
    gross_monthly: 200000,
    contrib_employee_pct: 10,
    contrib_employer_pct: 30,
    tax_pct: 20,
  });
  return { ws, mario };
}

describe("payroll arithmetic", () => {
  it("applies the rates the person enters", () => {
    expect(
      computePayslip({
        basePay: 200000,
        overtimePay: 10000,
        reimbursements: 5000,
        employeePct: 10,
        employerPct: 30,
        taxPct: 20,
      }),
    ).toEqual({
      gross: 210000,
      contrib_employee: 21000,
      contrib_employer: 63000,
      income_tax: 37800, // 20% of 1.890,00
      net: 156200, // 2.100 − 210 − 378 + 50
      total_cost: 278000, // 2.100 + 630 + 50
    });
  });

  it("is plain gross-to-net when no rate is set", () => {
    expect(computePayslip({ basePay: 100000 })).toMatchObject({ net: 100000, total_cost: 100000 });
  });
});

describe("working calendar", () => {
  it("knows the Italian holidays, Easter Monday included", () => {
    expect(holidays(2026).has("2026-04-06")).toBe(true); // Easter 2026: 5 April
    expect(holidays(2027).has("2027-03-29")).toBe(true); // Easter 2027: 28 March
    expect(holidays(2026).has("2026-04-25")).toBe(true);
  });

  it("counts Monday–Friday without holidays", () => {
    // April 2026: 22 weekdays, minus Easter Monday (6th) and 25 April (a Saturday: no effect)
    expect(workingDays(2026, 4)).toHaveLength(21);
    expect(workingDays(2026, 6)).toHaveLength(21); // 22 weekdays, minus 2 June
  });
});

describe("attendance", () => {
  it("computes worked time and refuses nonsense", async () => {
    const { ws, mario } = await setup();
    const day = await ws.create("attendance", {
      employee_id: mario.id,
      date: "2026-06-03",
      clock_in: "08:30",
      clock_out: "17:30",
      break_minutes: 60,
    });
    expect(day["worked_minutes"]).toBe(480);
    await expect(
      ws.create("attendance", {
        employee_id: mario.id,
        date: "2026-06-04",
        clock_in: "18:00",
        clock_out: "09:00",
      }),
    ).rejects.toThrow(/dopo l'entrata/);
    await expect(
      ws.create("attendance", {
        employee_id: mario.id,
        date: "2026-06-05",
        clock_in: "8:30",
        clock_out: "17:00",
      }),
    ).rejects.toThrow(/HH:MM/);
    await expect(
      ws.create("attendance", {
        employee_id: mario.id,
        date: "2026-06-03",
        clock_in: "09:00",
        clock_out: "10:00",
      }),
    ).rejects.toThrow();
  });

  it("sums the month: expected hours, overtime, leave", async () => {
    const { ws, mario } = await setup();
    // 21 working days in June 2026; 2 approved vacation days → 19 expected × 8h = 152h
    await ws.create("leave", {
      employee_id: mario.id,
      kind: "vacation",
      start_date: "2026-06-08",
      end_date: "2026-06-09",
      status: "approved",
    });
    await ws.create("leave", {
      employee_id: mario.id,
      kind: "sick",
      start_date: "2026-06-10",
      end_date: "2026-06-10",
      status: "requested", // not approved: does not reduce the expected hours
    });
    for (const [date, out] of [
      ["2026-06-01", "17:30"],
      ["2026-06-03", "19:30"], // 2 h over
    ] as const)
      await ws.create("attendance", {
        employee_id: mario.id,
        date,
        clock_in: "08:30",
        clock_out: out,
        break_minutes: 60,
      });
    const [row] = await monthlyAttendance(ws.db, 2026, 6);
    expect(row).toMatchObject({
      name: "Mario Rossi",
      expectedMinutes: 19 * 480,
      workedMinutes: 480 + 600,
      leaveDays: { vacation: 2, sick: 0, permit: 0 },
      daysWorked: 2,
    });
    expect(row?.overtimeMinutes).toBe(0);
    expect(row?.missingMinutes).toBe(19 * 480 - 1080);
  });

  it("does not count an employee hired after the month", async () => {
    const { ws } = await setup();
    await ws.create("employee", {
      first_name: "Nuovo",
      last_name: "Arrivo",
      hire_date: "2026-07-01",
    });
    expect((await monthlyAttendance(ws.db, 2026, 6)).map((r) => r.name)).toEqual(["Mario Rossi"]);
  });

  it("imports a time clock export, updates a known day and reports bad rows", async () => {
    const { ws, mario } = await setup();
    const csv = [
      "Dipendente;Data;Entrata;Uscita;Pausa",
      "mario@example.com;01/06/2026;08:30;17:30;60",
      "Rossi Mario;02/06/2026;09:00;18:00;60",
      "sconosciuto@example.com;02/06/2026;09:00;18:00;60",
      "mario@example.com;31/06/2026;09:00;18:00;60",
      "mario@example.com;03/06/2026;9;18:00;60",
    ].join("\n");
    const first = await importPunches(ws, csv);
    expect(first).toMatchObject({ created: 2, updated: 0 });
    expect(first.problems.map((p) => p.line)).toEqual([4, 5, 6]);
    // importing again updates instead of duplicating
    const again = await importPunches(
      ws,
      "Email;Data;Entrata;Uscita\nmario@example.com;2026-06-01;08:00;17:00",
    );
    expect(again).toMatchObject({ created: 0, updated: 1 });
    const rows = await ws.list("attendance", { limit: 50 });
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.find((r) => r["date"] === "2026-06-01")).toMatchObject({
      worked_minutes: 540,
      source: "import",
      employee_id: mario.id,
    });
    await expect(importPunches(ws, "A;B\n1;2")).rejects.toThrow(/colonne/);
  });
});

describe("payslips", () => {
  it("generates from the card, with the overtime of the attendance", async () => {
    const { ws, mario } = await setup();
    await ws.create("attendance", {
      employee_id: mario.id,
      date: "2026-06-01",
      clock_in: "08:00",
      clock_out: "20:00", // 12 h − 1 h break = 11 h; 8 h expected on a working day... month totals below
      break_minutes: 60,
    });
    const slip = await generatePayslip(ws, mario.id, "2026-06");
    expect(slip).toMatchObject({ base_pay: 200000, period: "2026-06", status: "draft" });
    // the month expects 21 × 8 h and only 11 h were worked: no overtime
    expect(slip["overtime_pay"]).toBe(0);
    expect(slip["gross"]).toBe(200000);
    expect(slip["net"]).toBe(200000 - 20000 - 36000);
    await expect(generatePayslip(ws, mario.id, "2026-06")).rejects.toThrow(/Esiste già/);
    const noPay = await ws.create("employee", { first_name: "A", last_name: "B" });
    await expect(generatePayslip(ws, noPay.id, "2026-06")).rejects.toThrow(/lordo mensile/);
  });

  it("pays overtime with the surcharge", async () => {
    const { ws, mario } = await setup();
    // one day of 10 h net in a month where only that day is worked is still far below expected,
    // so give the employee a one-day month: hired and ended on the same working day
    await ws.update("employee", mario.id, { hire_date: "2026-06-03", end_date: "2026-06-03" });
    await ws.create("attendance", {
      employee_id: mario.id,
      date: "2026-06-03",
      clock_in: "08:00",
      clock_out: "19:00",
      break_minutes: 60, // 10 h worked, 8 h expected → 2 h overtime
    });
    const slip = await generatePayslip(ws, mario.id, "2026-06");
    // hourly = 2000 € / (40 × 52 / 12 = 173.33 h) = 11.538 €; × 1.25 × 2 h = 28.846 €
    expect(slip["overtime_pay"]).toBe(2885);
  });

  it("registers in the books, balances, and is paid", async () => {
    const { ws, mario } = await setup();
    const slip = await generatePayslip(ws, mario.id, "2026-06");
    await registerPayslip(ws, slip.id);
    let tb = Object.fromEntries(
      (await trialBalance(ws.db, "2026-01-01", "2026-12-31")).map((r) => [r.code, r.balance]),
    );
    expect(tb["510"]).toBe(260000); // 2.000 + 30% = 2.600
    expect(tb["250"]).toBe(-144000); // net: 2.000 − 200 − 360
    expect(tb["251"]).toBe(-(20000 + 60000));
    expect(tb["252"]).toBe(-36000);
    await expect(registerPayslip(ws, slip.id)).rejects.toThrow(/già registrata/);
    // a registered payslip cannot be edited
    await expect(ws.update("payslip", slip.id, { base_pay: 1 })).rejects.toThrow(/non si modifica/);

    await payPayslip(ws, slip.id, "2026-06-30");
    tb = Object.fromEntries(
      (await trialBalance(ws.db, "2026-01-01", "2026-12-31")).map((r) => [r.code, r.balance]),
    );
    expect(tb["250"] ?? 0).toBe(0);
    expect(tb["120"]).toBe(-144000);
    await expect(payPayslip(ws, slip.id, "2026-06-30")).rejects.toThrow(/già stata pagata/);
    await expect(ws.remove("payslip", slip.id)).rejects.toThrow(/già stata pagata/);
    expect(await payrollTotals(ws.db, "2026-06")).toMatchObject({
      gross: 200000,
      net: 144000,
      totalCost: 260000,
    });
  });

  it("undoes a registered payslip when it is deleted", async () => {
    const { ws, mario } = await setup();
    const slip = await generatePayslip(ws, mario.id, "2026-06");
    await registerPayslip(ws, slip.id);
    await ws.remove("payslip", slip.id);
    const tb = await trialBalance(ws.db, "2026-01-01", "2026-12-31");
    expect(tb.every((r) => r.balance === 0)).toBe(true);
    // and the month can be made again
    await generatePayslip(ws, mario.id, "2026-06");
  });
});
