import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStatement, StatementError } from "../src/statement.ts";
import { pdfLines, PdfError } from "../src/pdftext.ts";

const pdf = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));

test("statement PDF: sectioned layout, continuation line, check number, balances tie out", async () => {
  const s = parseStatement(await pdfLines(pdf("stmt-sectioned.pdf")));
  assert.deepEqual(s.period, { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(s.txns.map((t) => [t.date, t.cents, t.desc, t.num]), [
    ["2026-10-01", 123456, "STRIPE PAYOUT", ""], ["2026-10-15", 500000, "ACH DEPOSIT CUSTOMER A INV 1042 OCT RETAINER", ""],
    ["2026-10-03", -250000, "CHECK 1001", "1001"], ["2026-10-20", -5499, "ADOBE *CREATIVE CLOUD", ""], ["2026-10-31", -1500, "MONTHLY SERVICE FEE", ""]]);
  assert.deepEqual(s.check, { begin: 1000000, end: 1366457, sum: 366457, ok: true });
  assert.equal(s.card, false, "a checking statement is not a card statement");
  assert.equal(s.skipped.length, 0);
});

test("statement PDF: a statement that does not add up is flagged, not trusted", async () => {
  const s = parseStatement(await pdfLines(pdf("stmt-sectioned-bad.pdf")));
  assert.equal(s.check.ok, false);
  assert.equal(s.check.end! - s.check.begin! - s.check.sum, 100);
});

test("statement PDF: running-balance layout takes signs from the balance column", async () => {
  const s = parseStatement(await pdfLines(pdf("stmt-running.pdf")));
  assert.deepEqual(s.txns.map((t) => [t.date, t.cents, t.desc]), [["2026-09-02", 300000, "PAYROLL DEPOSIT"], ["2026-09-05", -250000, "RENT PAYMENT"], ["2026-09-09", 2510, "REFUND AMAZON"], ["2026-09-12", -12510, "UTILITY CO"]]);
  assert.equal(s.check.ok, true);
});

test("statement: balance delta overrides a wrong section guess", () => {
  const s = parseStatement(["Statement Period: 01/01/2026 - 01/31/2026", "Beginning Balance  1,000.00", "Deposits", "01/05  REVERSED CHARGE  200.00  800.00", "Ending Balance  800.00"]);
  assert.equal(s.txns[0]!.cents, -20000);
  assert.equal(s.check.ok, true);
});

test("statement: unclear sign is left out and reported so the check fails", () => {
  const s = parseStatement(["Period 03/01/2026 - 03/31/2026", "Beginning Balance 100.00", "03/04 MYSTERY 25.00", "03/05 PAREN (10.00)", "Ending Balance 65.00"]);
  assert.deepEqual(s.txns.map((t) => t.cents), [-1000]);
  assert.deepEqual(s.skipped.map((k) => k.reason), ["could not tell deposit from withdrawal"]);
  assert.equal(s.check.ok, false);
});

test("statement: year rolls across a December to January period; no balances means unverified", () => {
  const s = parseStatement(["Statement Period: December 15, 2026 through January 14, 2027", "Credits", "12/20 A 10.00", "01/02 B 5.00"]);
  assert.deepEqual(s.txns.map((t) => t.date), ["2026-12-20", "2027-01-02"]);
  assert.equal(s.check.ok, null);
});

test("statement: missing year is an error, not a guess; bad dates are skipped", () => {
  assert.throws(() => parseStatement(["Credits", "01/02 B 5.00"]), StatementError);
  const s = parseStatement(["Period 01/01/2026 - 01/31/2026", "Credits", "13/45 X 5.00", "01/09 NO AMOUNT HERE"]);
  assert.deepEqual(s.skipped.map((k) => k.reason), ["not a valid date", "dated line without an amount"]);
});

test("statement PDF: non-PDF and empty input fail with plain reasons", async () => {
  await assert.rejects(pdfLines(new TextEncoder().encode("not a pdf")), (e) => e instanceof PdfError && /could not be read/.test(e.message));
});
