// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ConflictError, LockedError, ValidationError } from "../../data/errors";
import { testWorkspace } from "../../test/workspace";
import { isValidCodiceFiscale, isValidIban, isValidPartitaIva } from "../../lib/fiscal";
import { computeTotals } from "../documents";
import { convertDocument, issueDocument, saveDocument } from "../operations";

const line = (over: Partial<Parameters<typeof computeTotals>[0][number]> = {}) => ({
  quantity: 1,
  unit_price: 10000,
  discount: 0,
  vat_rate: 22,
  vat_nature: null,
  ...over,
});

describe("fiscal identifiers", () => {
  it("validates VAT numbers, tax codes and IBANs by checksum", () => {
    expect(isValidPartitaIva("01234567897")).toBe(true);
    expect(isValidPartitaIva("01234567890")).toBe(false);
    expect(isValidPartitaIva("123")).toBe(false);
    expect(isValidCodiceFiscale("RSSMRA85T10A562S")).toBe(true);
    expect(isValidCodiceFiscale("RSSMRA85T10A562X")).toBe(false);
    expect(isValidCodiceFiscale("01234567897")).toBe(true);
    expect(isValidIban("IT60X0542811101000000123456")).toBe(true);
    expect(isValidIban("IT60X0542811101000000123457")).toBe(false);
  });
});

describe("document totals", () => {
  it("computes VAT per rate on the base, not per line", () => {
    // 3 lines of 0.10 € at 22 %: per-line rounding would give 3 × 0.02 = 0.06; per base 0.07.
    const t = computeTotals(
      [line({ unit_price: 10 }), line({ unit_price: 10 }), line({ unit_price: 10 })],
      "ordinario",
    );
    expect(t.net).toBe(30);
    expect(t.vat).toBe(7);
    expect(t.total).toBe(37);
  });

  it("applies discounts and groups several rates", () => {
    const t = computeTotals(
      [
        line({ quantity: 2, unit_price: 5000, discount: 10 }),
        line({ unit_price: 10000, vat_rate: 10 }),
      ],
      "ordinario",
    );
    expect(t.net).toBe(9000 + 10000);
    expect(t.breakdown.map((b) => [b.rate, b.base, b.vat])).toEqual([
      [22, 9000, 1980],
      [10, 10000, 1000],
    ]);
    expect(t.total).toBe(19000 + 2980);
  });

  it("charges bollo only above 77.47 € of exempt base", () => {
    const exempt = (cents: number) =>
      computeTotals([line({ unit_price: cents, vat_rate: 0, vat_nature: "N4" })], "ordinario");
    expect(exempt(7747).stamp).toBe(0);
    expect(exempt(7748).stamp).toBe(200);
    expect(computeTotals([line({ unit_price: 50000 })], "ordinario").stamp).toBe(0);
  });

  it("has no VAT in the flat-rate regime and adds bollo above the threshold", () => {
    const t = computeTotals([line({ unit_price: 100000, vat_rate: 22 })], "forfettario");
    expect(t.vat).toBe(0);
    expect(t.stamp).toBe(200);
    expect(t.total).toBe(100200);
    expect(t.breakdown[0]?.nature).toBe("N2.2");
    expect(computeTotals([line({ unit_price: 5000 })], "forfettario").stamp).toBe(0);
  });
});

async function setup(regime: "ordinario" | "forfettario" = "ordinario") {
  const ws = await testWorkspace(regime);
  const customer = await ws.create("party", {
    name: "Cliente SRL",
    kind: "customer",
    vat_number: "01234567897",
  });
  return { ws, customer };
}

async function draftInvoice(
  ws: Awaited<ReturnType<typeof testWorkspace>>,
  partyId: string,
  price = 10000,
  over = {},
) {
  return ws.transact((tx, ctx, repo) =>
    saveDocument(tx, ctx, repo, {
      header: { type: "invoice", date: ctx.today(), party_id: partyId, ...over },
      lines: [{ description: "Consulenza", quantity: 1, unit_price: price, vat_rate: 22 }],
    }),
  );
}

describe("issuing invoices", () => {
  it("assigns gapless numbers, freezes the invoice and posts a balanced entry", async () => {
    const { ws, customer } = await setup();
    const a = await draftInvoice(ws, customer.id);
    const b = await draftInvoice(ws, customer.id);
    const ia = await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, a.id));
    const ib = await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, b.id));
    const year = ws.ctx.today().slice(0, 4);
    expect(ia["number"]).toBe(`FT ${year}/0001`);
    expect(ib["number"]).toBe(`FT ${year}/0002`);
    expect(ia["total"]).toBe(12200);

    await expect(ws.update("document", a.id, { notes: "x" })).rejects.toBeInstanceOf(LockedError);
    await expect(ws.remove("document", a.id)).rejects.toBeInstanceOf(LockedError);
    await expect(
      ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, a.id)),
    ).rejects.toBeInstanceOf(ConflictError);

    const [sum] = await ws.db.query<{ d: number; c: number }>(
      "SELECT SUM(debit) AS d, SUM(credit) AS c FROM journal_lines",
    );
    expect(sum?.d).toBe(24400);
    expect(sum?.c).toBe(24400);
  });

  it("rolls the number back when issuing fails, leaving no gap", async () => {
    const { ws, customer } = await setup();
    const a = await draftInvoice(ws, customer.id);
    await ws.db.execute("DELETE FROM accounts WHERE code = '220'");
    await expect(
      ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, a.id)),
    ).rejects.toThrow(/conto 220/i);
    const seq = await ws.db.query("SELECT * FROM number_sequences WHERE key LIKE 'invoice:%'");
    expect(seq[0]?.["last"] ?? 0).toBe(0);
    expect((await ws.get("document", a.id))?.["status"]).toBe("draft");
  });

  it("refuses to number an invoice earlier than the previous one", async () => {
    const { ws, customer } = await setup();
    const a = await draftInvoice(ws, customer.id);
    const b = await draftInvoice(ws, customer.id);
    await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, a.id, "2026-03-10"));
    await expect(
      ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, b.id, "2026-03-09")),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("cannot be issued through a plain update", async () => {
    const { ws, customer } = await setup();
    const a = await draftInvoice(ws, customer.id);
    await expect(ws.update("document", a.id, { status: "issued" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("requires the nature of the operation for zero-VAT lines in the ordinary regime", async () => {
    const { ws, customer } = await setup();
    await expect(
      ws.transact((tx, ctx, repo) =>
        saveDocument(tx, ctx, repo, {
          header: { type: "invoice", date: ctx.today(), party_id: customer.id },
          lines: [{ description: "Esente", quantity: 1, unit_price: 1000, vat_rate: 0 }],
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("flat-rate invoices carry no VAT and post revenue, bollo and receivable", async () => {
    const { ws, customer } = await setup("forfettario");
    const d = await draftInvoice(ws, customer.id, 100000);
    const issued = await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, d.id));
    expect([issued["vat_total"], issued["stamp_duty"], issued["total"]]).toEqual([0, 200, 100200]);
    const rows = await ws.db.query<{ code: string; debit: number; credit: number }>(
      `SELECT a.code, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id ORDER BY a.code`,
    );
    expect(rows.map((r) => [r.code, r.debit, r.credit])).toEqual([
      ["110", 100200, 0],
      ["400", 0, 100000],
      ["410", 0, 200],
    ]);
  });
});

describe("payments", () => {
  it("track the residual, post to the ledger and can be removed with a reversal", async () => {
    const { ws, customer } = await setup();
    const d = await draftInvoice(ws, customer.id);
    const inv = await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, d.id));
    const p = await ws.create("payment", {
      document_id: inv.id,
      date: ws.ctx.today(),
      amount: 5000,
      method: "bank",
    });
    await expect(
      ws.create("payment", { document_id: inv.id, date: ws.ctx.today(), amount: 7201 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(ws.update("payment", p.id, { amount: 1 })).rejects.toBeInstanceOf(LockedError);
    await ws.create("payment", { document_id: inv.id, date: ws.ctx.today(), amount: 7200 });

    await ws.remove("payment", p.id);
    const [bank] = await ws.db.query<{ balance: number }>(
      `SELECT SUM(l.debit - l.credit) AS balance FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '120'`,
    );
    expect(bank?.balance).toBe(7200);
  });

  it("are refused on drafts", async () => {
    const { ws, customer } = await setup();
    const d = await draftInvoice(ws, customer.id);
    await expect(
      ws.create("payment", { document_id: d.id, date: ws.ctx.today(), amount: 100 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("journal", () => {
  it("cannot be written to directly and is immutable", async () => {
    const { ws } = await setup();
    await expect(
      ws.create("journal_entry", {
        number: "x",
        date: "2026-01-01",
        description: "x",
        source: "manual",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("quote → order → invoice", () => {
  it("copies lines and customer, and marks the source as invoiced", async () => {
    const { ws, customer } = await setup();
    const quote = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "quote", date: ws.ctx.today(), party_id: customer.id },
        lines: [{ description: "Sviluppo", quantity: 2, unit_price: 5000, vat_rate: 22 }],
      }),
    );
    expect(String(quote["number"])).toMatch(/^PR \d{4}\/0001$/);
    await expect(
      ws.transact((tx, ctx, repo) => convertDocument(tx, ctx, repo, quote.id, "invoice")),
    ).rejects.toBeInstanceOf(ConflictError);
    await ws.update("document", quote.id, { status: "accepted" });
    const invoice = await ws.transact((tx, ctx, repo) =>
      convertDocument(tx, ctx, repo, quote.id, "invoice"),
    );
    expect(invoice["total"]).toBe(12200);
    expect(invoice["source_id"]).toBe(quote.id);
    expect((await ws.get("document", quote.id))?.["status"]).toBe("invoiced");
    await expect(ws.update("document", quote.id, { notes: "x" })).rejects.toBeInstanceOf(
      LockedError,
    );
  });
});

describe("inventory", () => {
  it("moves stock on invoices and refuses to go negative", async () => {
    const { ws, customer } = await setup();
    const product = await ws.create("product", { sku: "P1", name: "Router", track_stock: true });
    await ws.create("stock_movement", {
      product_id: product.id,
      date: ws.ctx.today(),
      kind: "in",
      quantity: 5,
    });
    await expect(
      ws.create("stock_movement", {
        product_id: product.id,
        date: ws.ctx.today(),
        kind: "out",
        quantity: -6,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const draft = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "invoice", date: ctx.today(), party_id: customer.id },
        lines: [
          {
            product_id: product.id,
            description: "Router",
            quantity: 2,
            unit_price: 9000,
            vat_rate: 22,
          },
        ],
      }),
    );
    await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, draft.id));
    const [stock] = await ws.db.query<{ q: number }>(
      "SELECT SUM(quantity) AS q FROM stock_movements WHERE product_id = ?",
      [product.id],
    );
    expect(stock?.q).toBe(3);
    await expect(
      ws.remove("stock_movement", (await ws.list("stock_movement")).rows[0]!.id),
    ).rejects.toThrow();
  });
});

describe("crm rules", () => {
  it("numbers tickets per year and stamps closing dates", async () => {
    const { ws, customer } = await setup();
    const t1 = await ws.create("ticket", { party_id: customer.id, subject: "Stampante" });
    const t2 = await ws.create("ticket", { party_id: customer.id, subject: "Rete" });
    expect(String(t1["number"])).toMatch(/^T\d{4}-0001$/);
    expect(String(t2["number"])).toMatch(/^T\d{4}-0002$/);
    const closed = await ws.update("ticket", t1.id, { status: "closed" });
    expect(closed["closed_at"]).toBe(ws.ctx.today());
    expect((await ws.update("ticket", t1.id, { status: "open" }))["closed_at"]).toBeNull();
  });

  it("stamps the closing date of won opportunities", async () => {
    const { ws, customer } = await setup();
    const stages = (await ws.list("pipeline_stage", { orderBy: "position asc" })).rows;
    const won = stages.find((s) => s["kind"] === "won")!;
    const o = await ws.create("opportunity", {
      title: "Rinnovo",
      party_id: customer.id,
      stage_id: stages[0]!.id,
      amount: 100000,
    });
    expect(o["closed_at"]).toBeNull();
    expect((await ws.update("opportunity", o.id, { stage_id: won.id }))["closed_at"]).toBe(
      ws.ctx.today(),
    );
  });

  it("validates a contact belongs to the party of the communication", async () => {
    const { ws, customer } = await setup();
    const other = await ws.create("party", { name: "Altro" });
    const contact = await ws.create("contact", { party_id: other.id, last_name: "Rossi" });
    await expect(
      ws.create("communication", {
        party_id: customer.id,
        contact_id: contact.id,
        subject: "x",
        kind: "call",
        occurred_at: "2026-01-01T10:00:00Z",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an invalid VAT number on a party", async () => {
    const { ws } = await setup();
    await expect(
      ws.create("party", { name: "X", vat_number: "12345678901" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
