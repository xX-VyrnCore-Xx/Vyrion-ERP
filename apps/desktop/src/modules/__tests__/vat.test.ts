// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ConflictError } from "../../data/errors";
import { testWorkspace } from "../../test/workspace";
import { issueDocument, saveDocument } from "../operations";
import { trialBalance, vatSummary } from "../reports";
import {
  CARRY_THRESHOLD,
  computeSettlement,
  historicalAdvance,
  periodRange,
  registerSettlement,
  vatRegister,
} from "../vat";

const clock = () => new Date("2027-03-10T10:00:00Z");

async function setup() {
  const ws = await testWorkspace("ordinario", clock);
  const customer = await ws.create("party", {
    name: "Rossi Srl",
    kind: "customer",
    vat_number: "00743110157",
  });
  const supplier = await ws.create("party", { name: "Fornitore Spa", kind: "supplier" });
  return { ws, customer, supplier };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** A sale or purchase of `price` cents + 22% VAT, issued on `date`. */
async function book(
  c: Ctx,
  kind: "invoice" | "purchase_invoice" | "credit_note",
  date: string,
  price: number,
  extra: Record<string, unknown> = {},
) {
  const doc = await c.ws.transact((tx, ctx, repo) =>
    saveDocument(tx, ctx, repo, {
      header: {
        type: kind,
        date,
        party_id: kind === "purchase_invoice" ? c.supplier.id : c.customer.id,
        ...(kind === "purchase_invoice" ? { number: `F-${date}-${price}` } : {}),
        ...extra,
      },
      lines: [{ description: "x", quantity: 1, unit_price: price, vat_rate: 22 }],
    }),
  );
  return c.ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, doc.id, date));
}

describe("periods", () => {
  it("knows the dates of months and quarters", () => {
    expect(periodRange(2026, "monthly", 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange(2024, "monthly", 2)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(periodRange(2026, "quarterly", 3)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(() => periodRange(2026, "quarterly", 5)).toThrow(/Periodo/);
  });
});

describe("registers", () => {
  it("lists documents by date with per-rate amounts, numbers purchases and keeps split VAT apart", async () => {
    const c = await setup();
    await book(c, "invoice", "2026-04-10", 100000);
    await book(c, "invoice", "2026-04-20", 50000, { split_payment: true });
    await book(c, "credit_note", "2026-04-25", 10000);
    await book(c, "purchase_invoice", "2026-04-05", 30000);
    await book(c, "purchase_invoice", "2026-04-18", 20000);

    const sales = await vatRegister(c.ws.db, "2026-04-01", "2026-04-30", "sales");
    expect(sales.lines.map((l) => [l.date, l.base, l.vat, l.split])).toEqual([
      ["2026-04-10", 100000, 22000, false],
      ["2026-04-20", 50000, 11000, true],
      ["2026-04-25", -10000, -2200, false],
    ]);
    expect(sales.lines[0]?.vatNumber).toBe("00743110157");
    expect(sales.totals).toMatchObject({ base: 90000, vat: 19800 }); // split sale left out
    expect(sales.splitVat).toBe(11000);

    const purchases = await vatRegister(c.ws.db, "2026-04-01", "2026-04-30", "purchases");
    expect(purchases.lines.map((l) => [l.protocol, l.vat])).toEqual([
      [1, 6600],
      [2, 4400],
    ]);
    // the numbering goes on when the register is asked from the middle of the year
    const later = await vatRegister(c.ws.db, "2026-04-10", "2026-04-30", "purchases");
    expect(later.lines.map((l) => l.protocol)).toEqual([2]);

    // the register and the period summary agree
    const summary = await vatSummary(c.ws.db, "2026-04-01", "2026-04-30");
    expect(summary.salesVat).toBe(sales.totals.vat);
    expect(summary.purchaseVat).toBe(purchases.totals.vat);
    expect(summary.splitVat).toBe(11000);
  });
});

describe("periodic settlement", () => {
  it("balances sales and purchases VAT and offers the due date", async () => {
    const c = await setup();
    await book(c, "invoice", "2026-04-10", 100000); // 22.000
    await book(c, "purchase_invoice", "2026-04-12", 30000); // 6.600
    const s = await computeSettlement(c.ws.db, 2026, "monthly", 4);
    expect(s).toMatchObject({
      salesVat: 22000,
      purchasesVat: 6600,
      balance: 15400,
      due: 15400,
      interest: 0,
      creditForward: 0,
      payBy: "2026-05-16",
    });
  });

  it("carries a credit into the next period and a small debit over the threshold rule", async () => {
    const c = await setup();
    await book(c, "purchase_invoice", "2026-04-12", 100000); // 22.000 credit
    await book(c, "invoice", "2026-04-20", 20000); // 4.400
    const april = await registerSettlement(c.ws, 2026, "monthly", 4);
    expect(april).toMatchObject({ due: 0, credit_forward: 17600 });

    // May: sales VAT 1.200 against a credit of 17.600 → credit goes on
    await book(c, "invoice", "2026-05-10", 5455); // VAT 1.200,10 → 1200
    const may = await computeSettlement(c.ws.db, 2026, "monthly", 5);
    expect(may.previousCredit).toBe(17600);
    expect(may.creditForward).toBeGreaterThan(16000);
    expect(may.due).toBe(0);

    // a debit under €25,82 is not paid but carried
    const c2 = await setup();
    await book(c2, "invoice", "2026-07-10", 10000); // 2.200 VAT
    await book(c2, "purchase_invoice", "2026-07-11", 9000); // 1.980 → balance 220 (< 25,82)
    const small = await computeSettlement(c2.ws.db, 2026, "monthly", 7);
    expect(small.balance).toBeLessThan(CARRY_THRESHOLD);
    expect(small).toMatchObject({ due: 0, debitForward: 220, creditForward: 0 });
    await registerSettlement(c2.ws, 2026, "monthly", 7);
    await book(c2, "invoice", "2026-08-10", 100000); // 22.000
    const august = await computeSettlement(c2.ws.db, 2026, "monthly", 8);
    expect(august).toMatchObject({ previousDebit: 220, balance: 22220, due: 22220 });
  });

  it("adds 1% interest to quarterly payments of quarters 1 to 3 only", async () => {
    const c = await setup();
    await book(c, "invoice", "2026-02-10", 100000);
    await book(c, "invoice", "2026-11-10", 100000);
    const q1 = await computeSettlement(c.ws.db, 2026, "quarterly", 1);
    expect(q1).toMatchObject({ balance: 22000, interest: 220, due: 22220, payBy: "2026-05-16" });
    const q4 = await computeSettlement(c.ws.db, 2026, "quarterly", 4);
    expect(q4).toMatchObject({ interest: 0, due: 22000, payBy: "2027-03-16" });
  });

  it("registers once, closes the period's VAT in the books and can be undone", async () => {
    const c = await setup();
    await book(c, "invoice", "2026-04-10", 100000);
    await book(c, "purchase_invoice", "2026-04-12", 30000);
    const rec = await registerSettlement(c.ws, 2026, "monthly", 4);
    await expect(registerSettlement(c.ws, 2026, "monthly", 4)).rejects.toBeInstanceOf(
      ConflictError,
    );
    const balances = async () =>
      Object.fromEntries(
        (await trialBalance(c.ws.db, "2026-01-01", "2027-12-31")).map((r) => [r.code, r.balance]),
      );
    let tb = await balances();
    expect(tb["220"] ?? 0).toBe(0); // VAT on sales cleared
    expect(tb["130"] ?? 0).toBe(0); // VAT on purchases cleared
    expect(tb["240"]).toBe(-15400); // owed to the tax authority
    expect((await computeSettlement(c.ws.db, 2026, "monthly", 4)).registeredId).toBe(rec.id);

    await c.ws.remove("vat_settlement", rec.id);
    tb = await balances();
    expect(tb["220"]).toBe(-22000);
    expect(tb["130"]).toBe(6600);
    expect(tb["240"] ?? 0).toBe(0);
  });

  it("asks for the previous period first", async () => {
    const c = await setup();
    await book(c, "invoice", "2026-04-10", 100000);
    await registerSettlement(c.ws, 2026, "monthly", 4);
    await expect(registerSettlement(c.ws, 2026, "monthly", 6)).rejects.toThrow(/precedente/);
    expect(await historicalAdvance(c.ws.db, 2027, "monthly")).toEqual({
      base: 0,
      advance: 0,
      due: false,
    });
  });

  it("computes the December advance as 88% of the last settlement of the previous year", async () => {
    const c = await setup();
    await book(c, "invoice", "2026-12-10", 100000);
    await registerSettlement(c.ws, 2026, "monthly", 12);
    const advance = await historicalAdvance(c.ws.db, 2027, "monthly");
    expect(advance).toEqual({ base: 22000, advance: 19360, due: true });
  });
});
