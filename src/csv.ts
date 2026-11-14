export class CsvLimit extends Error {}
/** RFC 4180 parser: quotes, escaped quotes, CRLF, BOM, delimiter sniffed from the first line. Blank lines are kept so row numbers match the file.
 *  The limits are checked while parsing, so a hostile file stops early instead of filling memory first. */
export const parseCsv = (text: string, maxRows = Infinity, maxCells = Infinity): string[][] => {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => first.split(c).length;
  const d = [",", ";", "\t"].reduce((best, c) => (count(c) > count(best) ? c : best), ",");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false, cells = 0;
  const end = () => { row.push(cell); cell = ""; if (++cells > maxCells) throw new CsvLimit(`more than ${maxCells.toLocaleString("en-US")} cells`); };
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === "") q = true;
    else if (c === d) end();
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; end(); rows.push(row); row = []; if (rows.length > maxRows) throw new CsvLimit(`more than ${maxRows.toLocaleString("en-US")} rows`); }
    else cell += c;
  }
  if (cell !== "" || row.length) { end(); rows.push(row); }
  return rows;
};

/** Cells starting with = + - @ get a leading apostrophe so spreadsheets never run them as formulas. Fields holding a comma, semicolon or tab are quoted, so a spreadsheet that splits on any of them never starts a cell mid-field. */
const safe = (s: string): string => (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);
export const toCsv = (rows: (string | number)[][]): string =>
  "﻿" + rows.map((r) => r.map((x) => { const s = safe(String(x)); return /[",;\t\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\r\n");
