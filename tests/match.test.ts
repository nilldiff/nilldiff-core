import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/table.ts";
import { parseCsv } from "../src/csv.ts";
import { linesOf, matchLines, matchRows, matchTables, suggestSides, tieOut, type Line } from "../src/match.ts";

// Invented data only. A ledger (A) and a statement (B) of the same account, which record the same movements.
const tbl = (name: string, rows: string[][]) => buildTable(name, "csv", parseCsv(rows.map((r) => r.map((c) => (/[,"]/.test(c) ? `"${c}"` : c)).join(",")).join("\n")));
const day = (iso: string) => Date.parse(iso) / 864e5;
const L = (row: number, iso: string, cents: number, desc = "", ref = ""): Line => ({ row, day: day(iso), cents, desc, ref });

test("match: same amount within the window pairs up; the closer date and the more alike description win a tie", () => {
  const A = [L(0, "2026-03-02", -4500, "OFFICE SUPPLY CO"), L(1, "2026-03-03", -4500, "COURIER EXPRESS")];
  const B = [L(0, "2026-03-04", -4500, "COURIER EXPRESS 1182"), L(1, "2026-03-03", -4500, "OFFICE SUPPLY")];
  const r = matchLines(A, B);
  assert.deepEqual(r.groups.map((g) => [g.a[0]!.desc, g.b[0]!.desc]).sort(), [["COURIER EXPRESS", "COURIER EXPRESS 1182"], ["OFFICE SUPPLY CO", "OFFICE SUPPLY"]].sort());
  assert.equal(r.onlyA.length + r.onlyB.length, 0);
  assert.equal(matchLines([L(0, "2026-03-01", 100)], [L(0, "2026-03-05", 100)], { windowDays: 3 }).groups.length, 0, "4 days apart is outside a 3-day window");
});

test("match: a matching reference breaks a tie the dates and words can't", () => {
  const A = [L(0, "2026-03-02", -9900, "PAYMENT", "1043"), L(1, "2026-03-02", -9900, "PAYMENT", "1044")];
  const B = [L(0, "2026-03-03", -9900, "PAYMENT", "1044"), L(1, "2026-03-03", -9900, "PAYMENT", "1043")];
  assert.deepEqual(matchLines(A, B).groups.map((g) => [g.a[0]!.ref, g.b[0]!.ref]).sort(), [["1043", "1043"], ["1044", "1044"]]);
});

test("match: several lines adding up exactly to one line on the other side match as a group, either way round", () => {
  const A = [L(0, "2026-04-01", 12000, "INV 1"), L(1, "2026-04-01", 8050, "INV 2"), L(2, "2026-04-02", 4000, "INV 3"), L(3, "2026-04-10", -30000, "RENT")];
  const B = [L(0, "2026-04-02", 24050, "DEPOSIT"), L(1, "2026-04-10", -18000, "RENT PART 1"), L(2, "2026-04-11", -12000, "RENT PART 2")];
  const r = matchLines(A, B), kinds = r.groups.map((g) => `${g.kind}:${g.a.length}:${g.b.length}`).sort();
  assert.deepEqual(kinds, ["1:many:1:2", "many:1:3:1"]);
  assert.equal(r.onlyA.length + r.onlyB.length, 0);
});

test("match: same amount further apart than the window is a timing difference (shown, not matched); totals split into matched, timing and unexplained", () => {
  const A = [L(0, "2026-05-01", 50000, "WIRE IN"), L(1, "2026-05-28", -2500, "SERVICE FEE"), L(2, "2026-05-15", -7700, "LOST LINE")];
  const B = [L(0, "2026-05-02", 50000, "WIRE"), L(1, "2026-06-09", -2500, "SERVICE FEE"), L(2, "2026-05-20", 1200, "INTEREST")];
  const r = matchLines(A, B);
  assert.equal(r.groups.length, 1);
  assert.deepEqual(r.timing.map((t) => [t.a.desc, t.days]), [["SERVICE FEE", 12]]);
  assert.deepEqual([r.onlyA.map((x) => x.desc), r.onlyB.map((x) => x.desc)], [["LOST LINE"], ["INTEREST"]], "a timing pair isn't listed again as only on one side");
  const t = r.totals;
  assert.equal(t.a - t.b, (t.timingA - t.timingB) + (t.onlyA - t.onlyB), "difference = timing + unexplained");
  assert.equal(t.matched, 50000);
  assert.equal(matchLines([L(0, "2026-01-01", 10)], [L(0, "2026-03-01", 10)], { lateDays: 45 }).timing.length, 0, "beyond lateDays it's just unmatched");
});

test("lines: a signed amount column or money in and out; rows without a date or amount are skipped and named; flip turns the signs over", () => {
  const t = tbl("s.csv", [["Posted", "Details", "Money in", "Money out", "Ref"], ["2026-06-01", "SALE", "250.00", "", "A1"], ["2026-06-02", "SUPPLIES", "", "40.10", "A2"], ["", "carried forward", "", "", ""], ["2026-06-03", "NOTE", "", "", ""]]);
  const { lines, skipped } = linesOf(t, { date: 0, amount: null, in: 2, out: 3, desc: 1, ref: 4, flip: false });
  assert.deepEqual(lines.map((x) => [x.desc, x.cents, x.ref]), [["SALE", 25000, "A1"], ["SUPPLIES", -4010, "A2"]]);
  assert.deepEqual(skipped, [{ row: 2, reason: "no date" }, { row: 3, reason: "no amount" }]);
  assert.deepEqual(linesOf(t, { date: 0, amount: null, in: 2, out: 3, desc: 1, ref: 4, flip: true }).lines.map((x) => x.cents), [-25000, 4010]);
});

test("suggest: finds each side's date, amount (or in and out), description and reference, and sees when one file records the opposite sign", () => {
  const ledger = tbl("ledger.csv", [["Date", "Memo", "Doc No", "Amount"], ["2026-07-01", "Customer receipt", "R-1", "1500.00"], ["2026-07-03", "Rent", "P-9", "-2000.00"], ["2026-07-05", "Software", "P-10", "-49.99"], ["2026-07-08", "Customer receipt", "R-2", "300.00"]]);
  const other = tbl("other.csv", [["Txn Date", "Description", "Withdrawals", "Deposits"], ["07/02/2026", "RECEIPT", "", "1500.00"], ["07/03/2026", "RENT", "2000.00", ""], ["07/06/2026", "SOFTWARE", "49.99", ""], ["07/09/2026", "RECEIPT", "", "300.00"]]);
  const s = suggestSides(ledger, other)!;
  assert.deepEqual(s.a, { date: 0, amount: 3, in: null, out: null, desc: 1, ref: 2, flip: false });
  assert.deepEqual(s.b, { date: 0, amount: null, in: 3, out: 2, desc: 1, ref: null, flip: false });
  assert.equal(matchTables(ledger, other, s.a, s.b).groups.length, 4, "all four line up");
  // The same file with signs the other way round (a card or liability view): flip is detected
  const neg = tbl("neg.csv", [["Date", "Description", "Amount"], ["2026-07-02", "RECEIPT", "-1500.00"], ["2026-07-03", "RENT", "2000.00"], ["2026-07-06", "SOFTWARE", "49.99"], ["2026-07-09", "RECEIPT", "-300.00"]]);
  const f = suggestSides(ledger, neg)!;
  assert.equal(f.b.flip, true);
  assert.equal(matchTables(ledger, neg, f.a, f.b).groups.length, 4);
  assert.equal(suggestSides(ledger, tbl("x.csv", [["Name", "Code"], ["a", "b"], ["c", "d"]])), null, "no date or amount: no suggestion");
});

test("tie-out: opening balance plus every line is the closing balance, or the gap is named", () => {
  const lines = [L(0, "2026-08-01", 25000), L(1, "2026-08-02", -4010)];
  assert.deepEqual(tieOut(lines, 100000, 120990), { expected: 120990, closing: 120990, gap: 0 });
  assert.equal(tieOut(lines, 100000, 121000).gap, 10);
});

test("export rows: one row per group, timing pair and unmatched line, both sides side by side", () => {
  const r = matchLines([L(0, "2026-05-01", 500, "A"), L(1, "2026-05-01", 700, "LEFT")], [L(0, "2026-05-02", 500, "A"), L(1, "2026-05-20", 700, "LATE"), L(2, "2026-05-03", 900, "RIGHT")]);
  const rows = matchRows(r, ["Ledger", "Statement"]);
  assert.deepEqual(rows[0], ["Result", "Date (Ledger)", "Description (Ledger)", "Amount (Ledger)", "Date (Statement)", "Description (Statement)", "Amount (Statement)", "Days apart"]);
  assert.deepEqual(rows.slice(1).map((x) => x[0]), ["Match", "Timing: same amount, 19 days apart", "Only in Statement"]);
  assert.deepEqual(rows[1], ["Match", "2026-05-01", "A", 5, "2026-05-02", "A", 5, 1]);
});

test("match: 100,000 lines a side with heavily repeated amounts finish fast (the repeated amounts are paired in date order, not every pair)", () => {
  const mk = (n: number, shift: number) => Array.from({ length: n }, (_, i) => L(i, new Date(Date.UTC(2026, 0, 1) + ((i % 300) + shift) * 864e5).toISOString().slice(0, 10), (i % 50 + 1) * 100, `ITEM ${i % 977}`));
  const t0 = performance.now(), r = matchLines(mk(100_000, 0), mk(100_000, 1)), ms = performance.now() - t0;
  assert.equal(r.groups.length, 100_000, `matched ${r.groups.length}`);
  assert.ok(ms < 6000, `took ${Math.round(ms)} ms`);
});
