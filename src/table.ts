import type { Cell } from "./pdftext.ts";
import { parseCsv } from "./csv.ts";
import { toIsoDate } from "./dates.ts";
import { toCents } from "./money.ts";
import { isXlsx, readXlsx } from "./xlsx.ts";

/** Any two-dimensional list read from a spreadsheet, CSV or text PDF: a header row and the rows under it. Nothing is kept beyond this object. */
export const MAX_FILE = 50 * 2 ** 20, MAX_ROWS = 150_000, MAX_COLS = 200;
export class TableError extends Error {}
export type ColType = "num" | "date" | "text";
export interface Table { file: string; origin: "xlsx" | "csv" | "pdf"; headers: string[]; rows: string[][]; dropped: number }

const blank = (s: string | undefined): boolean => !s || !s.trim();
const isData = (s: string): boolean => toCents(s) !== null || toIsoDate(s) !== null;
const TOTAL = /^(grand\s+|sub\s*)?totals?\b/i, SERIAL = /^\d{5}(\.\d+)?$/, DATEHDR = /date|\bdue\b|\bdt\b|posted|period|maturity|origination|closing|\bday\b/i;
const uniq = (h: string[]): string[] => { const seen = new Map<string, number>(); return h.map((x, i) => { const b = x.trim() || `Column ${i + 1}`, n = (seen.get(b.toLowerCase()) ?? 0) + 1; seen.set(b.toLowerCase(), n); return n > 1 ? `${b} (${n})` : b; }); };

/** Picks the header row (the first of the top 30 rows that is mostly text and nearly as wide as the widest such row) and returns the table below it. */
export const buildTable = (file: string, origin: Table["origin"], grid: string[][]): Table => {
  const top = grid.slice(0, 30).map((r, i) => { const f = r.filter((c) => !blank(c)); return { i, n: f.length, text: f.length ? f.filter((c) => !isData(c)).length / f.length : 0 }; });
  const cand = top.filter((r) => r.n >= 2 && r.text >= 0.6), w = Math.max(0, ...cand.map((r) => r.n)), h = cand.find((r) => r.n >= 0.8 * w);
  if (!h) throw new TableError(`${file}: no header row found. The first rows need column names.`);
  if (grid.length - h.i - 1 > MAX_ROWS * 1.2) throw new TableError(`${file}: more than ${MAX_ROWS.toLocaleString("en-US")} rows; the limit is ${MAX_ROWS.toLocaleString("en-US")}.`);
  const head = grid[h.i]!, last = head.reduce((m, c, j) => (blank(c) ? m : j), -1), headers = uniq(head.slice(0, Math.min(last + 1, MAX_COLS)).map((c) => String(c ?? "")));
  const rows: string[][] = []; let dropped = 0;
  for (let i = h.i + 1; i < grid.length; i++) {
    const r = grid[i]; if (!r || r.every(blank)) continue;
    if (TOTAL.test(r.find((c) => !blank(c))!.trim())) { dropped++; continue; }
    rows.push(Array.from({ length: headers.length }, (_, j) => (r[j] ?? "").trim()));
  }
  if (rows.length > MAX_ROWS) throw new TableError(`${file}: ${rows.length.toLocaleString("en-US")} rows; the limit is ${MAX_ROWS.toLocaleString("en-US")}.`);
  if (!rows.length) throw new TableError(`${file}: no rows under the header.`);
  return { file, origin, headers, rows, dropped };
};

const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.min(a1, b1) - Math.max(a0, b0); // positive: shared width; negative: the gap between them
/** A table from the cells of a text PDF: the header row fixes the columns, every cell below joins the header it overlaps most (or sits closest to). */
export const tableFromCells = (file: string, cells: Cell[][]): Table => {
  const isHead = (r: Cell[]) => r.length >= 3 && r.every((c) => !isData(c.s));
  const hi = cells.slice(0, 40).findIndex((r, i) => isHead(r) && cells.slice(i + 1, i + 4).filter((n) => n.length >= Math.ceil(r.length / 2)).length >= 2);
  if (hi < 0) throw new TableError(`${file}: no table found in this PDF. Scanned PDFs and PDFs without a header row are not supported yet.`);
  const cols = cells[hi]!, key = (r: Cell[]) => r.map((c) => c.s.toLowerCase()).join("|"), hk = key(cols), need = Math.max(2, Math.ceil(cols.length * 0.4)), rows: string[][] = []; let dropped = 0;
  for (const r of cells.slice(hi + 1)) {
    if (key(r) === hk) continue; // header repeated on the next page
    if (TOTAL.test(r[0]!.s)) { dropped++; continue; }
    const row = cols.map(() => ""), put = new Set<number>();
    for (const c of r) { let b = 0, bs = -Infinity; cols.forEach((h, i) => { const o = overlap(h.x0, h.x1, c.x0, c.x1); if (o > bs) { bs = o; b = i; } }); row[b] = row[b] ? `${row[b]} ${c.s}` : c.s; put.add(b); }
    if (put.size >= need) rows.push(row);
    if (rows.length > MAX_ROWS) throw new TableError(`${file}: more than ${MAX_ROWS.toLocaleString("en-US")} rows.`);
  }
  if (!rows.length) throw new TableError(`${file}: a header was found but no rows under it.`);
  return { file, origin: "pdf", headers: uniq(cols.map((c) => c.s)), rows, dropped };
};

const friendly = (file: string, e: unknown): TableError => {
  const m = e instanceof Error ? e.message : String(e);
  return e instanceof TableError ? e : new TableError(/too large|out of range/.test(m) ? `${file}: this sheet is too large to read safely (about ${MAX_ROWS.toLocaleString("en-US")} rows at ten columns).` : `${file}: ${m}`);
};
/** Reads one file by its bytes, not its name. PDF text extraction loads on first use. */
export const readTable = async (file: string, bytes: Uint8Array): Promise<Table> => {
  if (bytes.length > MAX_FILE) throw new TableError(`${file}: larger than ${MAX_FILE / 2 ** 20} MB.`);
  try {
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return tableFromCells(file, (await (await import("./pdftext.ts")).pdfLayout(bytes)).cells);
    const x = isXlsx(bytes);
    return buildTable(file, x ? "xlsx" : "csv", x ? readXlsx(bytes) : parseCsv(new TextDecoder().decode(bytes)));
  } catch (e) { throw friendly(file, e); }
};

export interface ColInfo { type: ColType; unique: number; intOnly: boolean; sample: string[] }
const SAMPLE = 2000;
/** Normal form for matching keys: trimmed, upper case, one space, no leading zeros on all-digit ids, no trailing ".0" from spreadsheets. */
export const normKey = (s: string): string => { const t = s.trim().toUpperCase().replace(/\s+/g, " ").replace(/^(\d+)\.0+$/, "$1"); return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, "") : t; };
/** Every distinct normal-form value of a column (used for key candidates only, so memory stays small). */
export const keySet = (t: Table, j: number): Set<string> => { const s = new Set<string>(); for (const r of t.rows) { const k = normKey(r[j]!); if (k) s.add(k); } return s; };
/** Type of a column from a sample of its values: dates by their text (or by Excel serials when the header says date), numbers by money parsing, else text. */
export const colInfo = (t: Table, j: number): ColInfo => {
  const step = Math.max(1, Math.floor(t.rows.length / SAMPLE)), sample: string[] = [];
  for (let i = 0; i < t.rows.length && sample.length < SAMPLE; i += step) { const x = t.rows[i]![j]!; if (x) sample.push(x); }
  const n = sample.length, f = (p: (s: string) => boolean) => (n ? sample.filter(p).length / n : 0);
  const type: ColType = f((s) => !SERIAL.test(s) && toIsoDate(s) !== null) >= 0.9 || (DATEHDR.test(t.headers[j]!) && f((s) => SERIAL.test(s) && toIsoDate(s) !== null) >= 0.9) ? "date" : f((s) => toCents(s) !== null) >= 0.9 ? "num" : "text";
  return { type, sample, unique: n ? new Set(sample.map(normKey)).size / n : 0, intOnly: type === "num" && f((s) => /^\d+(\.0+)?$/.test(s.trim())) >= 0.99 };
};
