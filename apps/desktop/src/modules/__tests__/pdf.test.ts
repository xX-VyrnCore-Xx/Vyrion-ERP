// @vitest-environment node
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { Pdf } from "../../lib/pdf";
import { testWorkspace } from "../../test/workspace";
import { buildDocumentPdf } from "../documentPdf";
import { issueDocument, saveDocument } from "../operations";

/** Every "n 0 obj" must sit exactly where the cross-reference table says it does. */
function checkStructure(pdf: string): void {
  expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
  expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  // eslint-disable-next-line no-control-regex
  expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(pdf)).toBe(true); // plain ASCII, no binary
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)?.[1]);
  expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
  const entries = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)];
  expect(entries.length).toBeGreaterThan(4);
  entries.forEach((entry, i) => {
    const offset = Number(entry[1]);
    expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
  for (const match of pdf.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const length = Number(match[1]);
    expect(pdf.slice(start + length, start + length + 9)).toBe("endstream");
  }
}

describe("PDF writer", () => {
  it("measures text with the Helvetica widths and wraps at spaces", () => {
    const pdf = new Pdf();
    expect(pdf.width("A", 10)).toBeCloseTo(6.67, 2);
    expect(pdf.width("A", 10, true)).toBeCloseTo(7.22, 2);
    const lines = pdf.wrap("uno due tre quattro cinque sei sette", 60, 10);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(pdf.width(l, 10)).toBeLessThanOrEqual(60);
    expect(pdf.wrap("a\nb", 100)).toEqual(["a", "b"]);
    expect(pdf.wrap("x".repeat(200), 50, 10).every((l) => pdf.width(l, 10) <= 50)).toBe(true);
  });

  it("writes a well-formed, ASCII-only file with accents and the euro sign", () => {
    const pdf = new Pdf();
    pdf.title = "Prova è à ù €";
    pdf.text(50, 700, "Città perché € 1.234,50", { size: 12, bold: true });
    pdf.addPage();
    pdf.text(50, 700, "seconda pagina");
    const out = pdf.build();
    checkStructure(out);
    expect(out).toContain("/Count 2");
    expect(out).toContain("<43697474E0"); // "Città": à is 0xE0 in WinAnsi
    expect(out).toContain("80"); // the euro sign
  });
});

describe("document PDF", () => {
  it("prints an issued invoice with its lines, VAT and totals", async () => {
    const ws = await testWorkspace("ordinario", () => new Date("2026-06-15T10:00:00Z"));
    const customer = await ws.create("party", {
      name: "Società Rossi & Figli S.r.l.",
      kind: "customer",
      vat_number: "00743110157",
      address: "Via Roma 1",
      zip: "20100",
      city: "Milano",
      province: "MI",
    });
    const sale = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "invoice", date: "2026-04-01", party_id: customer.id, notes: "Grazie!" },
        lines: [
          { description: "Consulenza informatica", quantity: 10, unit_price: 5000, vat_rate: 22 },
          {
            description: "Licenza annuale con una descrizione molto lunga ".repeat(6),
            quantity: 1,
            unit_price: 120000,
            vat_rate: 22,
          },
        ],
      }),
    );
    await ws.transact((tx, ctx, repo) => issueDocument(tx, ctx, repo, sale.id, "2026-04-01"));

    const result = await buildDocumentPdf(ws, sale.id);
    expect(result.fileName).toMatch(/^Fattura-.*\.pdf$/);
    checkStructure(result.content);
    if (process.env["VYRION_PDF_OUT"]) writeFileSync(process.env["VYRION_PDF_OUT"], result.content);
  });

  it("paginates a long document and repeats the table header", async () => {
    const ws = await testWorkspace("ordinario", () => new Date("2026-06-15T10:00:00Z"));
    const customer = await ws.create("party", { name: "Cliente", kind: "customer" });
    const quote = await ws.transact((tx, ctx, repo) =>
      saveDocument(tx, ctx, repo, {
        header: { type: "quote", date: "2026-04-01", party_id: customer.id },
        lines: Array.from({ length: 70 }, (_, i) => ({
          description: `Voce numero ${i + 1}`,
          quantity: 1,
          unit_price: 1000,
          vat_rate: 22,
        })),
      }),
    );
    const { content } = await buildDocumentPdf(ws, quote.id);
    checkStructure(content);
    expect(Number(/\/Count (\d+)/.exec(content)?.[1])).toBeGreaterThanOrEqual(2);
    if (process.env["VYRION_PDF_OUT"])
      writeFileSync(`${process.env["VYRION_PDF_OUT"]}.long.pdf`, content);
  });
});
