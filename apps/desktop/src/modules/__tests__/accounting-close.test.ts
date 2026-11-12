// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ConflictError } from "../../data/errors";
import { testWorkspace } from "../../test/workspace";
import {
  autoMatch,
  candidatesFor,
  importStatement,
  matchTransaction,
  readStatement,
  reconciliationSummary,
} from "../bank";
import {
  depreciationSchedule,
  pendingDepreciation,
  postDepreciation,
  termsOf,
} from "../depreciation";
import { issueDocument, saveDocument } from "../operations";
import { balanceSheet, closeYear, periodStatus, reopenYear, yearResult } from "../periods";
import { profitAndLoss, trialBalance } from "../reports";

const clock = () => new Date("2027-03-10T10:00:00Z");

async function company() {
  return testWorkspace("ordinario", clock);
}

async function sale(ws: Awaited<ReturnType<typeof company>>, date: string, price: number) {
  const customer = await ws.create("party", { name: `Cliente ${date}`, kind: "customer" });
  const doc = await ws.transact((tx, ctx, repo) =>
    saveDocument(tx, ctx, repo, {
      header: { type: "invoice", date, party_id: customer.id },
      lines: [{ description: "Servizio", quantity: 1, unit_price: price, vat_rate: 22 }],
    }),
  );
  const issued = await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, doc.id, date));
  return { customer, doc: issued };
}

describe("closing a financial year", () => {
  it("moves the result to equity, locks the year and keeps its profit and loss readable", async () => {
    const ws = await company();
    await sale(ws, "2026-05-10", 100000); // revenue 1 000,00
    const buy = await ws.create("party", { name: "Fornitore", kind: "supplier" });
    const purchase = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "purchase_invoice", number: "F-1", date: "2026-06-01", party_id: buy.id },
        lines: [{ description: "Acquisto", quantity: 1, unit_price: 30000, vat_rate: 22 }],
      }),
    );
    await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, purchase.id, "2026-06-01"));

    expect(await yearResult(ws.db, 2026)).toBe(70000);
    const record = await closeYear(ws, 2026);
    expect(record.result).toBe(70000);
    expect((await periodStatus(ws.db)).closedThrough).toBe("2026-12-31");

    // the reports of the closed year still show what happened
    const pl = await profitAndLoss(ws.db, "2026-01-01", "2026-12-31");
    expect(pl).toMatchObject({ revenue: 100000, expenses: 30000, result: 70000 });
    // income and cost accounts are zero once the closing entry is included
    const closed = await trialBalance(ws.db, "2026-01-01", "2026-12-31", { includeClosing: true });
    expect(
      closed
        .filter((r) => r.type === "revenue" || r.type === "expense")
        .every((r) => r.balance === 0),
    ).toBe(true);
    // the result sits in equity and the books balance
    const sheet = await balanceSheet(ws.db, "2026-12-31");
    expect(sheet.equity).toBe(70000);
    expect(sheet.openResult).toBe(0);
    expect(sheet.difference).toBe(0);

    // nothing can be dated inside the closed year any more
    await expect(sale(ws, "2026-11-05", 5000)).rejects.toThrow(/è chiuso/);
    // a later date is fine
    await sale(ws, "2027-02-01", 5000);
  });

  it("closes years in order, only once they ended, and reopens only the last", async () => {
    const ws = await company();
    await sale(ws, "2025-04-01", 20000);
    await sale(ws, "2026-04-01", 30000);
    await expect(closeYear(ws, 2026)).rejects.toThrow(/Chiudi prima l'esercizio 2025/);
    await expect(closeYear(ws, 2027)).rejects.toThrow(/non è ancora terminato/);
    await closeYear(ws, 2025);
    await expect(closeYear(ws, 2025)).rejects.toThrow(/già chiuso/);
    await closeYear(ws, 2026);
    await expect(reopenYear(ws, 2025)).rejects.toThrow(/ultimo esercizio chiuso \(2026\)/);

    await reopenYear(ws, 2026);
    expect((await periodStatus(ws.db)).closedThrough).toBe("2025-12-31");
    // after reopening 2026 can receive entries again and its figures are intact
    await sale(ws, "2026-12-20", 1000);
    expect(await yearResult(ws.db, 2026)).toBe(31000);
    const sheet = await balanceSheet(ws.db, "2026-12-31");
    expect(sheet.difference).toBe(0);
    expect(sheet.openResult).toBe(31000);
    // and it can be closed again
    expect((await closeYear(ws, 2026)).result).toBe(31000);
  });

  it("records a loss as a debit to the result account", async () => {
    const ws = await company();
    const buy = await ws.create("party", { name: "Fornitore", kind: "supplier" });
    const purchase = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "purchase_invoice", number: "F-9", date: "2026-03-01", party_id: buy.id },
        lines: [{ description: "Costo", quantity: 1, unit_price: 50000, vat_rate: 22 }],
      }),
    );
    await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, purchase.id, "2026-03-01"));
    const record = await closeYear(ws, 2026);
    expect(record.result).toBe(-50000);
    expect((await balanceSheet(ws.db, "2026-12-31")).equity).toBe(-50000);
  });
});

describe("depreciation", () => {
  const terms = {
    cost: 100000,
    rate: 20,
    residual: 0,
    purchaseDate: "2025-06-15",
    disposedOn: null,
  };

  it("takes half the rate in the first year and never more than what is left", () => {
    const rows = depreciationSchedule(terms, 2031);
    expect(rows.map((r) => [r.year, r.amount])).toEqual([
      [2025, 10000],
      [2026, 20000],
      [2027, 20000],
      [2028, 20000],
      [2029, 20000],
      [2030, 10000], // the remainder
    ]);
    expect(rows[rows.length - 1]).toMatchObject({ accumulated: 100000, bookValue: 0 });
    // a residual value is never depreciated
    expect(depreciationSchedule({ ...terms, residual: 20000 }, 2040).pop()?.accumulated).toBe(
      80000,
    );
    // stops from the year of disposal
    expect(
      depreciationSchedule({ ...terms, disposedOn: "2027-03-01" }, 2031).map((r) => r.year),
    ).toEqual([2025, 2026]);
  });

  it("capitalises the cost, posts each year once and respects a closed year", async () => {
    const ws = await company();
    const asset = await ws.create("fixed_asset", {
      name: "Portatile",
      category: "electronics",
      purchase_date: "2025-06-15",
      cost: 100000,
      rate: 20,
    });
    // the purchase cost moved from costs to fixed assets
    const tb = await trialBalance(ws.db, "2025-01-01", "2025-12-31");
    expect(tb.find((r) => r.code === "150")?.balance).toBe(100000);
    expect(tb.find((r) => r.code === "500")?.balance).toBe(-100000);

    expect((await pendingDepreciation(ws, 2025)).map((p) => [p.name, p.amount, p.posted])).toEqual([
      ["Portatile", 10000, false],
    ]);
    expect(await postDepreciation(ws, 2025)).toEqual([
      { assetId: asset.id, name: "Portatile", amount: 10000 },
    ]);
    expect(await postDepreciation(ws, 2025)).toEqual([]); // not twice
    expect((await pendingDepreciation(ws, 2025))[0]?.posted).toBe(true);
    const after = await trialBalance(ws.db, "2025-01-01", "2025-12-31");
    expect(after.find((r) => r.code === "530")?.balance).toBe(10000);
    expect(after.find((r) => r.code === "151")?.balance).toBe(-10000);

    await postDepreciation(ws, 2026);
    await closeYear(ws, 2025);
    await expect(postDepreciation(ws, 2025)).resolves.toEqual([]); // already posted: nothing to add
    // an asset bought inside a closed year cannot be capitalised
    await expect(
      ws.create("fixed_asset", {
        name: "Tardivo",
        category: "other",
        purchase_date: "2025-09-01",
        cost: 5000,
        rate: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(termsOf(asset).cost).toBe(100000);
  });

  it("refuses a residual value that is not below the cost", async () => {
    const ws = await company();
    await expect(
      ws.create("fixed_asset", {
        name: "X",
        category: "other",
        purchase_date: "2026-01-01",
        cost: 1000,
        rate: 10,
        residual: 1000,
      }),
    ).rejects.toThrow(/residuo/);
  });
});

describe("bank reconciliation", () => {
  const statement = [
    "Data;Descrizione;Importo",
    "12/04/2026;BONIFICO DA CLIENTE FT 2026/0001;1.220,00",
    "20/04/2026;Commissioni;-2,50",
    "20/04/2026;Commissioni;-2,50",
    "xx;rotta;1",
  ].join("\n");

  it("reads Italian statements, with Dare/Avere too, and reports bad rows", () => {
    const read = readStatement(statement);
    expect(read.lines).toEqual([
      { date: "2026-04-12", description: "BONIFICO DA CLIENTE FT 2026/0001", amount: 122000 },
      { date: "2026-04-20", description: "Commissioni", amount: -250 },
      { date: "2026-04-20", description: "Commissioni", amount: -250 },
    ]);
    expect(read.problems).toHaveLength(1);
    const split = readStatement(
      "Data;Causale;Dare;Avere\n01/02/2026;Pagamento;100,00;\n02/02/2026;Incasso;;50,00",
    );
    expect(split.lines.map((l) => l.amount)).toEqual([-10000, 5000]);
    expect(() => readStatement("a;b\n1;2")).toThrow(/colonne/);
  });

  it("imports once, suggests by amount/date/reference and matches in the right direction", async () => {
    const ws = await company();
    const { customer, doc } = await sale(ws, "2026-04-01", 100000); // 1 220,00 with VAT
    await ws.create("payment", {
      document_id: doc.id,
      date: "2026-04-12",
      amount: 122000,
      method: "bank",
    });

    const first = await importStatement(ws, readStatement(statement).lines);
    expect(first).toEqual({ created: 3, duplicates: 0 }); // two identical fee lines are both real
    expect(await importStatement(ws, readStatement(statement).lines)).toEqual({
      created: 0,
      duplicates: 3,
    });

    const rows = (await ws.list("bank_transaction", { limit: 10 })).rows;
    const incoming = rows.find((r) => Number(r["amount"]) === 122000);
    if (!incoming) throw new Error("missing line");
    const found = await candidatesFor(ws, incoming);
    expect(found).toHaveLength(1);
    expect(found[0]?.score).toBeGreaterThanOrEqual(0.85); // the document number is in the description
    expect(found[0]?.party).toBe(customer.name);

    // an outgoing line of the same amount must not match an incoming payment
    const outgoing = await ws.create("bank_transaction", {
      date: "2026-04-12",
      description: "Uscita",
      amount: -122000,
    });
    expect(await candidatesFor(ws, outgoing)).toEqual([]);

    expect((await reconciliationSummary(ws)).paymentsWithoutLine).toBe(1);
    expect(await autoMatch(ws)).toBe(1);
    expect((await ws.get("bank_transaction", incoming.id))?.["status"]).toBe("matched");
    expect((await reconciliationSummary(ws)).paymentsWithoutLine).toBe(0);
    // the same payment cannot be used twice
    const another = await ws.create("bank_transaction", {
      date: "2026-04-13",
      description: "Altro",
      amount: 122000,
    });
    await expect(
      matchTransaction(ws, another.id, found[0]?.paymentId ?? ""),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
