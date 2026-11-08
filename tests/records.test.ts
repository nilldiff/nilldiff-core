import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compare, groupRecords, ledgerRows, readFile, toRecords, FileError, type Rec } from "../src/records.ts";
import type { Txn } from "../src/parse.ts";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const enc = (s: string) => new TextEncoder().encode(s);
let id = 0;
const t = (date: string, cents: number, desc = "x", num = ""): Txn => ({ id: `t${id++}`, date, cents, desc, num });
const rec = (name: string, txns: Txn[], last4: string | null = null, kind: Rec["kind"] = "ledger"): Rec => ({ id: name, kind, name, last4, card: false, sources: [{ file: `${name}.csv`, kind, txns, period: null, last4, name, card: false, skipped: 0, check: null }], txns, from: txns.map((x) => x.date).sort()[0] ?? null, to: txns.map((x) => x.date).sort().at(-1) ?? null });

test("readFile: a PDF statement, a QuickBooks report and an xlsx are told apart by their bytes, not their names", async () => {
  const [pdf] = await readFile("anything.bin", fx("bank-chase.pdf"), 1);
  assert.deepEqual([pdf!.kind, pdf!.name, pdf!.last4, pdf!.txns.length, pdf!.check?.ok], ["statement", "Chase Checking", "3645", 7, true]);
  assert.ok(pdf!.txns.every((x) => x.id.startsWith("1:")), "ids are unique per file");
  const q = await readFile("report.csv", fx("qbo-card.csv"), 2);
  assert.equal(q.length, 1); assert.equal(q[0]!.kind, "ledger"); assert.equal(q[0]!.txns.length, 12);
  const x = await readFile("list.xlsx", fx("qbo.xlsx"), 3);
  assert.ok(x[0]!.txns.length > 0);
  await assert.rejects(readFile("pnl.csv", enc("x,Jan 2026,Feb 2026\nProfit and Loss,,\nSales,1.00,2.00\n")), FileError);
});

test("readFile: a multi-account QuickBooks report splits into one source per account with its last 4", async () => {
  const csv = "Transaction Report\n,Transaction date,Transaction type,Num,Name,Description,Account Name,Amount\n,10/01/2026,Expense,,,RENT,Operating Checking (4410),-100.00\n,10/02/2026,Expense,,,FUEL,Business Card (3008) - 2,-20.00\n,10/03/2026,Deposit,,,SALE,Operating Checking (4410),50.00\n";
  const s = await readFile("qbo.csv", enc(csv));
  assert.deepEqual(s.map((x) => [x.name, x.last4, x.txns.length]), [["Operating Checking (4410)", "4410", 2], ["Business Card (3008) - 2", "3008", 1]]);
});

test("toRecords + groupRecords: monthly statements of one account merge; a ledger without an account number joins the account whose amounts it shares", () => {
  const s1 = { file: "oct.pdf", kind: "statement" as const, txns: [t("2026-10-02", 1000), t("2026-10-05", -250)], period: { from: "2026-10-01", to: "2026-10-31" }, last4: "1111", name: "Chase Checking", card: false, skipped: 0, check: null };
  const s2 = { ...s1, file: "nov.pdf", txns: [t("2026-11-03", -400)], period: { from: "2026-11-01", to: "2026-11-30" } };
  const other = { ...s1, file: "savings.pdf", last4: "2222", name: "Citi Savings", txns: [t("2026-10-09", 777777)] };
  const ledger = { file: "export.csv", kind: "ledger" as const, txns: [t("2026-10-02", 1000), t("2026-10-06", -250), t("2026-11-03", -400)], period: null, last4: null, name: "export", card: false, skipped: 0, check: null };
  const recs = toRecords([s1, s2, other, ledger]);
  assert.equal(recs.length, 3);
  const chase = recs.find((r) => r.last4 === "1111")!;
  assert.deepEqual([chase.sources.length, chase.txns.length, chase.from, chase.to], [2, 3, "2026-10-01", "2026-11-30"]);
  const g = groupRecords(recs);
  assert.deepEqual(g.map((x) => x.map((r) => r.name)), [["Chase Checking", "export"], ["Citi Savings"]]);
});

test("compare: the record that takes precedence keeps its lines; differences come out as missing, only-in-other and amount-differs", () => {
  const ref = rec("Statement", [t("2026-10-02", 100000, "STRIPE PAYOUT"), t("2026-10-05", -25000, "GUSTO PAYROLL"), t("2026-10-09", -1999, "ZOOM US"), t("2026-10-20", -4500, "OFFICE DEPOT")], "1111", "statement");
  const other = rec("QuickBooks", [t("2026-10-03", 100000, "Stripe"), t("2026-10-05", -25000, "Gusto"), t("2026-10-09", -2099, "ZOOM US monthly"), t("2026-10-15", -800, "Bank fee")]);
  const c = compare(ref, other);
  assert.equal(c.flipped, false);
  assert.equal(c.matched.length, 2); assert.equal(c.dateDiffers.length, 1, "Stripe posted a day apart");
  assert.deepEqual(c.conflicts.map((k) => [k.ref.cents, k.other.cents]), [[-1999, -2099]]);
  assert.deepEqual(c.onlyRef.map((x) => x.desc), ["OFFICE DEPOT"]);
  assert.deepEqual(c.onlyOther.map((x) => x.desc), ["Bank fee"]);
  assert.equal(c.deltaCents, (100000 - 25000 - 1999 - 4500) - (100000 - 25000 - 2099 - 800));
  const rows = ledgerRows(c);
  assert.deepEqual(rows[0], ["Date", "Description", "Amount", "Status", "Other date", "Other amount", "Other description", "File"]);
  assert.deepEqual(rows.slice(1).map((r) => [r[0], r[2], r[3]]), [["2026-10-02", 1000, "Matched, date differs"], ["2026-10-05", -250, "Matched"], ["2026-10-09", -19.99, "Amount differs in QuickBooks"], ["2026-10-20", -45, "Missing from QuickBooks"], ["", "", "Only in QuickBooks"]]);
  const swapped = compare(other, ref); // choosing the other record flips what wins
  assert.deepEqual(ledgerRows(swapped).slice(1).map((r) => [r[2], r[3]]), [[1000, "Matched, date differs"], [-250, "Matched"], [-20.99, "Amount differs in Statement"], [-8, "Missing from Statement"], ["", "Only in Statement"]]);
});

test("compare: a record with the opposite sign convention is flipped, and says so", () => {
  const ref = rec("Card statement", [t("2026-10-02", 5000), t("2026-10-04", 1250), t("2026-10-08", -30000)]);
  const other = rec("Card register", [t("2026-10-02", -5000), t("2026-10-04", -1250), t("2026-10-08", 30000)]);
  const c = compare(ref, other);
  assert.equal(c.flipped, true); assert.equal(c.matched.length, 3); assert.equal(c.deltaCents, 0);
});

test("compare: only the dates both records cover are compared; the rest is outside, not missing", () => {
  const ref = rec("Statement", [t("2026-10-02", 100), t("2026-10-20", 200)]);
  ref.from = "2026-10-01"; ref.to = "2026-10-31";
  const other = rec("Ledger", [t("2026-08-01", 999), t("2026-10-02", 100), t("2026-10-20", 200), t("2026-12-30", 50)]);
  const c = compare(ref, other);
  assert.deepEqual([c.matched.length, c.onlyOther.length, c.outsideOther.length, c.deltaCents], [2, 0, 2, 0]);
});

test("end to end on fixtures: the Chase-style statement against a ledger built from it with one change", async () => {
  const [s] = await readFile("chase.pdf", fx("bank-chase.pdf"), 1);
  const lines = s!.txns.filter((x) => x.cents !== -1500).map((x) => `${x.date},"${x.desc}",${(x.cents / 100).toFixed(2)}`).join("\n");
  const [l] = await readFile("ledger.csv", enc(`Date,Description,Amount\n${lines}\n2026-10-30,Late entry,-12.00\n`), 2);
  const [g] = groupRecords(toRecords([s!, l!]));
  assert.equal(g!.length, 2, "the ledger has no account number and joins the statement by its amounts");
  const c = compare(g![0]!, g![1]!);
  assert.deepEqual([c.matched.length, c.onlyRef.map((x) => x.cents), c.onlyOther.map((x) => x.cents)], [6, [-1500], [-1200]]);
});
