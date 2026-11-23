import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSheet, TableError } from "../src/table.ts";
import { isXls } from "../src/xls.ts";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));

test("formats: an Excel 97-2003 .xls reads like any sheet (first sheet, numbers as text, dates as serials the date reader takes)", () => {
  const t = readSheet("old.xls", fx("small.xls"));
  assert.equal(t.origin, "xls");
  assert.deepEqual(t.headers, ["Date", "Description", "Amount", "Qty", "Note"]);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0]!.slice(1, 4), ["FUEL STOP 221 BOISE ID", "-64.12", "3"]);
  assert.equal(readSheet("f.xls", fx("formulas.xls")).origin, "xls");
});

test("formats: a damaged .xls is refused with a plain reason, never a hang", () => {
  const b = fx("small.xls").slice(); b.fill(0xff, 600, 2000); assert.ok(isXls(b));
  assert.throws(() => readSheet("bad.xls", b), (e: Error) => e instanceof TableError && /bad\.xls/.test(e.message));
});

test("formats: tab-separated text saved as UTF-16 (Unicode text) and Windows-1252 text read like CSV", () => {
  const tsv = "Id\tName\tAmount\r\n1\tCafé ✓\t10.50\r\n2\tB\t3\r\n", u16 = new Uint8Array([0xff, 0xfe, ...new Uint8Array(new Uint16Array([...tsv].map((c) => c.charCodeAt(0))).buffer)]);
  const t = readSheet("unicode.txt", u16);
  assert.deepEqual(t.headers, ["Id", "Name", "Amount"]); assert.deepEqual(t.rows[0], ["1", "Café ✓", "10.50"]);
  const w1252 = new Uint8Array([...new TextEncoder().encode("Id,Name\n1,Caf"), 0xe9, 0x0a, ...new TextEncoder().encode("2,B\n")]);
  assert.deepEqual(readSheet("latin.csv", w1252).rows[0], ["1", "Café"]);
});
