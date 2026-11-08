import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStatement } from "../src/statement.ts";
import { pdfLayout } from "../src/pdftext.ts";
import { accountLast4, detectLabel } from "../src/naming.ts";
import { toCents } from "../src/money.ts";

const read = async (n: string) => { const l = await pdfLayout(new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)))); const s = parseStatement(l.lines, l.cells); return { s, label: detectLabel(l.lines, s.card), last4: accountLast4(l.lines) }; };
const rows = (s: ReturnType<typeof parseStatement>) => s.txns.map((t) => [t.date, t.cents]);

test("Chase-style: sections, a checks-paid table with the number first, and the daily ending balance table is not read as transactions", async () => {
  const { s, label, last4 } = await read("bank-chase.pdf");
  assert.deepEqual([label, last4, s.period], ["Chase-Checking", "3645", { from: "2026-10-01", to: "2026-10-31" }]);
  assert.deepEqual(rows(s), [["2026-10-02", 245000], ["2026-10-16", 138025], ["2026-10-07", -60000], ["2026-10-21", -12999], ["2026-10-09", -321040], ["2026-10-23", -8417], ["2026-10-31", -1500]]);
  assert.deepEqual(s.txns.slice(2, 4).map((t) => t.num), ["1047", "1048"]);
  assert.equal(s.check.ok, true); assert.equal(s.skipped.length, 0);
});

test("Bank of America-style: signed amounts, two-digit years, check number after the date, account number printed in groups", async () => {
  const { s, label, last4 } = await read("bank-bofa.pdf");
  assert.deepEqual([label, last4], ["BofA-Checking", "5358"]);
  assert.deepEqual(rows(s), [["2026-10-03", 410000], ["2026-10-06", -120000], ["2026-10-14", -21388], ["2026-10-12", -35000], ["2026-10-31", -1600]]);
  assert.equal(s.txns[3]!.num, "2051");
  assert.equal(s.check.ok, true); assert.equal(s.skipped.length, 0);
});

test("Wells Fargo-style: unsigned amounts placed by column under a two-line header, balance only on a day's last line, checks summary not counted twice", async () => {
  const { s, label, last4 } = await read("bank-wells.pdf");
  assert.deepEqual([label, last4, s.period], ["WellsFargo-Checking", "0011", { from: "2026-10-01", to: "2026-10-31" }]);
  assert.deepEqual(rows(s), [["2026-10-02", 92500], ["2026-10-02", 18010], ["2026-10-06", -23145], ["2026-10-14", -41000], ["2026-10-14", 112], ["2026-10-20", -9550]]);
  assert.equal(s.check.ok, true); assert.equal(s.skipped.length, 0);
});

test("Capital One-style card: month-name dates, the posting date is used, a sign printed apart from the $ is read", async () => {
  const { s, label, last4 } = await read("card-capone.pdf");
  assert.deepEqual([label, last4, s.card, s.period], ["CapitalOne-Credit-Card", "4567", true, { from: "2026-09-22", to: "2026-10-21" }]);
  assert.deepEqual(rows(s), [["2026-10-03", -50000], ["2026-09-26", 650], ["2026-10-01", 48720], ["2026-10-13", 1599], ["2026-10-19", 23477]]);
  assert.equal(s.txns[0]!.desc, "CAPITAL ONE AUTOPAY PYMT");
  assert.equal(s.check.ok, true);
});

test("Citi-style savings: single-line Debits / Credits / Balance header, a period whose start has no year", async () => {
  const { s, label } = await read("bank-citi.pdf");
  assert.equal(label, "Citi-Savings");
  assert.deepEqual(rows(s), [["2026-10-01", 100000], ["2026-10-15", -40000], ["2026-10-31", 1874]]);
  assert.equal(s.check.ok, true);
});

test("CR / DR suffixes, typographic minus, plus sign and ISO dates", () => {
  const s = parseStatement(["Statement period 2026-03-01 to 2026-03-31", "Beginning balance 100.00", "2026-03-02 PAYROLL 50.00 CR", "2026-03-03 FEE 5.00 DR", "2026-03-04 SAAS −$20.00", "2026-03-05 REFUND +$1.00", "Ending balance 126.00"]);
  assert.deepEqual(rows(s), [["2026-03-02", 5000], ["2026-03-03", -500], ["2026-03-04", -2000], ["2026-03-05", 100]]);
  assert.equal(s.check.ok, true);
  assert.deepEqual(["−12.50", "– 3.00", "+4.00", "7.25 CR", "7.25DR"].map(toCents), [-1250, -300, 400, 725, 725]);
});

test("card: CR marks a credit; two numeric dates use the posting date", () => {
  const s = parseStatement(["Minimum Payment Due $25.00", "Billing Period: 11/16/26 - 12/15/26", "Previous Balance $100.00", "Sale Post Description Amount", "11/30 12/01 ACME HARDWARE 40.00", "12/04 12/05 RETURN ACME 10.00 CR", "New Balance $130.00"]);
  assert.deepEqual(rows(s), [["2026-12-01", 4000], ["2026-12-05", -1000]]);
  assert.equal(s.check.ok, true);
});

test("month-name dates roll the year over a December-January statement", () => {
  const s = parseStatement(["Statement Period: Dec 16, 2026 - Jan 15, 2027", "Previous Balance 0.00", "Minimum Payment Due 10.00", "Transactions", "Dec 20 Dec 21 STORE A 10.00", "Jan 3 Jan 4 STORE B 5.00", "New Balance 15.00"]);
  assert.deepEqual(rows(s), [["2026-12-21", 1000], ["2027-01-04", 500]]);
});

test("period from 'Beginning balance on' / 'Ending balance on' across a year end", () => {
  const s = parseStatement(["January 15, 2027", "Beginning balance on 12/16  $10.00", "Ending balance on 1/15  $10.00"]);
  assert.deepEqual(s.period, { from: "2026-12-16", to: "2027-01-15" });
});

test("bank name: from the header, not from a payee further down; footer legal name when the header has none; unknown bank gives null", () => {
  assert.equal(detectLabel(["Wells Fargo Everyday Checking", "Account number 123456", "10/2  CHASE CREDIT CRD AUTOPAY  100.00"], false), "WellsFargo-Checking");
  assert.equal(detectLabel(["Your statement", "10/2  AMEX EPAYMENT  100.00", "Member FDIC  Truist Bank"], false), "Truist-Checking");
  assert.equal(detectLabel(["Business Money Market", "Statement", "Equal Housing Lender  Citizens Bank, N.A."], false), "Citizens-Money-Market");
  assert.equal(detectLabel(["Your statement", "10/2  CHASE CREDIT CRD AUTOPAY  100.00"], false), null, "a payee alone is not the bank");
  assert.equal(detectLabel(["Platinum Card", "American Express"], true), "Amex-Credit-Card");
});

test("words that start like a month are not read as dates", () => {
  const s = parseStatement(["Period 05/01/2026 - 05/31/2026", "Beginning balance 0.00", "Deposits", "05/02 CLIENT A 10.00", "MARKETING 5 SERVICES", "Ending balance 10.00"]);
  assert.deepEqual(rows(s), [["2026-05-02", 1000]]);
  assert.equal(s.txns[0]!.desc, "CLIENT A MARKETING 5 SERVICES");
});
