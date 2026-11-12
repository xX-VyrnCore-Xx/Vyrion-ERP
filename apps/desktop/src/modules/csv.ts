const BOM = String.fromCharCode(0xfeff);
const withoutBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text);

/** Reading CSV as spreadsheets in Italy write it: ";" or "," or tab, quotes, BOM, CRLF. */

export function detectDelimiter(text: string): string {
  const firstLine = withoutBom(text).split(/\r?\n/, 1)[0] ?? "";
  let best = ";";
  let most = -1;
  for (const candidate of [";", ",", "\t", "|"]) {
    // Count outside quotes only: a comma inside "Rossi, Mario" is not a separator.
    let inQuotes = false;
    let n = 0;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === candidate && !inQuotes) n++;
    }
    if (n > most) {
      most = n;
      best = candidate;
    }
  }
  return best;
}

/** Parses CSV text into rows of cells. Blank lines are dropped; quotes may contain newlines. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = withoutBom(input);
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === sep) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}
