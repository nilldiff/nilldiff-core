import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { isArchive, LIMITS, unzipArchive, withoutClutter } from "../src/unpack.ts";
import { writeXlsx } from "../src/xlsxw.ts";

const z = (files: Record<string, Uint8Array | string>, level: 0 | 6 = 6) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])), { level });

test("zip: every file inside (folders kept in the name), zips inside zips whatever they're called, clutter left out", () => {
  const inner = z({ "nov/stmt-nov.pdf": "%PDF-1.4 nov", "notes.docx": "x" });
  const r = unzipArchive(z({ "2026/oct/stmt.pdf": "%PDF-1.4 oct", "ledger.csv": "Date,Amount\n", "history.xlsx": "PK..", "logo.png": "png", "__MACOSX/2026/._stmt.pdf": "junk", ".DS_Store": "junk", "Thumbs.db": "junk", "empty/": "", "more.bin": inner }), "client.zip");
  assert.deepEqual(r.files.map((f) => f.name).sort(), ["2026/oct/stmt.pdf", "history.xlsx", "ledger.csv", "logo.png", "notes.docx", "nov/stmt-nov.pdf"]);
  assert.equal(new TextDecoder().decode(r.files.find((f) => f.name === "2026/oct/stmt.pdf")!.bytes), "%PDF-1.4 oct");
});

test("zip: an Excel workbook is a zip too, but it is read as a workbook, not opened", () => {
  assert.equal(isArchive(writeXlsx([{ name: "S", rows: [["a"]] }])), false);
  assert.equal(isArchive(z({ "a.pdf": "%PDF" })), true);
  assert.equal(isArchive(strToU8("Date,Amount")), false);
});

test("zip: limits on files, sizes (counted as they come out, so a zip can't lie about them) and nesting; damage named", () => {
  const was = { ...LIMITS };
  try {
    LIMITS.entries = 3; assert.throws(() => unzipArchive(z({ "1.csv": "a", "2.csv": "a", "3.csv": "a", "4.csv": "a" }), "many.zip"), /many\.zip can't be opened: it holds more than 3 files/);
    LIMITS.entries = 1000; LIMITS.file = 1 << 20;
    const bomb = z({ "big.csv": new Uint8Array(5 << 20) }); // 5 MB of zeros squeezes into a few KB
    assert.ok(bomb.length < 20_000);
    assert.throws(() => unzipArchive(bomb, "bomb.zip"), /bomb\.zip can't be opened: big\.csv is larger than 1 MB/);
    // Lie about the size in both headers: still stopped by what comes out
    const liar = bomb.slice(), v = new DataView(liar.buffer);
    for (let o = 0; o < liar.length - 4; o++) { const sig = v.getUint32(o, true); if (sig === 0x04034b50) v.setUint32(o + 22, 10, true); if (sig === 0x02014b50) v.setUint32(o + 24, 10, true); }
    assert.throws(() => unzipArchive(liar, "liar.zip"), /larger than 1 MB|damaged/);
    LIMITS.file = 64 << 20; LIMITS.total = 3 << 20;
    const a = z({ "a.csv": new Uint8Array(2 << 20) }), b = z({ "b.csv": new Uint8Array(2 << 20) });
    assert.throws(() => unzipArchive(z({ "a.zip": a, "b.zip": b }, 0), "nested.zip"), /add up to more than 3 MB/, "the budget is shared with zips inside");
    LIMITS.total = 300 << 20;
    let deep: Uint8Array = z({ "x.csv": "a" }); for (let i = 0; i < 4; i++) deep = z({ [`l${i}.zip`]: deep }, 0);
    assert.throws(() => unzipArchive(deep, "deep.zip"), /nested more than 3 deep/);
    const cut = z({ "a.csv": "x".repeat(5000) }).slice(0, 60);
    assert.throws(() => unzipArchive(cut, "cut.zip"), /cut\.zip can't be opened/);
  } finally { Object.assign(LIMITS, was); }
});

test("folders: a picked or dropped folder loses only the clutter", () => {
  const r = withoutClutter(["Client/Oct/stmt.pdf", "Client/.hidden", "Client/Oct/scan.JPG", "Client/ledger.XLS", "Client/__MACOSX/x.pdf", "Client/Thumbs.db"].map((name) => ({ name })));
  assert.deepEqual(r.map((x) => x.name), ["Client/Oct/stmt.pdf", "Client/Oct/scan.JPG", "Client/ledger.XLS"]);
});
