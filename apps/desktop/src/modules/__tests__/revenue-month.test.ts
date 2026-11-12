// @vitest-environment node
import { describe, expect, it } from "vitest";

import { testWorkspace } from "../../test/workspace";
import { revenueByMonth } from "../insights";
import { issueDocument, saveDocument } from "../operations";

describe("revenue by month", () => {
  it("lists the last twelve months, oldest first, with credit notes subtracted", async () => {
    const ws = await testWorkspace("ordinario", () => new Date("2026-11-12T10:00:00Z"));
    const customer = await ws.create("party", { name: "Rossi Srl", kind: "customer" });
    const issue = async (type: string, date: string, price: number) => {
      const doc = await ws.transact((tx, ctx, repo) =>
        saveDocument(tx, ctx, repo, {
          header: { type, date, party_id: customer.id },
          lines: [{ description: "x", quantity: 1, unit_price: price, vat_rate: 22 }],
        }),
      );
      await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, doc.id, date));
    };
    // numbering must follow the date order
    await issue("invoice", "2025-10-10", 99999); // outside the window
    await issue("invoice", "2025-12-15", 70000);
    await issue("invoice", "2026-11-03", 100000);
    await issue("invoice", "2026-11-20", 50000);
    await issue("credit_note", "2026-11-25", 20000);

    const months = await revenueByMonth(ws.db, "2026-11-12");
    expect(months).toHaveLength(12);
    expect(months[0]?.month).toBe("2025-12");
    expect(months.at(-1)).toEqual({ month: "2026-11", amount: 130000 });
    expect(months[0]?.amount).toBe(70000);
    expect(months.filter((m) => m.amount === 0)).toHaveLength(10);
  });
});
