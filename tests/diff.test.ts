import { test } from "node:test";
import assert from "node:assert/strict";
import { Diff } from "../src/diff.ts";
import { suggestMapping } from "../src/mapping.ts";
import { buildTable, readTable, tableFromCells, TableError, MAX_ROWS } from "../src/table.ts";
import { parseTol, within } from "../src/tol.ts";
import { parseCsv } from "../src/csv.ts";
import { writeXlsx } from "../src/xlsxw.ts";

// Invented AR data: a ledger (A) and a customer statement (B) that disagree in known ways.
const A = [["Invoice #", "Amount", "Balance Due", "Inv Date", "Due Date"],
  ["INV-20401", "12450.00", "12450.00", "2026-09-05", "2026-10-05"], ["INV-20402", "8200.00", "8200.00", "2026-09-12", "2026-10-12"],
  ["INV-20403", "15780.50", "5780.50", "2026-09-18", "2026-10-18"], ["INV-20404", "3945.00", "3945.00", "2026-09-25", "2026-10-25"],
  ["INV-20405", "22000.00", "22000.00", "2026-10-02", "2026-11-01"], ["INV-20406", "6310.25", "6310.25", "2026-10-09", "2026-11-08"],
  ["INV-20407", "9875.00", "9875.00", "2026-10-16", "2026-11-15"], ["INV-20408", "4120.00", "4120.00", "2026-10-23", "2026-11-22"]];
const B = [["Invoice", "Date", "Due", "Charges", "Balance"],
  ["INV-20409", "2026-10-28", "2026-11-27", "2600.00", "2600.00"], ["INV-20407", "2026-10-20", "2026-11-15", "9875.00", "9875.00"],
  ["INV-20401", "2026-09-05", "2026-10-05", "12450.00", "12450.00"], ["INV-20402", "2026-09-12", "2026-10-12", "8200.00", "8199.60"],
  ["INV-20403", "2026-09-18", "2026-10-18", "15780.50", "10780.50"], ["INV-20404", "2026-09-25", "2026-10-25", "3954.00", "3954.00"],
  ["INV-20405", "2026-10-02", "2026-11-02", "22000.00", "22000.00"], ["INV-20406", "2026-10-09", "2026-11-08", "6310.25", "6310.25"]];
const csv = (g: string[][]) => g.map((r) => r.join(",")).join("\n");
const tbl = (name: string, g: string[][]) => buildTable(name, "csv", parseCsv(csv(g)));
const names: [string, string] = ["ledger", "statement"];

test("buildTable: finds the header under title rows, drops totals, pads short rows", () => {
  const t = buildTable("x.csv", "csv", parseCsv("Acme AR Aging\nRun date,2026-10-31\n\nInvoice #,Amount,Memo\nINV-1,10.00,a\nINV-2,20.00\nTotal,30.00,\n"));
  assert.deepEqual(t.headers, ["Invoice #", "Amount", "Memo"]);
  assert.deepEqual(t.rows, [["INV-1", "10.00", "a"], ["INV-2", "20.00", ""]]);
  assert.equal(t.dropped, 1);
  assert.throws(() => buildTable("n.csv", "csv", parseCsv("1,2\n3,4")), TableError);
});

test("buildTable: blank and repeated headers get unique names; row cap is enforced", () => {
  assert.deepEqual(buildTable("x.csv", "csv", parseCsv("Amt,,Amt\n1,2,3")).headers, ["Amt", "Column 2", "Amt (2)"]);
  const big = [["id", "v"], ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`k${i}`, "1"])];
  assert.throws(() => buildTable("big.csv", "csv", big), /limit is 150,000/);
});

test("tableFromCells: a text-PDF table by x position, right-aligned amounts, repeated header and totals skipped", () => {
  const c = (s: string, x0: number, x1: number) => ({ s, x0, x1 });
  const head = [c("Invoice", 40, 90), c("Date", 150, 180), c("Charges", 300, 350), c("Balance", 400, 450)];
  const row = (id: string, d: string, a: string, b: string) => [c(id, 40, 100), c(d, 150, 205), c(a, 310, 350), c(b, 410, 450)];
  const t = tableFromCells("s.pdf", [[c("Statement", 40, 120)], head, row("INV-1", "2026-09-05", "12,450.00", "12,450.00"), row("INV-2", "2026-09-12", "8,200.00", "8,199.60"), [c("Page 2", 40, 80)], head, row("INV-3", "2026-09-18", "1.00", "1.00"), [c("Total", 40, 70), c("21,651.00", 310, 350)]]);
  assert.deepEqual(t.headers, ["Invoice", "Date", "Charges", "Balance"]);
  assert.deepEqual(t.rows.map((r) => r.join("|")), ["INV-1|2026-09-05|12,450.00|12,450.00", "INV-2|2026-09-12|8,200.00|8,199.60", "INV-3|2026-09-18|1.00|1.00"]);
  assert.equal(t.dropped, 1);
  assert.throws(() => tableFromCells("s.pdf", [[c("only one line", 0, 50)]]), /no table found/);
});

test("suggestMapping: key and column pairs found from names and values, whatever the row order", () => {
  const m = suggestMapping(tbl("a.csv", A), tbl("b.csv", B));
  assert.deepEqual([m.key?.a, m.key?.b], [0, 0]);
  assert.deepEqual(m.pairs.map((p) => [p.a, p.b, p.type]), [[1, 3, "num"], [2, 4, "num"], [3, 1, "date"], [4, 2, "date"]]);
});

test("suggestMapping: the key is an id, not an amount column that happens to repeat in both files", () => {
  const a = tbl("a.csv", [["Amount", "Ref"], ["100", "A1"], ["200", "A2"], ["300", "A3"]]), b = tbl("b.csv", [["Amount", "Reference"], ["100", "A1"], ["200", "A2"], ["300", "A3"]]);
  assert.deepEqual([suggestMapping(a, b).key?.a, suggestMapping(a, b).key?.b], [1, 1]);
  assert.equal(suggestMapping(tbl("c.csv", [["Name", "Qty"], ["x", "1"], ["y", "2"]]), tbl("d.csv", [["Color", "Size"], ["red", "9"], ["blue", "8"]])).key, null);
});

test("suggestMapping: spreadsheet dates stored as serial numbers are read as dates when the header says date", async () => {
  const x = (rows: (string | number)[][]) => writeXlsx([{ name: "Sheet1", rows }]);
  const ta = await readTable("a.xlsx", x([["Loan ID", "UPB", "Next Due"], ["L1", 1000.5, 46000], ["L2", 2000, 46010], ["L3", 3000, 46020]]));
  const tb = await readTable("b.xlsx", x([["Loan Number", "Ending UPB", "Due Date"], ["L1", 1000.5, 46000], ["L2", 1999, 46010], ["L3", 3000, 46024]]));
  const m = suggestMapping(ta, tb);
  assert.deepEqual(m.pairs.map((p) => p.type), ["num", "date"]);
  const d = new Diff(ta, tb, m, { prec: "A", tols: ["1", "3 days"], names });
  assert.deepEqual([d.counts.ok, d.counts.tol, d.counts.brk], [1, 1, 1]);
});

test("parseTol: free-form amounts, percents, days and text rules", () => {
  assert.deepEqual(parseTol("", "num"), { abs: 0, pct: 0, ci: false });
  assert.deepEqual(parseTol("$1.50", "num"), { abs: 150, pct: 0, ci: false });
  assert.deepEqual(parseTol("±1 or 0.1%", "num"), { abs: 100, pct: 0.001, ci: false });
  assert.equal((parseTol("3 days", "date") as { abs: number }).abs, 3);
  assert.equal((parseTol("5d", "date") as { abs: number }).abs, 5);
  assert.equal((parseTol("ignore case", "text") as { ci: boolean }).ci, true);
  for (const [t, ty] of [["abc", "num"], ["2%", "date"], ["1 day", "num"], ["1", "text"]] as const) assert.equal(typeof parseTol(t, ty), "string", `${t} as ${ty}`);
  assert.ok(within(99, 100000, { abs: 100, pct: 0, ci: false }) && !within(101, 100000, { abs: 100, pct: 0, ci: false }) && within(900, 1_000_000, { abs: 0, pct: 0.001, ci: false }));
});

const run = (prec: "A" | "B", tols = ["1", "1", "exact", "3"]) => { const a = tbl("a.csv", A), b = tbl("b.csv", B), m = suggestMapping(a, b); return new Diff(a, b, m, { prec, tols, names }); };

test("Diff: counts, field differences and totals on the known differences", () => {
  const d = run("A");
  assert.deepEqual({ ...d.counts }, { ok: 2, tol: 2, brk: 3, onlyA: 1, onlyB: 1, fieldBreaks: 4, dupKeysA: 0, dupKeysB: 0 });
  const exc = d.page("exc", 0, 100);
  assert.deepEqual(exc.map((r) => [r.key, r.result]), [["INV-20403", "1 difference"], ["INV-20404", "2 differences"], ["INV-20407", "1 difference"], ["INV-20408", "Only in ledger"], ["INV-20409", "Only in statement"]]);
  const r403 = exc[0]!;
  assert.deepEqual(r403.cells.map((c) => c.cls), ["ok", "brk", "ok", "ok"]);
  assert.equal(r403.cells[1]!.top, "5,780.50"); assert.equal(r403.cells[1]!.sub, "statement 10,780.50 · Δ +5,000.00");
  assert.equal(exc[2]!.cells[2]!.sub, "statement 2026-10-20 · Δ +4 d");
  const tol = d.page("tol", 0, 10);
  assert.deepEqual(tol.map((r) => r.key), ["INV-20402", "INV-20405"]);
  assert.equal(tol[0]!.cells[1]!.sub, "statement 8,199.60 · Δ −0.40");
});

test("Diff: totals are the sums of each compared amount column on each side", () => {
  const d = run("A"), sum = (g: string[][], j: number) => g.slice(1).reduce((s, r) => s + Math.round(Number(r[j]) * 100), 0);
  assert.deepEqual(d.totals.map((t) => [t.label, t.a, t.b]), [["Amount", sum(A, 1), sum(B, 3)], ["Balance Due", sum(A, 2), sum(B, 4)]]);
});

test("Diff: precedence decides which value is shown and the sign of the gap; tolerances change the status, not the data", () => {
  const b = run("B"), r = b.page("exc", 0, 10).find((x) => x.key === "INV-20403")!;
  assert.equal(r.cells[1]!.top, "10,780.50"); assert.equal(r.cells[1]!.sub, "ledger 5,780.50 · Δ −5,000.00");
  const loose = run("A", ["10000", "10000", "5 days", "5"]);
  assert.deepEqual([loose.counts.ok, loose.counts.tol, loose.counts.brk], [2, 5, 0]);
  const pct = run("A", ["0.1%", "90%", "exact", "3"]);
  assert.deepEqual([pct.counts.ok, pct.counts.tol, pct.counts.brk], [2, 3, 2]);
});

test("Diff: an unparseable tolerance is reported and treated as exact; text columns and blanks", () => {
  const a = tbl("a.csv", [["Id", "Status", "Note"], ["1", "Current", ""], ["2", "30 DPD", "x"], ["3", "current", "y"]]), b = tbl("b.csv", [["ID", "Status", "Note"], ["1", "Current", ""], ["2", "60 DPD", "x"], ["3", "Current", ""]]);
  const m = suggestMapping(a, b), d = new Diff(a, b, m, { prec: "A", tols: ["", "banana"], names });
  assert.equal(d.errors.length, 2); assert.ok(m.pairs.length === 2);
  assert.deepEqual([d.counts.ok, d.counts.brk], [1, 2]);
  const ci = new Diff(a, b, m, { prec: "A", tols: ["ignore case", ""], names });
  assert.equal(ci.errors.every((e) => e === null), true);
});

test("Diff: duplicate keys pair in order and are counted; rows without a key are ignored", () => {
  const a = tbl("a.csv", [["Id", "Amt"], ["1", "10"], ["1", "20"], ["2", "5"], ["", "99"]]), b = tbl("b.csv", [["Id", "Amt"], ["1", "10"], ["1", "25"], ["3", "7"]]);
  const d = new Diff(a, b, { key: { a: 0, b: 0, overlap: 1 }, pairs: [{ a: 1, b: 1, label: "Amt", type: "num", tol: "" }] }, { prec: "A", tols: [""], names });
  assert.deepEqual({ ok: d.counts.ok, brk: d.counts.brk, onlyA: d.counts.onlyA, onlyB: d.counts.onlyB, dupKeysA: d.counts.dupKeysA, dupKeysB: d.counts.dupKeysB }, { ok: 1, brk: 1, onlyA: 1, onlyB: 1, dupKeysA: 1, dupKeysB: 1 });
  assert.throws(() => new Diff(a, b, { key: null, pairs: [] }, { prec: "A", tols: [], names }), /key column/);
});

test("exportRows: header plus one row per row in the filter, numbers as numbers, gap and used value", () => {
  const d = run("A"), x = d.exportRows("exc");
  assert.equal(x.length, 1 + 5); assert.equal(x[0]!.length, 2 + 4 * 4);
  const r = x.find((r) => r[0] === "INV-20403")!;
  assert.deepEqual(r.slice(0, 2), ["INV-20403", "1 difference"]); assert.deepEqual(r.slice(6, 10), [5780.5, 10780.5, 5000, 5780.5]);
  assert.equal(d.exportRows("all").length, 1 + 9);
  assert.deepEqual(run("B").exportRows("exc").find((r) => r[0] === "INV-20403")!.slice(6, 10), [5780.5, 10780.5, 5000, 10780.5]);
});

test("readTable: reads CSV and xlsx by bytes, refuses oversize and unreadable files with a plain message", async () => {
  const t = await readTable("data.bin", new TextEncoder().encode(csv(A)));
  assert.equal(t.origin, "csv"); assert.equal(t.rows.length, 8);
  await assert.rejects(readTable("big.csv", new Uint8Array(51 * 2 ** 20)), /larger than 50 MB/);
  await assert.rejects(readTable("bad.pdf", new TextEncoder().encode("%PDF-1.4 not really")), TableError);
});

test("readTable: a real text PDF (synthetic AR statement, header repeated on page two, total line) becomes a table that diffs against a ledger", async () => {
  const { readFileSync } = await import("node:fs");
  const pdf = await readTable("statement.pdf", new Uint8Array(readFileSync(new URL("./fixtures/ar-statement.pdf", import.meta.url))));
  assert.deepEqual(pdf.headers, ["Invoice", "Date", "Due", "Charges", "Balance"]);
  assert.equal(pdf.rows.length, 8); assert.equal(pdf.dropped, 1); assert.equal(pdf.origin, "pdf");
  const a = tbl("a.csv", A), m = suggestMapping(a, pdf), d = new Diff(a, pdf, m, { prec: "A", tols: ["1", "1", "exact", "3"], names });
  assert.deepEqual({ ...d.counts, dupKeysA: 0, dupKeysB: 0 }, { ok: 2, tol: 2, brk: 3, onlyA: 1, onlyB: 1, fieldBreaks: 4, dupKeysA: 0, dupKeysB: 0 });
});
