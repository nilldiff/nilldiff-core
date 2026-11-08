import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStatement } from "../src/statement.ts";
import { pdfLines } from "../src/pdftext.ts";
import { accountLast4, statementName } from "../src/naming.ts";
import { parseCsv } from "../src/csv.ts";
import { parseLedger } from "../src/parse.ts";
import { reconcile } from "../src/reconcile.ts";

// Synthetic two-column card statement (tests/fixtures/gen-card.py): invented numbers, built to the same layout traps as a real card statement.
const fx = (n: string) => new URL(`./fixtures/${n}`, import.meta.url);
const lines = await pdfLines(new Uint8Array(readFileSync(fx("stmt-card.pdf"))));
const stmt = parseStatement(lines);

test("card statement: closing date gives the period, account ending gives last 4, name sorts by month", () => {
  assert.deepEqual(stmt.period, { from: "2026-11-16", to: "2026-12-15" });
  assert.equal(accountLast4(lines), "7123");
  assert.equal(statementName("Summit-Card", stmt.period!.to), "202612_Summit-Card_Statement.pdf");
  assert.equal(stmt.card, true, "recognized as a credit card statement");
});
test("card statement: balances come from the Account Total block, not the Pay In Full or Pay Over Time portions", () => {
  assert.deepEqual(stmt.check, { begin: 425010, end: 128477, sum: -296533, ok: true });
  assert.equal(stmt.skipped.length, 0);
});
test("card statement: payments (with * posting marker) are negative, charges positive, date-only lines stay with their charge", () => {
  const by = (d: string) => stmt.txns.filter((t) => t.date === d);
  assert.equal(stmt.txns.length, 11);
  assert.deepEqual([by("2026-11-20")[0]!.cents, by("2026-12-02")[0]!.cents, by("2026-11-28")[0]!.cents], [-120000, -300050, -8520]);
  assert.equal(by("2026-11-23")[0]!.cents, 1500);
  assert.match(by("2026-11-21")[0]!.desc, /HOTEL LINDEN/);
  assert.doesNotMatch(stmt.txns.map((t) => t.desc).join(" "), /New Charges|Detail|Amount/);
});
test("QuickBooks Transaction Report: title rows, blank first column, Amount plus Debit/Credit columns; sum equals the report's own total", () => {
  const q = parseLedger(parseCsv(readFileSync(fx("qbo-card.csv"), "utf8")), "qbo");
  assert.equal(q.headerRow, 5); assert.equal(q.txns.length, 12);
  assert.equal(q.txns.reduce((s, t) => s + t.cents, 0), -296033, "statement net -2,965.33 plus the 5.00 fee, equal to the report's own Total row");
});
test("card statement vs QuickBooks: same sign convention, posting-date lag handled, the QuickBooks-only fee is the one exception", () => {
  const q = parseLedger(parseCsv(readFileSync(fx("qbo-card.csv"), "utf8")), "qbo");
  const r = reconcile(q.txns, stmt.txns, { windowDays: 7, maxGroup: 5, poolCap: 18 });
  assert.equal(r.matched.length, 11); assert.deepEqual(r.unmatchedBank, []);
  assert.deepEqual(r.unmatchedQbo.map((t) => [t.date, t.cents]), [["2026-12-12", 500]]);
  assert.ok(r.matched.every((m) => m.maxDays <= 1), "each match is within one day");
  const dup = r.matched.filter((m) => m.bank[0]!.cents === 31075).map((m) => [m.bank[0]!.date, m.qbo[0]!.date]).sort();
  assert.deepEqual(dup, [["2026-11-12", "2026-11-13"], ["2026-12-14", "2026-12-15"]], "two identical amounts pair by date");
});
