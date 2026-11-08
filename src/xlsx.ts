import { unzipSync } from "fflate";

const MAX_CELLS = 2_000_000, MAX_PART = 64 * 1024 * 1024, MAX_TOTAL = 128 * 1024 * 1024, MAX_SHEETS = 64, MAX_COL = 16384;
const td = new TextDecoder();
const unesc = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]!);
const col = (ref: string): number => {
  const n = [...ref].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
  if (ref.length > 3 || n > MAX_COL) throw new Error("xlsx column out of range");
  return n - 1;
};
/** Linear scan for <tag ...>body</tag> and <tag .../> (no backtracking, so hostile files cannot stall the page). Yields [attributes, body]. */
function* each(x: string, tag: string): Generator<[string, string]> {
  const open = `<${tag}`, close = `</${tag}>`;
  for (let i = 0; ;) {
    i = x.indexOf(open, i); if (i < 0) return;
    const c = x[i + open.length];
    if (c !== " " && c !== ">" && c !== "/") { i += open.length; continue; }
    const gt = x.indexOf(">", i); if (gt < 0) return;
    if (x[gt - 1] === "/") { yield [x.slice(i + open.length, gt - 1), ""]; i = gt + 1; continue; }
    const e = x.indexOf(close, gt); if (e < 0) return;
    yield [x.slice(i + open.length, gt), x.slice(gt + 1, e)]; i = e + close.length;
  }
}
const texts = (x: string): string => [...each(x, "t")].map((m) => unesc(m[1])).join("");

export const isXlsx = (b: Uint8Array): boolean => b[0] === 0x50 && b[1] === 0x4b;

/** First worksheet of an .xlsx as rows of strings (row numbers match the sheet; empty rows are empty arrays). Reads only the parts it needs and refuses oversized parts. */
export const readXlsx = (bytes: Uint8Array): string[][] => {
  const want = (n: string) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n);
  let total = 0, sheets = 0;
  const z = unzipSync(bytes, { filter: (f) => {
    if (f.originalSize > MAX_PART) throw new Error("xlsx part too large");
    if (!want(f.name)) return false;
    if ((total += f.originalSize) > MAX_TOTAL || ++sheets > MAX_SHEETS) throw new Error("xlsx is too large to read safely");
    return true;
  } });
  const get = (n: string) => (z[n] ? td.decode(z[n]) : "");
  const wb = get("xl/workbook.xml"), rels = get("xl/_rels/workbook.xml.rels");
  const rid = [...each(wb, "sheet")].map((s) => /\br:id="([^"]+)"/.exec(s[0])?.[1]).find(Boolean);
  const target = rid && [...each(rels, "Relationship")].find((r) => /\bId="([^"]+)"/.exec(r[0])?.[1] === rid)?.[0].match(/\bTarget="([^"]+)"/)?.[1];
  const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : "xl/worksheets/sheet1.xml";
  const sheet = get(path);
  if (!sheet) throw new Error("xlsx has no readable worksheet");
  const ss = [...each(get("xl/sharedStrings.xml"), "si")].map((m) => texts(m[1]));
  const rows: string[][] = [];
  let total_cells = 0;
  for (const r of each(sheet, "row")) {
    const cells: string[] = [];
    for (const [a, body] of each(r[1], "c")) {
      const ref = /\br="([A-Z]+)\d+"/.exec(a)?.[1];
      const t = /\bt="([^"]+)"/.exec(a)?.[1], v = [...each(body, "v")][0]?.[1] ?? "";
      cells[ref ? col(ref) : cells.length] = t === "s" ? (ss[+v] ?? "") : t === "inlineStr" ? texts(body) : unesc(v);
    }
    const n = Number(/\br="(\d+)"/.exec(r[0])?.[1] ?? rows.length + 1);
    if (n > 1_048_576) throw new Error("xlsx row number out of range");
    if ((total_cells += cells.length) > MAX_CELLS) throw new Error("xlsx is too large to read safely"); // rows are made dense up to their last column
    rows[n - 1] = Array.from(cells, (x) => x ?? "");
  }
  return Array.from(rows, (r) => r ?? []);
};
