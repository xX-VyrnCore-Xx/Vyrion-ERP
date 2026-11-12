/**
 * A small PDF writer: A4 pages, the two standard Helvetica fonts, text, lines and filled
 * rectangles. No dependencies and no binary data: the file is plain ASCII (text is written as
 * hex strings in the WinAnsi encoding, which has the accented letters and the euro sign), so it
 * can be saved with the same text-saving command as a CSV.
 */

const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  761, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222,
  333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556,
  260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333,
  333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667,
  278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667,
  611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556,
  556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  761, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278,
  500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556,
  280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333,
  333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667,
  278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667,
  611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611,
  611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

/** Unicode → WinAnsi code for the characters of 0x80–0x9F that differ from Latin-1. */
const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function winAnsi(char: string): number {
  const code = char.codePointAt(0) ?? 63;
  const extra = CP1252_EXTRA[code];
  if (extra !== undefined) return extra;
  if (code >= 32 && code <= 126) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  if (code === 0x09 || code === 0x0a) return 32;
  return 63; // "?" for anything the font cannot show
}

export const A4 = { width: 595.28, height: 841.89 } as const;

export interface TextStyle {
  size?: number;
  bold?: boolean;
  align?: "left" | "right" | "center";
  /** 0 = black, 1 = white. */
  gray?: number;
}

const num = (n: number): string => (Math.round(n * 100) / 100).toString();
const hex = (codes: number[]): string =>
  codes.map((c) => c.toString(16).padStart(2, "0").toUpperCase()).join("");

export class Pdf {
  private pages: string[][] = [[]];
  title = "";

  get page(): number {
    return this.pages.length;
  }

  addPage(): void {
    this.pages.push([]);
  }

  private ops(): string[] {
    return this.pages[this.pages.length - 1] as string[];
  }

  /** Width of a text in points. */
  width(text: string, size = 10, bold = false): number {
    const table = bold ? HELVETICA_BOLD : HELVETICA;
    let units = 0;
    for (const ch of text) units += table[winAnsi(ch) - 32] ?? 556;
    return (units * size) / 1000;
  }

  /** Splits a text into lines that fit `maxWidth`, breaking at spaces (long words are cut). */
  wrap(text: string, maxWidth: number, size = 10, bold = false): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        let w = word;
        while (this.width(w, size, bold) > maxWidth && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && this.width(w.slice(0, cut), size, bold) > maxWidth) cut--;
          if (line) {
            lines.push(line);
            line = "";
          }
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const candidate = line ? `${line} ${w}` : w;
        if (line && this.width(candidate, size, bold) > maxWidth) {
          lines.push(line);
          line = w;
        } else line = candidate;
      }
      lines.push(line);
    }
    return lines;
  }

  /** Draws `text` with its baseline at `y` (points from the page bottom). */
  text(x: number, y: number, text: string, style: TextStyle = {}): void {
    const { size = 10, bold = false, align = "left", gray = 0 } = style;
    const w = this.width(text, size, bold);
    const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    const codes = [...text].map(winAnsi);
    this.ops().push(
      `${num(gray)} g BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${num(left)} ${num(y)} Td <${hex(codes)}> Tj ET`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.6): void {
    this.ops().push(
      `${num(gray)} G ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`,
    );
  }

  rect(x: number, y: number, w: number, h: number, gray: number): void {
    this.ops().push(`${num(gray)} g ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
  }

  /** The finished file as an ASCII string. */
  build(): string {
    const objects: string[] = [];
    const add = (body: string): number => objects.push(body);
    const fontRegular = 3;
    const fontBold = 4;
    add("<< /Type /Catalog /Pages 2 0 R >>"); // 1
    const pageCount = this.pages.length;
    // pages: objects 5.. (page, content) pairs
    const kids = this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
    add(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`); // 2
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"); // 3
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"); // 4
    this.pages.forEach((ops, i) => {
      const content = `${ops.join("\n")}\n`;
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
      );
      add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    });
    const info = objects.length + 1;
    const titleHex = `FEFF${[...this.title].map((c) => (c.codePointAt(0) ?? 63).toString(16).padStart(4, "0").toUpperCase()).join("")}`;
    add(`<< /Title <${titleHex}> /Creator (Vyrion ERP) /Producer (Vyrion ERP) >>`);

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${offset.toString().padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
  }
}
