/** RFC 4180 parser: quotes, escaped quotes, CRLF, BOM, delimiter sniffed from the first line. Blank lines are kept so row numbers match the file. */
export const parseCsv = (text: string): string[][] => {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => first.split(c).length;
  const d = [",", ";", "\t"].reduce((best, c) => (count(c) > count(best) ? c : best), ",");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === "") q = true;
    else if (c === d) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

/** Cells starting with = + - @ get a leading apostrophe so spreadsheets never run them as formulas. */
const safe = (s: string): string => (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);
export const toCsv = (rows: (string | number)[][]): string =>
  "﻿" + rows.map((r) => r.map((x) => { const s = safe(String(x)); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\r\n");
