import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toCents, fmtCents, fmtPct } from "../src/money.ts";
import { toIsoDate, toMonth } from "../src/dates.ts";
import { parseCsv, toCsv } from "../src/csv.ts";
import { parseLedger } from "../src/parse.ts";
import { reconcile } from "../src/reconcile.ts";
import { readXlsx, isXlsx } from "../src/xlsx.ts";
import type { Txn } from "../src/parse.ts";

const t = (id: string, date: string, cents: number, desc = "", num = ""): Txn => ({ id, date, cents, desc, num });

test("money: parsing is exact in integer cents", () => {
  const cases: [string | number, number | null][] = [["$1,234.56", 123456], ["(50.00)", -5000], ["1.005", 101], ["1234.5600000000002", 123456], ["-0.01", -1], [".5", 50], ["12-", -1200], ["abc", null], ["-", null], ["", null], [19.99, 1999]];
  for (const [i, o] of cases) assert.equal(toCents(i), o, String(i));
  assert.equal(fmtCents(-123456), "(1,234.56)");
  assert.equal(fmtPct(0.5), "+50.0%");
  assert.equal(fmtPct(null), "n/a");
});

test("dates: formats, invalid dates and Excel serials", () => {
  assert.equal(toIsoDate("2026-10-01"), "2026-10-01");
  assert.equal(toIsoDate("10/1/2026"), "2026-10-01");
  assert.equal(toIsoDate("10/01/26"), "2026-10-01");
  assert.equal(toIsoDate("Oct 1, 2026"), "2026-10-01");
  assert.equal(toIsoDate("46296"), "2026-10-01");
  assert.equal(toIsoDate("2/30/2026"), null);
  assert.equal(toIsoDate("Total"), null);
  assert.equal(toMonth("Oct 2026"), "2026-10");
  assert.equal(toMonth("October 2026"), "2026-10");
  assert.equal(toMonth("Oct-26"), "2026-10");
  assert.equal(toMonth("2026-13"), null);
  assert.equal(toMonth("Total"), null);
});

test("csv: quotes, CRLF, BOM, delimiters, and formula guard on export", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.deepEqual(parseCsv("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  assert.equal(toCsv([["=SUM(A1)", "-5", "ok", 'q"x']]), '﻿\'=SUM(A1),-5,ok,"q""x"');
});

test("parse: QuickBooks export with title rows, totals and skipped rows", () => {
  const rows = parseCsv(`Acme LLC\nTransaction List\n\nDate,Transaction type,Num,Name,Memo/Description,Amount\n10/01/2026,Deposit,,Stripe,Payout,"1,234.56"\n10/03/2026,Check,1001,Landlord,Rent,-2500.00\n10/04/2026,Check,1002,Bad,Row,abc\nTotal,,,,,-1265.44\n`);
  const p = parseLedger(rows, "qbo");
  assert.equal(p.headerRow, 4);
  assert.deepEqual(p.txns.map((x) => [x.date, x.cents, x.desc, x.num]), [["2026-10-01", 123456, "Stripe Payout", ""], ["2026-10-03", -250000, "Landlord Rent", "1001"]]);
  assert.deepEqual(p.skipped.map((s) => [s.row, s.reason]), [[7, "no readable amount"], [8, "no date (total or note row)"]]);
  assert.equal(p.txns[1]!.id, "qbo:6");
});

test("parse: bank debit/credit columns, invert option, and a plain error on bad files", () => {
  const rows = parseCsv("Posting Date,Description,Debit,Credit\n2026-10-01,ACH STRIPE,,1234.56\n2026-10-03,CHECK 1001,2500.00,\n");
  assert.deepEqual(parseLedger(rows, "bank").txns.map((x) => x.cents), [123456, -250000]);
  assert.deepEqual(parseLedger(rows, "bank", { invert: true }).txns.map((x) => x.cents), [-123456, 250000]);
  assert.throws(() => parseLedger([["foo", "bar"]], "bank"), /no header row/);
});

test("xlsx: shared strings, entities, serial dates, and totals row", () => {
  const b = new Uint8Array(readFileSync(new URL("./fixtures/qbo.xlsx", import.meta.url)));
  assert.ok(isXlsx(b));
  const rows = readXlsx(b);
  assert.equal(rows[0]![0], "Acme & Sons LLC");
  assert.deepEqual(rows[2], []);
  assert.equal(rows[3]![0], "Date");
  const p = parseLedger(rows, "qbo");
  assert.deepEqual(p.txns.map((x) => [x.date, x.cents, x.desc]), [["2026-10-01", 123456, "Stripe Payout Oct 1 <batch>"], ["2026-10-03", -250000, "Landlord & Co Rent"]]);
  assert.throws(() => readXlsx(new Uint8Array([0x50, 0x4b, 1, 2, 3])));
  assert.equal(isXlsx(new TextEncoder().encode("Date,Amount")), false);
});

test("reconcile: exact amount within window, prefers closest date and matching description", () => {
  const q = [t("q1", "2026-10-01", 5000, "Office Depot"), t("q2", "2026-10-02", 5000, "Shell Gas")];
  const b = [t("b1", "2026-10-02", 5000, "SHELL OIL 123"), t("b2", "2026-10-03", 5000, "OFFICE DEPOT #9")];
  const r = reconcile(q, b);
  const pair = (id: string) => r.matched.find((m) => m.qbo[0]!.id === id)!.bank[0]!.id;
  assert.equal(pair("q1"), "b2");
  assert.equal(pair("q2"), "b1");
  assert.equal(r.unmatchedQbo.length + r.unmatchedBank.length, 0);
});

test("reconcile: check number breaks ties; outside the window never matches", () => {
  const r = reconcile([t("q1", "2026-10-01", -100, "x", "1001"), t("q2", "2026-10-01", -100, "x", "1002")], [t("b1", "2026-10-01", -100, "CHECK", "1002"), t("b2", "2026-10-01", -100, "CHECK", "1001")]);
  assert.equal(r.matched.find((m) => m.qbo[0]!.id === "q1")!.bank[0]!.id, "b2");
  const far = reconcile([t("q", "2026-10-01", 777)], [t("b", "2026-10-20", 777)]);
  assert.equal(far.matched.length, 0);
  assert.equal(far.unmatchedQbo.length, 1);
  assert.equal(far.unmatchedBank.length, 1);
});

test("reconcile: batched deposit (N:1) and split (1:N)", () => {
  const nTo1 = reconcile([t("q1", "2026-10-01", 10000), t("q2", "2026-10-02", 25000), t("q3", "2026-10-02", 5000)], [t("b1", "2026-10-03", 40000, "STRIPE PAYOUT")]);
  assert.equal(nTo1.matched.length, 1);
  assert.equal(nTo1.matched[0]!.kind, "N:1");
  assert.equal(nTo1.matched[0]!.qbo.length, 3);
  assert.equal(nTo1.unmatchedQbo.length + nTo1.unmatchedBank.length, 0);
  const oneToN = reconcile([t("q1", "2026-10-01", -30000)], [t("b1", "2026-10-01", -10000), t("b2", "2026-10-02", -20000)]);
  assert.equal(oneToN.matched[0]!.kind, "1:N");
  assert.equal(oneToN.matched[0]!.bank.length, 2);
});

test("reconcile: no false group when sums do not tie, signs differ, or lines are used", () => {
  const r = reconcile([t("q1", "2026-10-01", 10000), t("q2", "2026-10-01", 20000)], [t("b1", "2026-10-01", 30001)]);
  assert.equal(r.matched.length, 0);
  const s = reconcile([t("q1", "2026-10-01", 10000), t("q2", "2026-10-01", -10000), t("q3", "2026-10-01", 0)], [t("b1", "2026-10-01", 0)]);
  assert.equal(s.matched.length, 1);
  assert.equal(s.matched[0]!.qbo[0]!.id, "q3");
});

test("reconcile: totals tie out and results are deterministic", () => {
  const q = [t("q1", "2026-10-01", 5000), t("q2", "2026-10-05", 700), t("q3", "2026-10-06", -300)];
  const b = [t("b1", "2026-10-02", 5000), t("b2", "2026-10-09", 999)];
  const a = reconcile(q, b), c = reconcile([...q].reverse(), [...b].reverse());
  assert.equal(a.qboCents, 5400);
  assert.equal(a.bankCents, 5999);
  assert.equal(a.matchedCents, 5000);
  assert.equal(a.unmatchedQboCents, 400);
  assert.equal(a.unmatchedBankCents, 999);
  assert.deepEqual(a.matched.map((m) => m.bank[0]!.id), c.matched.map((m) => m.bank[0]!.id));
});

