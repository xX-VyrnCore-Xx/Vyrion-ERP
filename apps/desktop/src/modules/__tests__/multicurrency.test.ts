// @vitest-environment node
import { describe, expect, it } from "vitest";

import { testWorkspace } from "../../test/workspace";
import { writeFileSync } from "node:fs";

import { buildDocumentPdf } from "../documentPdf";
import { computeTotals } from "../documents";
import { issueDocument, saveDocument } from "../operations";
import { aging, trialBalance, vatSummary } from "../reports";

const clock = () => new Date("2026-06-15T10:00:00Z");
const line = { description: "Consulenza", quantity: 1, unit_price: 100000, vat_rate: 22 };

describe("totals in a foreign currency", () => {
  it("computes in the currency and converts each part to euro", () => {
    const t = computeTotals([{ quantity: 1, unit_price: 100000, vat_rate: 22 }], "ordinario", {
      currency: "USD",
      rate: 1.1,
    });
    expect(t.foreign).toMatchObject({ net: 100000, vat: 22000, total: 122000, stamp: 0 });
    expect(t).toMatchObject({
      net: 90909,
      vat: 20000,
      total: 110909, // the euro parts add up exactly
      payable: 110909,
      currency: "USD",
    });
    expect(t.breakdown[0]).toMatchObject({ rate: 22, base: 90909, vat: 20000 });
  });

  it("leaves euro documents exactly as before", () => {
    const t = computeTotals([{ quantity: 1, unit_price: 100000, vat_rate: 22 }], "ordinario", {
      currency: "EUR",
      rate: 1.1,
    });
    expect(t.foreign).toBeUndefined();
    expect(t.total).toBe(122000);
  });
});

async function setup() {
  const ws = await testWorkspace("ordinario", clock);
  const customer = await ws.create("party", { name: "Acme Inc", kind: "customer" });
  const supplier = await ws.create("party", { name: "Foreign Supplies", kind: "supplier" });
  const draft = (header: Record<string, unknown>) =>
    ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { date: "2026-04-01", ...header },
        lines: [line],
      }),
    );
  const issue = (id: string) =>
    ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, id, "2026-04-01"));
  const balances = async () =>
    Object.fromEntries(
      (await trialBalance(ws.db, "2026-01-01", "2026-12-31")).map((r) => [r.code, r.balance]),
    );
  return { ws, customer, supplier, draft, issue, balances };
}

describe("invoices in a foreign currency", () => {
  it("stores euro totals and the totals in the currency, and books in euro", async () => {
    const { draft, issue, customer, balances, ws } = await setup();
    const doc = await draft({
      type: "invoice",
      party_id: customer.id,
      currency: "usd",
      exchange_rate: 1.1,
    });
    expect(doc).toMatchObject({
      currency: "USD",
      total: 110909,
      payable: 110909,
      foreign_total: 122000,
      foreign_payable: 122000,
    });
    await issue(doc.id);
    const tb = await balances();
    expect(tb["110"]).toBe(110909);
    expect(tb["400"]).toBe(-90909);
    expect(tb["220"]).toBe(-20000);
    // the VAT summary and registers are in euro and agree
    const vat = await vatSummary(ws.db, "2026-04-01", "2026-04-30");
    expect(vat.salesVat).toBe(20000);
  });

  it("requires a rate, and freezes currency and rate once issued", async () => {
    const { draft, issue, customer, ws } = await setup();
    await expect(
      draft({ type: "invoice", party_id: customer.id, currency: "USD" }),
    ).rejects.toThrow(/cambio/);
    await expect(
      draft({ type: "invoice", party_id: customer.id, currency: "DOLLARI", exchange_rate: 1 }),
    ).rejects.toThrow(/3 caratteri/);
    const doc = await draft({
      type: "invoice",
      party_id: customer.id,
      currency: "USD",
      exchange_rate: 1.1,
    });
    const issued = await issue(doc.id);
    await expect(ws.update("document", issued.id, { exchange_rate: 1.2 })).rejects.toThrow();
  });

  it("settles in the currency and books the exchange difference", async () => {
    const { draft, issue, customer, balances, ws } = await setup();
    const doc = await draft({
      type: "invoice",
      party_id: customer.id,
      currency: "USD",
      exchange_rate: 1.1,
    });
    const issued = await issue(doc.id);

    // half in USD; the bank credits 560,00 € where the document valued it 554,55 €: a gain
    const first = await ws.create("payment", {
      document_id: issued.id,
      date: "2026-05-10",
      foreign_amount: 61000,
      received: 56000,
      method: "bank",
    });
    expect(first).toMatchObject({ amount: 55455, received: 56000 });
    let tb = await balances();
    expect(tb["120"]).toBe(56000);
    expect(tb["110"]).toBe(110909 - 55455);
    expect(tb["420"]).toBe(-545);

    // the rest, in full: clears exactly what is open (no cent left over); a loss this time
    const second = await ws.create("payment", {
      document_id: issued.id,
      date: "2026-06-10",
      foreign_amount: 61000,
      received: 54000,
      method: "bank",
    });
    expect(second["amount"]).toBe(110909 - 55455);
    tb = await balances();
    expect(tb["110"] ?? 0).toBe(0);
    expect(tb["120"]).toBe(110000);
    expect(tb["540"]).toBe(1454);
    expect(await aging(ws.db, "2026-07-01", "receivable")).toEqual([]);

    // everything balances
    const all = await trialBalance(ws.db, "2026-01-01", "2026-12-31");
    expect(all.reduce((sum, r) => sum + r.balance, 0)).toBe(0);
  });

  it("without `received` the euro cashed is the document value: no difference", async () => {
    const { draft, issue, customer, balances, ws } = await setup();
    const doc = await draft({
      type: "invoice",
      party_id: customer.id,
      currency: "USD",
      exchange_rate: 1.1,
    });
    const issued = await issue(doc.id);
    await ws.create("payment", {
      document_id: issued.id,
      date: "2026-05-10",
      foreign_amount: 122000,
      method: "bank",
    });
    const tb = await balances();
    expect(tb["420"] ?? 0).toBe(0);
    expect(tb["540"] ?? 0).toBe(0);
    expect(tb["120"]).toBe(110909);
  });

  it("refuses payments that do not make sense", async () => {
    const { draft, issue, customer, ws } = await setup();
    const doc = await draft({
      type: "invoice",
      party_id: customer.id,
      currency: "USD",
      exchange_rate: 1.1,
    });
    const issued = await issue(doc.id);
    await expect(
      ws.create("payment", {
        document_id: issued.id,
        date: "2026-05-10",
        amount: 1000,
        method: "bank",
      }),
    ).rejects.toThrow(/in USD/);
    await expect(
      ws.create("payment", {
        document_id: issued.id,
        date: "2026-05-10",
        foreign_amount: 122001,
        method: "bank",
      }),
    ).rejects.toThrow(/supera il residuo/);
    const eur = await draft({ type: "invoice", party_id: customer.id });
    const eurIssued = await ws.transact((tx, ctx, repo) =>
      issueDocument(tx, ctx, repo, eur.id, "2026-04-02"),
    );
    await expect(
      ws.create("payment", {
        document_id: eurIssued.id,
        date: "2026-05-10",
        amount: 1000,
        foreign_amount: 1000,
        method: "bank",
      }),
    ).rejects.toThrow(/riguardano solo i documenti in valuta/);
  });

  it("a purchase in a foreign currency: paying more euro than booked is a loss", async () => {
    const { draft, issue, supplier, balances, ws } = await setup();
    const doc = await draft({
      type: "purchase_invoice",
      number: "F-77",
      party_id: supplier.id,
      currency: "USD",
      exchange_rate: 1.1,
    });
    const issued = await issue(doc.id);
    let tb = await balances();
    expect(tb["500"]).toBe(90909);
    expect(tb["200"]).toBe(-110909);
    await ws.create("payment", {
      document_id: issued.id,
      date: "2026-05-10",
      foreign_amount: 122000,
      received: 113000, // paid 1.130,00 € for a debt booked at 1.109,09 €
      method: "bank",
    });
    tb = await balances();
    expect(tb["200"] ?? 0).toBe(0);
    expect(tb["120"]).toBe(-113000);
    expect(tb["540"]).toBe(113000 - 110909);
  });

  it("prints the document in its currency with the euro value", async () => {
    const { draft, issue, customer, ws } = await setup();
    const doc = await draft({
      type: "invoice",
      party_id: customer.id,
      currency: "USD",
      exchange_rate: 1.1,
    });
    await issue(doc.id);
    const { content } = await buildDocumentPdf(ws, doc.id);
    const hex = (text: string) =>
      [...text].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join("");
    expect(content).toContain(hex("1.220,00 USD"));
    expect(content).toContain(hex("Controvalore in euro (cambio 1,1)"));
    if (process.env["VYRION_PDF_OUT"])
      writeFileSync(`${process.env["VYRION_PDF_OUT"]}.usd.pdf`, content);
  });
});
