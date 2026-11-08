import { test } from "node:test";
import assert from "node:assert/strict";
import { accountLast4, cleanLabel, statementName } from "../src/naming.ts";

test("naming: account last 4 from common statement phrasings", () => {
  assert.equal(accountLast4(["Account Number: XXXXXX1234"]), "1234");
  assert.equal(accountLast4(["Account ending in 9876"]), "9876");
  assert.equal(accountLast4(["Acct # ****5555"]), "5555");
  assert.equal(accountLast4(["Account number 000123456789"]), "6789");
  assert.equal(accountLast4(["Business Checking", "no number here"]), null);
});

test("naming: standard name from period end, label cleaning, collision suffix", () => {
  assert.equal(statementName("Acct1234", "2026-10-31"), "202610_Acct1234_Statement.pdf");
  assert.equal(statementName("Operating / Checking!", "2026-01-31"), "202601_Operating-Checking_Statement.pdf");
  const taken = new Set(["202610_A_Statement.pdf", "202610_A_Statement-2.pdf"]);
  assert.equal(statementName("A", "2026-10-31", taken), "202610_A_Statement-3.pdf");
  assert.equal(cleanLabel("../../etc/passwd"), "etc-passwd");
  assert.throws(() => statementName("///", "2026-10-31"));
  assert.throws(() => statementName("A", "Oct 2026"));
});
