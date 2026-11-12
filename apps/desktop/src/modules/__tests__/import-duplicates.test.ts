// @vitest-environment node
import { describe, expect, it } from "vitest";

import { testWorkspace } from "../../test/workspace";
import { parseCsv } from "../csv";
import { findDuplicateParties, mergeBlockers, mergeParties } from "../duplicates";
import { coerceCell, planImport, runImport, suggestMapping } from "../importer";
import { issueDocument, saveDocument } from "../operations";

describe("CSV reading", () => {
  it("handles Italian spreadsheets: semicolons, quotes, BOM, CRLF, blank lines", () => {
    const text = '﻿Nome;Note\r\n"Rossi; Mario";"ha ""virgolette"""\r\n\r\nBianchi;ok\r\n';
    expect(parseCsv(text)).toEqual([
      ["Nome", "Note"],
      ["Rossi; Mario", 'ha "virgolette"'],
      ["Bianchi", "ok"],
    ]);
  });
  it("detects commas and tabs and keeps newlines inside quotes", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv('a;b\n"riga 1\nriga 2";x')[1]).toEqual(["riga 1\nriga 2", "x"]);
  });
});

describe("import", () => {
  it("maps columns by label, converts values and reports every bad row", async () => {
    const ws = await testWorkspace();
    const def = ws.registry.get("party");
    const rows = parseCsv(
      [
        "Ragione sociale / Nome;Tipo;Email;Telefono;Pagamento (giorni)",
        "Acme Srl;Cliente;info@acme.it;+39 02 123456;60",
        ";Cliente;senzanome@x.it;;30",
        "Beta Spa;Pianeta;beta@x.it;;30",
        "Gamma;Fornitore;non-una-mail;;30",
      ].join("\n"),
    );
    const header = rows.shift() as string[];
    const mapping = suggestMapping(header, def.fields);
    expect(mapping).toEqual(["name", "kind", "email", "phone", "payment_terms_days"]);
    const plan = await planImport(ws, def, rows, mapping, { skipDuplicates: false });
    expect(plan.map((r) => r.status)).toEqual(["ok", "invalid", "invalid", "invalid"]);
    expect(plan[0]?.record).toMatchObject({ kind: "customer", payment_terms_days: 60 });
    expect(plan[1]?.errors.join()).toMatch(/Ragione sociale/);
    expect(plan[2]?.errors.join()).toMatch(/Tipo.*Pianeta/);

    const outcome = await runImport(ws, def, plan);
    expect(outcome.created).toBe(1);
    const stored = await ws.list("party", {});
    expect(stored.rows.map((r) => r["name"])).toEqual(["Acme Srl"]);
  });

  it("converts amounts, dates and booleans the Italian way", () => {
    const money = { name: "p", label: "Prezzo", type: "money" } as const;
    expect(coerceCell(money, "1.234,50")).toEqual({ value: 123450 });
    expect(coerceCell(money, "abc")).toHaveProperty("error");
    expect(coerceCell({ name: "d", label: "Data", type: "date" }, "05/03/2026")).toEqual({
      value: "2026-03-05",
    });
    expect(coerceCell({ name: "d", label: "Data", type: "date" }, "31/02/2026")).toHaveProperty(
      "error",
    );
    expect(coerceCell({ name: "b", label: "Attivo", type: "boolean" }, "Sì")).toEqual({
      value: true,
    });
    expect(coerceCell({ name: "t", label: "T", type: "text" }, "  ")).toEqual({ value: null });
  });

  it("skips rows that repeat an existing or earlier VAT number or email", async () => {
    const ws = await testWorkspace();
    const def = ws.registry.get("party");
    await ws.create("party", { name: "Esistente", kind: "customer", email: "dup@example.com" });
    const rows = [
      ["Nuovo 1", "customer", "dup@example.com"],
      ["Nuovo 2", "customer", "uno@example.com"],
      ["Nuovo 3", "customer", "UNO@example.com"],
    ];
    const plan = await planImport(ws, def, rows, ["name", "kind", "email"], {
      skipDuplicates: true,
    });
    expect(plan.map((r) => r.status)).toEqual(["duplicate", "ok", "duplicate"]);
    expect((await runImport(ws, def, plan)).created).toBe(1);
  });
});

describe("duplicate parties", () => {
  it("groups by VAT number, email and name ignoring legal forms", async () => {
    const ws = await testWorkspace();
    const a = await ws.create("party", { name: "Acme S.r.l.", kind: "customer" });
    const b = await ws.create("party", { name: "ACME srl", kind: "customer" });
    const c = await ws.create("party", { name: "Zeta", kind: "customer", email: "z@x.it" });
    const d = await ws.create("party", { name: "Altro nome", kind: "customer", email: "Z@x.it" });
    await ws.create("party", { name: "Solo", kind: "customer" });
    const groups = await findDuplicateParties(ws);
    expect(groups).toHaveLength(2);
    const byIds = groups.map((g) => g.parties.map((p) => p.id).sort());
    expect(byIds).toContainEqual([a.id, b.id].sort());
    expect(byIds).toContainEqual([c.id, d.id].sort());
    expect(groups.find((g) => g.parties.some((p) => p.id === c.id))?.reasons).toContain(
      "stessa email",
    );
  });

  it("merges: moves linked records, fills gaps, keeps notes, deletes the duplicate", async () => {
    const ws = await testWorkspace();
    const keep = await ws.create("party", { name: "Acme", kind: "customer", notes: "Nota A" });
    const drop = await ws.create("party", {
      name: "Acme Srl",
      kind: "customer",
      email: "acme@example.com",
      phone: "+39 02 1",
      notes: "Nota B",
    });
    const contact = await ws.create("contact", { party_id: drop.id, last_name: "Rossi" });
    const result = await mergeParties(ws, keep.id, drop.id);
    expect(result.moved).toBe(1);
    expect(result.filled).toEqual(expect.arrayContaining(["Email", "Telefono", "Note"]));
    expect((await ws.get("contact", contact.id))?.["party_id"]).toBe(keep.id);
    const merged = await ws.get("party", keep.id);
    expect(merged?.["email"]).toBe("acme@example.com");
    expect(String(merged?.["notes"])).toContain("Nota A");
    expect(String(merged?.["notes"])).toContain("Nota B");
    expect(await ws.get("party", drop.id)).toBeNull();
  });

  it("refuses to merge a party that has issued invoices, and changes nothing", async () => {
    const ws = await testWorkspace("ordinario", () => new Date("2026-06-15T10:00:00Z"));
    const keep = await ws.create("party", { name: "Tenuta", kind: "customer" });
    const drop = await ws.create("party", { name: "Fatturata", kind: "customer" });
    await ws.create("contact", { party_id: drop.id, last_name: "Bianchi" });
    const invoice = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "invoice", date: "2026-04-01", party_id: drop.id },
        lines: [{ description: "x", quantity: 1, unit_price: 100000, vat_rate: 22 }],
      }),
    );
    await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, invoice.id, "2026-04-01"));
    expect(await mergeBlockers(ws, drop.id)).toEqual([
      { entity: "document", label: "documenti", count: 1 },
    ]);
    await expect(mergeParties(ws, keep.id, drop.id)).rejects.toThrow(/Non unibile/);
    expect(await ws.get("party", drop.id)).not.toBeNull();
    // the other direction works: the invoiced customer is the one kept
    await mergeParties(ws, drop.id, keep.id);
    expect(await ws.get("party", keep.id)).toBeNull();
  });
});
