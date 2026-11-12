// @vitest-environment node
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { crc32, zipStore } from "../../lib/zip";
import { testWorkspace } from "../../test/workspace";
import { accountantFiles, accountantPackage } from "../accountantExport";
import { issueDocument, saveDocument } from "../operations";
import { generatePayslip, registerPayslip } from "../payroll";

const clock = () => new Date("2026-06-15T10:00:00Z");

/** Reads a ZIP back (stored entries only), checking every CRC: what an unzip tool would do. */
function readZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, string>();
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, new TextDecoder("utf-8", { ignoreBOM: true }).decode(data));
    at += 46 + nameLen;
  }
  return out;
}

describe("ZIP writer", () => {
  it("has the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("round-trips files, including UTF-8 names and an empty file", () => {
    const zip = zipStore([
      { name: "a.txt", data: "ciao" },
      { name: "è/perché.csv", data: "x;y\r\n1;2" },
      { name: "vuoto.txt", data: "" },
    ]);
    const files = readZip(zip);
    expect([...files.keys()]).toEqual(["a.txt", "è/perché.csv", "vuoto.txt"]);
    expect(files.get("è/perché.csv")).toBe("x;y\r\n1;2");
    expect(files.get("vuoto.txt")).toBe("");
  });
});

async function setup() {
  const ws = await testWorkspace("ordinario", clock);
  const customer = await ws.create("party", {
    name: "Rossi Srl",
    kind: "customer",
    vat_number: "01234567897",
  });
  const supplier = await ws.create("party", { name: "=SUM(A1) Forniture", kind: "supplier" });
  const sale = await ws.transact((tx, ctx, repo) =>
    saveDocument(tx, ctx, repo, {
      header: { type: "invoice", date: "2026-04-01", party_id: customer.id },
      lines: [{ description: "Consulenza", quantity: 1, unit_price: 100000, vat_rate: 22 }],
    }),
  );
  await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, sale.id, "2026-04-01"));
  const purchase = await ws.transact((tx, ctx, repo) =>
    saveDocument(tx, ctx, repo, {
      header: {
        type: "purchase_invoice",
        number: "F-9",
        date: "2026-04-05",
        party_id: supplier.id,
      },
      lines: [{ description: "Acquisto", quantity: 1, unit_price: 40000, vat_rate: 22 }],
    }),
  );
  await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, purchase.id, "2026-04-05"));
  const mario = await ws.create("employee", {
    first_name: "Mario",
    last_name: "Bianchi",
    hire_date: "2025-01-01",
    gross_monthly: 200000,
    contrib_employee_pct: 10,
    tax_pct: 20,
  });
  const slip = await generatePayslip(ws, mario.id, "2026-05");
  await registerPayslip(ws, slip.id);
  return { ws };
}

const dataLines = (csv: string) =>
  csv
    .replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), "")
    .trim()
    .split("\r\n")
    .slice(1);

describe("the accountant's package", () => {
  it("lists the books and registers of the year, and the journal balances", async () => {
    const { ws } = await setup();
    const files = await accountantFiles(ws.db, 2026, "2026-12-31");
    const names = files.map((f) => f.name);
    expect(names).toEqual([
      "LEGGIMI.txt",
      "piano-dei-conti.csv",
      "prima-nota_2026.csv",
      "bilancio-di-verifica_2026.csv",
      "registro-vendite_2026.csv",
      "registro-acquisti_2026.csv",
      "liquidazioni-iva_2026.csv",
      "ritenute_2026.csv",
      "crediti-aperti_al-31-12-2026.csv",
      "debiti-aperti_al-31-12-2026.csv",
      "buste-paga_2026.csv",
    ]);
    const get = (name: string) => files.find((f) => f.name === name)?.content ?? "";

    // journal: total debit equals total credit (amounts use the decimal comma)
    const journal = dataLines(get("prima-nota_2026.csv")).map((l) => l.split(";"));
    const num = (s: string | undefined) => Number((s ?? "0").replace(",", "."));
    const debit = journal.reduce((sum, c) => sum + num(c[6]), 0);
    const credit = journal.reduce((sum, c) => sum + num(c[7]), 0);
    expect(journal.length).toBeGreaterThanOrEqual(8);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));

    // registers
    expect(dataLines(get("registro-vendite_2026.csv"))).toHaveLength(1);
    expect(get("registro-vendite_2026.csv")).toContain("01234567897");
    expect(get("registro-vendite_2026.csv")).toContain("1000;220");
    expect(get("registro-acquisti_2026.csv")).toContain("400;88");
    // a spreadsheet formula in a name is neutralised
    expect(get("registro-acquisti_2026.csv")).toContain("'=SUM(A1) Forniture");
    // open items and payroll
    expect(get("crediti-aperti_al-31-12-2026.csv")).toContain("1220");
    expect(get("debiti-aperti_al-31-12-2026.csv")).toContain("488");
    expect(get("buste-paga_2026.csv")).toContain("Bianchi Mario");
    // the README names every file and the caveat
    const readme = get("LEGGIMI.txt");
    for (const n of names.slice(1)) expect(readme).toContain(n);
    expect(readme).toContain("commercialista");
  });

  it("only includes the requested year", async () => {
    const { ws } = await setup();
    const files = await accountantFiles(ws.db, 2025, "2026-01-05");
    const sales = files.find((f) => f.name === "registro-vendite_2025.csv");
    expect(sales?.rows).toBe(0);
    expect(files.find((f) => f.name === "prima-nota_2025.csv")?.rows).toBe(0);
  });

  it("zips them into one archive that reads back identically", async () => {
    const { ws } = await setup();
    const pkg = await accountantPackage(ws.db, 2026, "2026-12-31", new Date(2026, 11, 31, 10, 0));
    expect(pkg.fileName).toBe("commercialista_2026.zip");
    const read = readZip(pkg.bytes);
    expect(read.size).toBe(pkg.files.length);
    for (const f of pkg.files) expect(read.get(f.name)).toBe(f.content);
    if (process.env["VYRION_ZIP_OUT"]) writeFileSync(process.env["VYRION_ZIP_OUT"], pkg.bytes);
  });
});
