// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ValidationError } from "../../data/errors";
import { testWorkspace } from "../../test/workspace";
import { writeFileSync } from "node:fs";

import { buildDocumentPdf } from "../documentPdf";
import { computeTotals } from "../documents";
import { issueDocument, saveDocument } from "../operations";
import { aging, trialBalance, vatSummary, withholdingSummary } from "../reports";

const clock = () => new Date("2026-06-15T10:00:00Z");
const line = { description: "Consulenza", quantity: 1, unit_price: 100000, vat_rate: 22 };
const plain = { quantity: 1, unit_price: 100000, vat_rate: 22 };

describe("cassa, withholding and split payment: the arithmetic", () => {
  it("adds the cassa to the base of the VAT and withholds on fees plus cassa", () => {
    const t = computeTotals([plain], "ordinario", {
      cassaRate: 4,
      withholding: { rate: 20, basePct: 100, onCassa: true },
    });
    expect(t).toMatchObject({
      net: 100000,
      cassa: 4000,
      vat: 22880, // 22% of 1.040,00
      total: 126880,
      withholding: 20800, // 20% of 1.040,00
      payable: 106080,
    });
    expect(t.breakdown[0]).toMatchObject({ rate: 22, base: 104000, vat: 22880 });
  });

  it("can leave the cassa out of the withholding and use a partial base", () => {
    expect(
      computeTotals([plain], "ordinario", {
        cassaRate: 4,
        withholding: { rate: 20, basePct: 100, onCassa: false },
      }).withholding,
    ).toBe(20000);
    expect(
      computeTotals([plain], "ordinario", { withholding: { rate: 20, basePct: 50, onCassa: true } })
        .withholding,
    ).toBe(10000);
  });

  it("follows the VAT of each line for the cassa and keeps the VAT out of split payment", () => {
    const t = computeTotals(
      [plain, { quantity: 1, unit_price: 50000, vat_rate: 0, vat_nature: "N4" }],
      "ordinario",
      { cassaRate: 4 },
    );
    expect(t.cassa).toBe(4000 + 2000);
    expect(t.vat).toBe(22880); // only the taxed line carries VAT, on its own base plus its cassa
    const split = computeTotals([plain], "ordinario", { split: true });
    expect(split).toMatchObject({ vat: 22000, splitVat: 22000, total: 122000, payable: 100000 });
  });

  it("leaves documents without any of them exactly as before", () => {
    const t = computeTotals([plain], "ordinario");
    expect(t).toMatchObject({
      cassa: 0,
      withholding: 0,
      splitVat: 0,
      total: 122000,
      payable: 122000,
    });
  });
});

describe("issuing documents with them", () => {
  async function setup() {
    const ws = await testWorkspace("ordinario", clock);
    const customer = await ws.create("party", { name: "Studio Rossi", kind: "customer" });
    return { ws, customer };
  }
  const draft = (ws: Awaited<ReturnType<typeof setup>>["ws"], header: Record<string, unknown>) =>
    ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, { header: { date: "2026-04-01", ...header }, lines: [line] }),
    );
  const issue = (ws: Awaited<ReturnType<typeof setup>>["ws"], id: string) =>
    ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, id, "2026-04-01"));

  it("books a professional invoice with withholding and cassa, and is paid net of it", async () => {
    const { ws, customer } = await setup();
    const doc = await draft(ws, {
      type: "invoice",
      party_id: customer.id,
      cassa_rate: 4,
      withholding_rate: 20,
    });
    expect(doc).toMatchObject({
      total: 126880,
      payable: 106080,
      withholding_amount: 20800,
      cassa_amount: 4000,
    });
    const issued = await issue(ws, doc.id);

    const tb = Object.fromEntries(
      (await trialBalance(ws.db, "2026-01-01", "2026-12-31")).map((r) => [r.code, r.balance]),
    );
    expect(tb["110"]).toBe(106080); // customers owe the net amount
    expect(tb["135"]).toBe(20800); // withholding suffered, a tax credit
    expect(tb["400"]).toBe(-104000); // revenue includes the cassa
    expect(tb["220"]).toBe(-22880);

    const [open] = await aging(ws.db, "2026-05-30", "receivable");
    expect(open?.outstanding).toBe(106080);
    await expect(
      ws.create("payment", {
        document_id: issued.id,
        date: "2026-04-20",
        amount: 126880,
        method: "bank",
      }),
    ).rejects.toThrow(/supera il residuo/);
    await ws.create("payment", {
      document_id: issued.id,
      date: "2026-04-20",
      amount: 106080,
      method: "bank",
    });
    expect(await aging(ws.db, "2026-05-30", "receivable")).toEqual([]);

    const summary = await withholdingSummary(ws.db, "2026-04-01", "2026-04-30");
    expect(summary).toMatchObject({ suffered: 20800, operated: 0 });
    expect(summary.rows[0]).toMatchObject({
      kind: "suffered",
      rate: 20,
      base: 104000,
      party: "Studio Rossi",
    });
    // the VAT base includes the cassa
    expect((await vatSummary(ws.db, "2026-04-01", "2026-04-30")).rows[0]).toMatchObject({
      base: 104000,
      vat: 22880,
    });
  });

  it("prints cassa, withholding and the net amount on the PDF", async () => {
    const { ws, customer } = await setup();
    const doc = await draft(ws, {
      type: "invoice",
      party_id: customer.id,
      cassa_rate: 4,
      withholding_rate: 20,
    });
    await issue(ws, doc.id);
    const { content } = await buildDocumentPdf(ws, doc.id);
    // text is hex-encoded in the file: look for the words by their WinAnsi bytes
    const hex = (text: string) =>
      [...text].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join("");
    expect(content).toContain(hex("Cassa previdenziale 4%"));
    expect(content).toContain(hex("TOTALE DOCUMENTO"));
    expect(content).toContain(hex("NETTO DA INCASSARE"));
    expect(content).toContain(hex("Operazione soggetta a ritenuta d'acconto."));
    if (process.env["VYRION_PDF_OUT"])
      writeFileSync(`${process.env["VYRION_PDF_OUT"]}.fiscal.pdf`, content);
  });

  it("books a split-payment invoice without VAT and lists the VAT apart", async () => {
    const { ws, customer } = await setup();
    const doc = await draft(ws, { type: "invoice", party_id: customer.id, split_payment: true });
    expect(doc).toMatchObject({ total: 122000, payable: 100000 });
    await issue(ws, doc.id);
    const tb = Object.fromEntries(
      (await trialBalance(ws.db, "2026-01-01", "2026-12-31")).map((r) => [r.code, r.balance]),
    );
    expect(tb["110"]).toBe(100000);
    expect(tb["400"]).toBe(-100000);
    expect(tb["220"] ?? 0).toBe(0); // no VAT owed by the seller
    const vat = await vatSummary(ws.db, "2026-04-01", "2026-04-30");
    expect(vat).toMatchObject({ salesVat: 0, splitVat: 22000, balance: 0 });
    expect(vat.rows[0]).toMatchObject({ split: true, vat: 22000 });
  });

  it("books a purchase with withholding operated by us", async () => {
    const { ws } = await setup();
    const supplier = await ws.create("party", { name: "Avv. Bianchi", kind: "supplier" });
    const doc = await draft(ws, {
      type: "purchase_invoice",
      number: "P-1",
      party_id: supplier.id,
      withholding_rate: 20,
    });
    expect(doc).toMatchObject({ total: 122000, withholding_amount: 20000, payable: 102000 });
    await issue(ws, doc.id);
    const tb = Object.fromEntries(
      (await trialBalance(ws.db, "2026-01-01", "2026-12-31")).map((r) => [r.code, r.balance]),
    );
    expect(tb["500"]).toBe(100000);
    expect(tb["130"]).toBe(22000);
    expect(tb["200"]).toBe(-102000);
    expect(tb["230"]).toBe(-20000); // to pay to the tax authority
    expect(await withholdingSummary(ws.db, "2026-04-01", "2026-04-30")).toMatchObject({
      suffered: 0,
      operated: 20000,
    });
  });

  it("refuses combinations the law does not allow", async () => {
    const { ws, customer } = await setup();
    await expect(
      draft(ws, {
        type: "invoice",
        party_id: customer.id,
        split_payment: true,
        withholding_rate: 20,
      }),
    ).rejects.toThrow(/ritenuta/);
    const flat = await testWorkspace("forfettario", clock);
    const c = await flat.create("party", { name: "Cliente", kind: "customer" });
    await expect(
      flat.transact((tx, ctx, repo) =>
        saveDocument(tx, ctx, repo, {
          header: { type: "invoice", date: "2026-04-01", party_id: c.id, withholding_rate: 20 },
          lines: [line],
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      flat.transact((tx, ctx, repo) =>
        saveDocument(tx, ctx, repo, {
          header: { type: "invoice", date: "2026-04-01", party_id: c.id, split_payment: true },
          lines: [line],
        }),
      ),
    ).rejects.toThrow(/scissione/);
  });
});
