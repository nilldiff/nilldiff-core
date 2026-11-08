import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export class PdfError extends Error {}
/** In a browser, where the PDF.js worker file is served (e.g. "/pdf.worker.mjs"). Set once before the first PDF is read. */
export const setPdfWorker = (url: string): void => { pdfjs.GlobalWorkerOptions.workerSrc = url; };
const MAX_PAGES = 60, MAX_LINES = 50_000;

/** Text of a text-based PDF as visual lines (top to bottom, items left to right, wide gaps kept as two spaces). Nothing in the PDF is executed. */
export interface Layout { lines: string[]; cells: Cell[][] }
/** Text lines plus, for each line, its cells (runs of text separated by wide gaps) with their left and right x, so a parser can tell which column an amount sits in. */
export const pdfLayout = async (bytes: Uint8Array): Promise<Layout> => {
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => {});
    throw new PdfError((e as { name?: string }).name === "PasswordException" ? "This PDF is password protected. Download an unprotected copy from online banking." : "This file could not be read as a PDF.");
  }
  try {
    if (doc.numPages > MAX_PAGES) throw new PdfError(`This PDF has ${doc.numPages} pages; the limit is ${MAX_PAGES}.`);
    const cells: Cell[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const items = (await (await doc.getPage(p)).getTextContent()).items.flatMap((i) => ("str" in i && i.str.trim() ? [{ s: i.str, x: i.transform[4] as number, y: i.transform[5] as number, w: i.width }] : []));
      cells.push(...groupCells(items));
      if (cells.length > MAX_LINES) throw new PdfError(`This PDF has more than ${MAX_LINES} lines of text, more than a real statement; it was not read.`);
    }
    if (!cells.length) throw new PdfError("This PDF has no readable text (likely a scanned image). Scanned statements are not supported yet.");
    return { lines: cells.map(joinCells), cells };
  } finally { await task.destroy(); }
};

export const pdfLines = async (bytes: Uint8Array): Promise<string[]> => (await pdfLayout(bytes)).lines;

export interface TextItem { s: string; x: number; y: number; w: number }
export interface Cell { s: string; x0: number; x1: number }
const joinCells = (r: Cell[]): string => r.map((c) => c.s).join("  ").trim().slice(0, 400);
/** Joins text items into lines: items within 2.5 units of height form one line, read left to right; a gap wider than 6 units starts a new cell. Linear after the sort. */
export const groupCells = (items: TextItem[]): Cell[][] => {
  const rows: { y: number; it: TextItem[] }[] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    const r = rows.at(-1); // sorted top to bottom, so only the last row can be within 2.5 units (a scan of every row was quadratic)
    if (r && Math.abs(r.y - it.y) <= 2.5) r.it.push(it); else rows.push({ y: it.y, it: [it] });
  }
  return rows.map((r) => {
    const out: Cell[] = [];
    for (const it of r.it.sort((a, b) => a.x - b.x)) {
      const c = out.at(-1);
      if (c && it.x - c.x1 <= 6) { c.s += (it.x - c.x1 > 0.5 ? " " : "") + it.s; c.x1 = it.x + it.w; } else out.push({ s: it.s, x0: it.x, x1: it.x + it.w });
    }
    return out.flatMap((c) => (c.s.trim() ? [{ ...c, s: c.s.trim() }] : []));
  });
};
export const groupLines = (items: TextItem[]): string[] => groupCells(items).map(joinCells);
