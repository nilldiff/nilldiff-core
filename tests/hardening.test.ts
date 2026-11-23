import { test } from "node:test";
import assert from "node:assert/strict";
import { CsvLimit, parseCsv, toCsv } from "../src/csv.ts";
import { readSheet, TableError, type Table } from "../src/table.ts";
import { suggestMapping } from "../src/mapping.ts";
import { pdfLayout } from "../src/pdftext.ts";
import { manyPiecesPdf } from "./hostile.ts";
import { readXlsx } from "../src/xlsx.ts";
import { strToU8, zipSync } from "fflate";

/** Splits a CSV line the way a spreadsheet set to a semicolon (or tab) separator would: quotes respected. */
const cellsBy = (line: string, d: string): string[] => { const out: string[] = []; let c = "", q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) { out.push(c); c = ""; } else c += ch; } out.push(c); return out; };

test("export: a field holding ; or a tab is quoted, so a semicolon or tab spreadsheet never starts a cell with a formula", () => {
  const line = toCsv([["Note", "Other"], ["x;=HYPERLINK(\"http://x.invalid\")", "y\t@SUM(1)"]]).split("\r\n")[1]!;
  for (const d of [";", "\t"]) for (const c of cellsBy(line, d)) assert.doesNotMatch(c, /^[=+\-@]/, `a cell split on ${JSON.stringify(d)} starts a formula: ${c}`);
});

test("csv limits: rows and cells are counted while parsing, so a hostile file stops before it fills memory", () => {
  assert.throws(() => parseCsv("a,b\n".repeat(1000), 100), CsvLimit);
  assert.throws(() => parseCsv(",".repeat(10_000), Infinity, 1000), CsvLimit);
  assert.equal(parseCsv("a,b\n1,2\n", 2, 4).length, 2); // at the limit is fine
  // through the file reader: one line of 9 million empty cells is refused with a plain message
  assert.throws(() => readSheet("wide.csv", new TextEncoder().encode(",".repeat(9_000_000))), (e: unknown) => e instanceof TableError && /cells/.test(e.message));
});

test("key detection: a wide table of unique text columns is bounded and still finds the ID column", () => {
  const N = 30_000, C = 60, idAt = 47;
  const t = (f: string): Table => ({ file: f, origin: "csv", headers: Array.from({ length: C }, (_, j) => (j === idAt ? "Order ID" : `Text ${j}`)), rows: Array.from({ length: N }, (_, i) => Array.from({ length: C }, (_, j) => (j === idAt ? `O-${i}` : `${f}${j}-${i}`))), dropped: 0 });
  const A = t("a"), B = t("b"), s = performance.now(), m = suggestMapping(A, B), ms = performance.now() - s;
  assert.deepEqual(m.key, { a: idAt, b: idAt, overlap: 1 });
  assert.ok(ms < 6000, `key detection took ${Math.round(ms)} ms`); // about 0.5 s now; columns × columns × rows took over 10 s
});

test("pdf: more than 500,000 pieces of text is refused before they are grouped into lines", async () => {
  await assert.rejects(pdfLayout(manyPiecesPdf(520_000)), /more than 500,000 pieces of text/);
  assert.ok((await pdfLayout(manyPiecesPdf(1000))).lines.length > 0); // a normal page still reads
});

const sheet1 = (rows: string) => zipSync({ "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'), "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`) });
test("xlsx: one cell on row 1,048,576 is refused, not made into a million rows; a few empty rows keep their numbers", () => {
  assert.throws(() => readXlsx(sheet1('<row r="1048576"><c r="A1048576" t="inlineStr"><is><t>x</t></is></c></row>')), /more than 100,000 empty rows/);
  assert.deepEqual(readXlsx(sheet1('<row r="3"><c r="B3" t="inlineStr"><is><t>x</t></is></c></row>')), [[], [], ["", "x"]]);
});
test("xlsx: a character reference outside Unicode or a lone surrogate reads as U+FFFD (it threw)", () => {
  assert.deepEqual(readXlsx(sheet1('<row r="1"><c r="A1" t="str"><v>a&#x99999999;b&#xD800;c&#65;</v></c></row>')), [["a�b�cA"]]);
});
test("csv out: a formula after leading spaces is neutralised too", () => {
  assert.equal(toCsv([[" =HYPERLINK(\"x\")", "  +1+1", "-5.25"]]).slice(1), `"' =HYPERLINK(""x"")",'  +1+1,-5.25`);
});
