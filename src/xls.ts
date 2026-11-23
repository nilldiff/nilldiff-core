/**
 * Reads the first worksheet of an Excel 97-2003 .xls (BIFF8 inside a compound file) as rows of strings, the same contract as
 * readXlsx: numbers as plain number text, dates as their serial number (toIsoDate reads those), text as is.
 * It is written for files from outside (an accounting export, an old workbook), so every length, offset and chain is
 * checked: a damaged or hostile file gives a plain error, never a hang or an out-of-range read.
 */
const MAX_BYTES = 64 * 1024 * 1024, MAX_CELLS = 2_000_000, END = 0xfffffffe, FREE = 0xffffffff;

export const isXls = (b: Uint8Array): boolean => b.length >= 512 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

const bad = (why: string): never => { throw new Error(`this .xls can't be read: ${why}. Save it as .xlsx or CSV and try again.`); };

/** The compound file's "Workbook" stream (or "Book" from Excel 5, refused below as too old). */
const workbookStream = (b: Uint8Array): Uint8Array => {
  if (b.length > MAX_BYTES) bad("it is larger than 64 MB");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), u32 = (o: number) => (o + 4 <= b.length ? v.getUint32(o, true) : bad("it is cut short"));
  const shift = v.getUint16(30, true), miniShift = v.getUint16(32, true);
  if (shift !== 9 && shift !== 12) bad("unknown sector size");
  const size = 1 << shift, sectors = Math.floor((b.length - size) / size), at = (s: number) => (s < sectors ? size + s * size : bad("a sector points outside the file"));
  // The FAT: its sectors are listed in the header (109) and then in DIFAT sectors.
  const fatSecs: number[] = [];
  for (let i = 0; i < 109; i++) { const s = u32(76 + i * 4); if (s !== FREE && s !== END) fatSecs.push(s); }
  for (let d = u32(68), n = 0; d !== END && d !== FREE && fatSecs.length < sectors; d = u32(at(d) + size - 4)) {
    if (++n > sectors) bad("its sector list loops");
    for (let i = 0; i < size / 4 - 1; i++) { const s = u32(at(d) + i * 4); if (s !== FREE && s !== END) fatSecs.push(s); }
  }
  const fat = new Uint32Array(fatSecs.length * (size / 4));
  fatSecs.forEach((s, k) => { for (let i = 0; i < size / 4; i++) fat[k * (size / 4) + i] = u32(at(s) + i * 4); });
  const chain = (start: number, table: Uint32Array): number[] => {
    const out: number[] = [];
    for (let s = start; s !== END; s = table[s] ?? bad("a sector chain leaves the table")) { if (out.length > table.length) bad("a sector chain loops"); out.push(s); }
    return out;
  };
  const read = (start: number, len: number) => { const out = new Uint8Array(len); let o = 0; for (const s of chain(start, fat)) { if (o >= len) break; const n = Math.min(size, len - o); out.set(b.subarray(at(s), at(s) + n), o); o += n; } if (o < len) bad("a stream is cut short"); return out; };
  const dirSecs = chain(u32(48), fat), dir = new Uint8Array(dirSecs.length * size); dirSecs.forEach((s, i) => dir.set(b.subarray(at(s), at(s) + size), i * size));
  const dv = new DataView(dir.buffer), entries = Array.from({ length: dir.length / 128 }, (_, i) => i * 128).map((o) => ({
    name: String.fromCharCode(...Array.from({ length: Math.max(0, Math.min(32, dv.getUint16(o + 64, true)) / 2 - 1) }, (_, k) => dv.getUint16(o + k * 2, true))),
    type: dv.getUint8(o + 66), start: dv.getUint32(o + 116, true), size: dv.getUint32(o + 120, true) }));
  const root = entries[0], wb = entries.find((e) => e.type === 2 && e.name === "Workbook");
  if (!wb) bad(entries.some((e) => e.name === "Book") ? "it is from Excel 95 or older" : "it has no workbook in it");
  if (wb!.size > MAX_BYTES) bad("its workbook is larger than 64 MB");
  if (wb!.size >= u32(56)) return read(wb!.start, wb!.size); // at or over the mini-stream cutoff (4096): regular sectors
  // Small workbooks live in the mini stream: 64-byte sectors inside the root entry's stream, with their own FAT.
  const msize = 1 << miniShift, mini = read(root!.start, root!.size), mfSecs = chain(u32(60), fat), mfat = new Uint32Array(mfSecs.length * (size / 4));
  mfSecs.forEach((s, k) => { for (let i = 0; i < size / 4; i++) mfat[k * (size / 4) + i] = u32(at(s) + i * 4); });
  const out = new Uint8Array(wb!.size); let o = 0;
  for (const s of chain(wb!.start, mfat)) { if (o >= out.length) break; if ((s + 1) * msize > mini.length) bad("a small sector points outside the file"); const n = Math.min(msize, out.length - o); out.set(mini.subarray(s * msize, s * msize + n), o); o += n; }
  if (o < out.length) bad("the workbook is cut short");
  return out;
};

/** Number from an RK value: a 30-bit integer or the top of a double, optionally divided by 100. */
const rk = (x: number): number => { const n = x & 2 ? x >> 2 : new DataView(new Uint32Array([0, x & 0xfffffffc]).buffer).getFloat64(0, true); return x & 1 ? n / 100 : n; };
const num = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1e10) / 1e10) : "");

export const readXls = (bytes: Uint8Array): string[][] => {
  try { return readXlsUnchecked(bytes); }
  catch (e) { if (e instanceof Error && e.message.startsWith("this .xls can't be read")) throw e; return bad("it is damaged"); } // a read past a record's end
};
const readXlsUnchecked = (bytes: Uint8Array): string[][] => {
  const w = workbookStream(bytes), v = new DataView(w.buffer, w.byteOffset, w.byteLength);
  type Rec = { t: number; o: number; l: number };
  const recAt = (o: number): Rec | null => (o + 4 <= w.length ? { t: v.getUint16(o, true), o: o + 4, l: v.getUint16(o + 2, true) } : null);
  const first = recAt(0);
  if (!first || first.t !== 0x0809 || v.getUint16(4, true) !== 0x0600) bad(first && (first.t & 0xff) === 0x09 ? "it is from Excel 95 or older" : "it is not an Excel workbook");
  // Workbook globals: the first worksheet's offset and the shared strings.
  let sheetAt = -1, sst: string[] = [];
  for (let o = 0, r = recAt(0); r && r.o + r.l <= w.length; o = r.o + r.l, r = recAt(o)) {
    if (r.t === 0x002f) bad("it is password-protected");
    if (r.t === 0x0085 && sheetAt < 0 && v.getUint8(r.o + 5) === 0) sheetAt = v.getUint32(r.o, true);
    if (r.t === 0x00fc) sst = strings(w, v, r, recAt);
    if (r.t === 0x000a) break;
  }
  if (sheetAt < 0 || sheetAt >= w.length) bad("it has no worksheet");
  const rows: string[][] = [];
  let cells = 0, pendingString: [number, number] | null = null;
  const put = (y: number, x: number, s: string) => { if (++cells > MAX_CELLS) bad("it has more than 2 million cells"); (rows[y] ??= [])[x] = s; };
  for (let o = sheetAt, r = recAt(o); r && r.o + r.l <= w.length; o = r.o + r.l, r = recAt(o)) {
    const y = r.l >= 4 ? v.getUint16(r.o, true) : 0, x = r.l >= 4 ? v.getUint16(r.o + 2, true) : 0;
    if (r.t === 0x000a) break;
    else if (r.t === 0x00fd && r.l >= 10) put(y, x, sst[v.getUint32(r.o + 6, true)] ?? "");
    else if (r.t === 0x0203 && r.l >= 14) put(y, x, num(v.getFloat64(r.o + 6, true)));
    else if (r.t === 0x027e && r.l >= 10) put(y, x, num(rk(v.getUint32(r.o + 6, true))));
    else if (r.t === 0x00bd && r.l >= 6) { for (let k = 0, n = (r.l - 6) / 6; k < n; k++) put(y, x + k, num(rk(v.getUint32(r.o + 4 + k * 6 + 2, true)))); }
    else if ((r.t === 0x0204 || r.t === 0x00d6) && r.l >= 9) put(y, x, ustr(v, r.o + 6, v.getUint16(r.o + 6, true), r.o + r.l, 2));
    else if (r.t === 0x0205 && r.l >= 8) put(y, x, v.getUint8(r.o + 7) ? "" : v.getUint8(r.o + 6) ? "TRUE" : "FALSE");
    else if (r.t === 0x0006 && r.l >= 20) {
      // A formula's last value: a number, or a marker whose text comes in the next STRING record.
      if (v.getUint16(r.o + 12, true) !== 0xffff) put(y, x, num(v.getFloat64(r.o + 6, true)));
      else { const k = v.getUint8(r.o + 6); if (k === 0) pendingString = [y, x]; else if (k === 1) put(y, x, v.getUint8(r.o + 8) ? "TRUE" : "FALSE"); }
    } else if (r.t === 0x0207 && pendingString && r.l >= 3) { put(pendingString[0], pendingString[1], ustr(v, r.o, v.getUint16(r.o, true), r.o + r.l, 2)); pendingString = null; }
  }
  return Array.from(rows, (r) => Array.from(r ?? [], (c) => c ?? ""));
};

/** A string at o: cch characters after a count of `head` bytes, then a flag byte (bit 0: two bytes a character). Bounded by end. */
const ustr = (v: DataView, o: number, cch: number, end: number, head: number): string => {
  const f = v.getUint8(o + head), wide = f & 1, rich = f & 8 ? 2 : 0, ext = f & 4 ? 4 : 0, s = o + head + 1 + rich + ext, n = Math.min(cch, Math.floor((end - s) / (wide ? 2 : 1)));
  let out = ""; for (let i = 0; i < n; i++) out += String.fromCharCode(wide ? v.getUint16(s + i * 2, true) : v.getUint8(s + i)); return out;
};

/** The shared string table: strings run across CONTINUE records, and where a string's characters break, the next record starts
 *  with a fresh flag byte (the width can change). Rich-text runs and phonetic data after a string are skipped, across breaks too. */
const strings = (w: Uint8Array, v: DataView, sst: { o: number; l: number }, recAt: (o: number) => { t: number; o: number; l: number } | null): string[] => {
  const parts = [sst]; for (let r = recAt(sst.o + sst.l); r && r.t === 0x003c && r.o + r.l <= w.length; r = recAt(r.o + r.l)) parts.push(r);
  let p = 0, o = sst.o + 8;
  const left = () => parts[p]!.o + parts[p]!.l - o, next = () => { if (++p >= parts.length) throw new RangeError(); o = parts[p]!.o; };
  const need = (n: number) => { if (left() <= 0) next(); if (left() < n) throw new RangeError(); };
  const skip = (n: number) => { while (n > 0) { if (left() <= 0) next(); const k = Math.min(n, left()); o += k; n -= k; } };
  const count = Math.min(v.getUint32(sst.o + 4, true), MAX_CELLS), out: string[] = [];
  try {
    for (let i = 0; i < count; i++) {
      need(3); let cch = v.getUint16(o, true), f = v.getUint8(o + 2); o += 3;
      const runs = f & 8 ? (need(2), v.getUint16(o, true)) : 0; if (f & 8) o += 2;
      const ext = f & 4 ? (need(4), v.getUint32(o, true)) : 0; if (f & 4) o += 4;
      let s = "";
      while (cch > 0) {
        if (left() <= 0) { next(); f = v.getUint8(o); o += 1; } // a continued string: new flag byte, same string
        const wide = f & 1, take = Math.min(cch, Math.floor(left() / (wide ? 2 : 1)));
        if (take <= 0) throw new RangeError();
        for (let k = 0; k < take; k++) s += String.fromCharCode(wide ? v.getUint16(o + k * 2, true) : v.getUint8(o + k));
        o += take * (wide ? 2 : 1); cch -= take;
      }
      skip(runs * 4 + ext); out.push(s);
    }
  } catch (e) { if (!(e instanceof RangeError)) throw e; bad("its text table is damaged"); }
  return out;
};
