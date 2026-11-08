import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/csv.ts";
import { parseLedger } from "../src/parse.ts";
import { accounts, outsideQbo, pickAccount, sniff } from "../src/scope.ts";

const csv = (n: string) => parseCsv(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));

test("sniff: tells a QuickBooks report, an income statement and a bank export apart from their header rows", () => {
  assert.equal(sniff(csv("qbo-card.csv")), "qbo");
  assert.equal(sniff(csv("pnl.csv")), "pnl");
  assert.equal(sniff(csv("qbo.csv")), "qbo", "the plain QuickBooks fixture carries a Num column and Transaction type");
  assert.equal(sniff([["Date", "Description", "Amount"], ["01/02/2026", "X", "1.00"]]), "bank");
});
test("account: the report's Account Name column is kept, and the statement's last 4 picks the account", () => {
  const q = parseLedger(csv("qbo-card.csv"), "qbo");
  assert.deepEqual(accounts(q.txns), ["Summit Business Card (7123)"]);
  assert.equal(pickAccount(accounts(q.txns), ["7123"]), "Summit Business Card (7123)");
  assert.equal(pickAccount(["Checking (1111)", "Savings (2222)"], ["2222"]), "Savings (2222)");
  assert.equal(pickAccount(["Checking (1111)", "Savings (2222)"], ["9999"]), null, "no match: do not guess");
  assert.equal(pickAccount(["Card (1234) - 1", "Card (1234) - 2"], ["1234"]), null, "two matches: do not guess");
});
test("coverage: statement lines outside the QuickBooks export (plus the window) are counted, inside ones are not", () => {
  const t = (date: string) => ({ id: date, date, cents: 1, desc: "", num: "" });
  const qbo = [t("2026-11-16"), t("2026-12-15")];
  assert.deepEqual(outsideQbo(qbo, [t("2026-11-12"), t("2026-11-08"), t("2026-12-20"), t("2026-12-30"), t("2026-12-01")], 7).map((x) => x.date), ["2026-11-08", "2026-12-30"]);
  assert.deepEqual(outsideQbo([], [t("2026-11-12")], 7), []);
});
