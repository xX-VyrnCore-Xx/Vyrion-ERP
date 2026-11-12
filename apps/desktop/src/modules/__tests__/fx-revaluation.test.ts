// @vitest-environment node
import { describe, expect, it } from "vitest";

import { testWorkspace } from "../../test/workspace";
import { issueDocument, saveDocument } from "../operations";
import { closeYear } from "../periods";
import { trialBalance } from "../reports";
import { registerRevaluation, revaluationPreview } from "../fxRevaluation";

const clock = () => new Date("2026-12-20T10:00:00Z");

async function setup(now: () => Date = clock) {
  const ws = await testWorkspace("ordinario", now);
  const customer = await ws.create("party", { name: "Acme Inc", kind: "customer" });
  const supplier = await ws.create("party", { name: "Foreign Supplies", kind: "supplier" });
  const make = async (header: Record<string, unknown>, price: number) => {
    const doc = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { date: "2026-04-01", currency: "USD", exchange_rate: 1.1, ...header },
        lines: [{ description: "x", quantity: 1, unit_price: price, vat_rate: 22 }],
      }),
    );
    return ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, doc.id, "2026-04-01"));
  };
  const invoice = await make({ type: "invoice", party_id: customer.id }, 100000);
  const purchase = await make(
    { type: "purchase_invoice", number: "F-1", party_id: supplier.id },
    40000,
  );
  const balances = async (to = "2026-12-31") =>
    Object.fromEntries(
      (await trialBalance(ws.db, "2026-01-01", to)).map((r) => [r.code, r.balance]),
    );
  return { ws, invoice, purchase, balances };
}

describe("year-end adjustment of foreign-currency balances", () => {
  it("values the open amounts at the year-end rate", async () => {
    const { ws, invoice } = await setup();
    // half of the invoice is collected in USD before the year ends
    await ws.create("payment", {
      document_id: invoice.id,
      date: "2026-06-10",
      foreign_amount: 50000,
      method: "bank",
    });
    // a payment after the year end must not count
    const preview = await revaluationPreview(ws.db, 2026, { USD: 1.2 });
    expect(preview).toHaveLength(1);
    const usd = preview[0];
    const sale = usd?.items.find((i) => i.side === "receivable");
    // open 72.000 USD (122.000 − 50.000); carried 1.109,09 − 454,55 = 654,54 €; at 1,2: 600,00 €
    expect(sale).toMatchObject({
      foreignOpen: 72000,
      carrying: 65454,
      revalued: 60000,
      difference: -5454,
    });
    const debt = usd?.items.find((i) => i.side === "payable");
    // 488,00 USD owed, carried at 443,64 €, valued 406,67 €: the debt is worth less, a gain
    expect(debt).toMatchObject({ foreignOpen: 48800, carrying: 44364, revalued: 40667 });
    expect(debt?.difference).toBe(3697);
    expect(usd).toMatchObject({ gain: 3697, loss: 5454 });
  });

  it("without a rate nothing changes", async () => {
    const { ws } = await setup();
    const [usd] = await revaluationPreview(ws.db, 2026, {});
    expect(usd?.rate).toBeNull();
    expect(usd?.gain).toBe(0);
    expect(usd?.loss).toBe(0);
  });

  it("books the adjustment on 31 December and reverses it on 1 January", async () => {
    const { ws, invoice, balances } = await setup();
    await ws.create("payment", {
      document_id: invoice.id,
      date: "2026-06-10",
      foreign_amount: 50000,
      method: "bank",
    });
    const before = await balances();
    const [record] = await registerRevaluation(ws, 2026, { USD: 1.2 });
    expect(record).toMatchObject({ currency: "USD", gain: 3697, loss: 5454 });

    const year = await balances("2026-12-31");
    expect(year["110"]).toBe((before["110"] ?? 0) - 5454);
    expect(year["200"]).toBe((before["200"] ?? 0) + 3697); // the debt (a credit balance) shrinks
    expect(year["421"]).toBe(-3697);
    expect(year["541"]).toBe(5454);

    // on 1 January the books are back at the original rates
    const next = await balances("2027-01-01");
    expect(next["110"]).toBe(before["110"]);
    expect(next["200"]).toBe(before["200"]);
    expect(next["421"] ?? 0).toBe(-3697 + 3697);
    expect(next["541"] ?? 0).toBe(5454 - 5454);
    // everything balances
    expect(
      (await trialBalance(ws.db, "2026-01-01", "2027-12-31")).reduce((s, r) => s + r.balance, 0),
    ).toBe(0);
  });

  it("refuses to register the same currency and year twice, and a missing rate", async () => {
    const { ws } = await setup();
    await expect(registerRevaluation(ws, 2026, {})).rejects.toThrow(/almeno un cambio/);
    await expect(registerRevaluation(ws, 2026, { USD: 0 })).rejects.toThrow(/maggiore di zero/);
    await registerRevaluation(ws, 2026, { USD: 1.2 });
    await expect(registerRevaluation(ws, 2026, { USD: 1.3 })).rejects.toThrow(/già registrato/);
  });

  it("deleting it undoes both entries; the year can be adjusted again", async () => {
    const { ws, balances } = await setup();
    const before = await balances("2027-12-31");
    const [record] = await registerRevaluation(ws, 2026, { USD: 1.2 });
    await ws.remove("fx_revaluation", (record as { id: string }).id);
    const after = await balances("2027-12-31");
    for (const code of Object.keys(before)) expect(after[code] ?? 0).toBe(before[code] ?? 0);
    expect(after["421"] ?? 0).toBe(0);
    await registerRevaluation(ws, 2026, { USD: 1.25 });
  });

  it("feeds the result of the year, and is refused once the year is closed", async () => {
    const january = () => new Date("2027-01-10T10:00:00Z");
    const { ws } = await setup(january);
    await registerRevaluation(ws, 2026, { USD: 1.2 });
    await closeYear(ws, 2026);
    const result = Object.fromEntries(
      (await trialBalance(ws.db, "2026-01-01", "2026-12-31", { includeClosing: true })).map((r) => [
        r.code,
        r.balance,
      ]),
    );
    expect(result["421"]).toBe(0); // zeroed into the result by the closing entry
    expect(result["541"]).toBe(0);
    const { ws: late } = await setup(january);
    await closeYear(late, 2026);
    await expect(registerRevaluation(late, 2026, { USD: 1.2 })).rejects.toThrow();
  });
});
