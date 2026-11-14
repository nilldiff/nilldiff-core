import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toCents, fmtCents, fmtPct } from "../src/money.ts";
import { toIsoDate, toMonth } from "../src/dates.ts";
import { parseCsv, toCsv } from "../src/csv.ts";
import { readXlsx, isXlsx } from "../src/xlsx.ts";


test("money: parsing is exact in integer cents", () => {
  const cases: [string | number, number | null][] = [["$1,234.56", 123456], ["(50.00)", -5000], ["1.005", 101], ["1234.5600000000002", 123456], ["-0.01", -1], [".5", 50], ["12-", -1200], ["abc", null], ["-", null], ["", null], [19.99, 1999]];
  for (const [i, o] of cases) assert.equal(toCents(i), o, String(i));
  assert.equal(fmtCents(-123456), "(1,234.56)");
  assert.equal(fmtPct(0.5), "+50.0%");
  assert.equal(fmtPct(null), "n/a");
});

test("dates: formats, invalid dates and spreadsheet serial numbers", () => {
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

test("xlsx: shared strings, entities, blank rows, serial dates and a totals row", () => {
  const b = new Uint8Array(readFileSync(new URL("./fixtures/sample.xlsx", import.meta.url)));
  assert.ok(isXlsx(b));
  const rows = readXlsx(b);
  assert.equal(rows[0]![0], "Example & Sons LLC");
  assert.deepEqual(rows[2], []);
  assert.deepEqual(rows[3], ["Date", "Reference", "Amount"]);
  assert.deepEqual(rows.slice(4).map((r) => [toIsoDate(r[0]!) ?? r[0], r[1], toCents(r[2]!)]), [["2026-10-01", "INV-1 <batch>", 123456], ["2026-10-03", "INV-2", -250000], ["Total", "", -126544]]);
  assert.throws(() => readXlsx(new Uint8Array([0x50, 0x4b, 1, 2, 3])));
  assert.equal(isXlsx(new TextEncoder().encode("Date,Amount")), false);
});

