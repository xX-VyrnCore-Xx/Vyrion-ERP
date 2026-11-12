import { describe, expect, it } from "vitest";

import { testWorkspace } from "../../test/workspace";
import { buildCatalog } from "../catalog";
import { analyze, search, searchCatalog } from "../engine";
import { bestMatch, editDistance, matchWord, normalize, stem, words } from "../text";
import { conceptsOf, synonymsOf } from "../thesaurus";

describe("text", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normalize("Città, Perché!")).toBe("citta perche");
    expect(words("P.IVA 01234567897 / Rossi-Bianchi")).toEqual([
      "p.iva",
      "01234567897",
      "rossi-bianchi",
    ]);
  });

  it("treats singular, plural and gender as the same word", () => {
    expect(stem("fatture")).toBe(stem("fattura"));
    expect(stem("clienti")).toBe(stem("cliente"));
    expect(stem("invoices")).toBe(stem("invoice"));
    expect(stem("installazione")).toBe(stem("installazioni"));
    expect(stem("it")).toBe("it");
  });

  it("counts a swapped pair of letters as one typo", () => {
    expect(editDistance("acme", "acem")).toBe(1);
    expect(editDistance("fattura", "fatura")).toBe(1);
    expect(editDistance("rete", "server")).toBeGreaterThan(2);
  });

  it("grades how a word is found", () => {
    expect(matchWord("fattura", "fattura")).toBe("exact");
    expect(matchWord("fatture", "fattura")).toBe("stem");
    expect(matchWord("fat", "fattura")).toBe("prefix");
    expect(matchWord("fatura", "fattura")).toBe("fuzzy");
    expect(matchWord("zzz", "fattura")).toBe("none");
    expect(bestMatch("rossi", ["mario", "rossi"]).kind).toBe("exact");
  });
});

describe("vocabulary", () => {
  it("knows words that mean the same", () => {
    expect(conceptsOf("committente")).toContain("cliente");
    expect(conceptsOf("incassi")).toContain("pagamento");
    expect(conceptsOf("nota di credito")).toContain("storno");
    expect(synonymsOf("cliente")).toContain("customer");
  });

  it("recognises which kind of record a query names", () => {
    const a = analyze("fatture acme");
    expect(a.typeEntities.has("document")).toBe(true);
    expect(a.content.map((t) => t.norm)).toEqual(["acme"]);
    expect(analyze("nuovo cliente").tokens.some((t) => t.isVerb)).toBe(true);
  });
});

describe("pages and actions", () => {
  it("finds the page for what the person means, not only for its name", async () => {
    const ws = await testWorkspace();
    const items = buildCatalog(ws.registry);
    const top = (q: string) => searchCatalog(items, analyze(q)).map((r) => r.to);
    expect(top("nuovo cliente")[0]).toBe("e/party/new");
    expect(top("emetti fattura")[0]).toBe("d/invoice/new");
    expect(top("fatture scadute")).toContain("deadlines");
    expect(top("incassi")).toContain("deadlines");
    expect(top("tema scuro")).toContain("settings/app");
    expect(top("backup")).toContain("e/backup_job");
    expect(top("vpn")).toContain("e/vpn_peer");
    expect(top("partita iva")).toContain("settings/profile");
  });

  it("survives typos", async () => {
    const ws = await testWorkspace();
    const items = buildCatalog(ws.registry);
    const top = (q: string) => searchCatalog(items, analyze(q)).map((r) => r.to);
    expect(top("fatura")).toContain("documents?type=invoice");
    expect(top("clinte")).toContain("e/party");
    expect(top("nuovo clinte")).toContain("e/party/new");
    expect(top("anagrafice")).toContain("e/party");
  });

  it("prefers actions only when asked to create something", async () => {
    const ws = await testWorkspace();
    const items = buildCatalog(ws.registry);
    const first = (q: string) => searchCatalog(items, analyze(q))[0]?.kind;
    expect(first("crea preventivo")).toBe("action");
    expect(first("anagrafiche")).toBe("page");
  });
});

describe("records", () => {
  it("finds records by their words, with typos and without accents", async () => {
    const ws = await testWorkspace();
    await ws.create("party", { name: "Acme S.r.l.", kind: "customer", city: "Città di Castello" });
    await ws.create("party", { name: "Zeta Forniture", kind: "supplier" });
    const found = async (q: string) =>
      (await search(ws.db, ws.registry, q)).results
        .filter((r) => r.kind === "record")
        .map((r) => r.title);
    expect(await found("acme")).toContain("Acme S.r.l.");
    expect(await found("acem")).toContain("Acme S.r.l.");
    expect(await found("ACME srl")).toContain("Acme S.r.l.");
    expect(await found("citta castello")).toContain("Acme S.r.l.");
    expect(await found("zeta")).toEqual(expect.arrayContaining(["Zeta Forniture"]));
    expect(await found("inesistente")).toEqual([]);
  });

  it("ranks an exact name above a loose match", async () => {
    const ws = await testWorkspace();
    await ws.create("party", { name: "Rossi Costruzioni", kind: "customer" });
    await ws.create("party", { name: "Rossini Impianti", kind: "customer" });
    const r = (await search(ws.db, ws.registry, "rossi")).results.filter(
      (x) => x.kind === "record",
    );
    expect(r[0]?.title).toBe("Rossi Costruzioni");
  });

  it("shows what is linked to a record that was found", async () => {
    const ws = await testWorkspace();
    const party = await ws.create("party", { name: "Acme S.r.l.", kind: "customer" });
    await ws.create("contact", { first_name: "Mario", last_name: "Bianchi", party_id: party.id });
    const res = await search(ws.db, ws.registry, "acme");
    const related = res.results.filter((r) => r.kind === "related");
    expect(related.map((r) => r.title).join(" ")).toContain("Bianchi");
    expect(related[0]?.subtitle).toContain("Acme");
  });

  it("lists the latest records when the query only names a kind", async () => {
    const ws = await testWorkspace();
    await ws.create("party", { name: "Acme S.r.l.", kind: "customer" });
    const res = await search(ws.db, ws.registry, "anagrafiche");
    expect(res.results.some((r) => r.kind === "record" && r.title.includes("Acme"))).toBe(true);
    expect(res.results.some((r) => r.kind === "page" && r.to === "e/party")).toBe(true);
  });

  it("says which other words it looked for, and suggests a spelling when nothing is found", async () => {
    const ws = await testWorkspace();
    const res = await search(ws.db, ws.registry, "cliente");
    expect(res.alsoLooked.length).toBeGreaterThan(0);
    const none = await search(ws.db, ws.registry, "xqzv");
    expect(none.results).toEqual([]);
    const typo = await search(ws.db, ws.registry, "licensse");
    expect(typo.results.length + (typo.suggestion ? 1 : 0)).toBeGreaterThan(0);
  });

  it("ignores very short or empty queries", async () => {
    const ws = await testWorkspace();
    expect((await search(ws.db, ws.registry, "")).results).toEqual([]);
    expect((await search(ws.db, ws.registry, "il di la")).results).toEqual([]);
  });
});
