/**
 * Zip files and folders: what's inside them, as files to take in. Pure (no DOM), so it is tested in Node.
 * A zip may come from anyone, so it is opened with limits on entries, sizes and nesting, and system clutter is left out.
 */
import { Unzip, UnzipInflate, unzipSync } from "fflate";

export const LIMITS = { entries: 1000, total: 300 * 1024 * 1024, file: 50 * 1024 * 1024, depth: 3 }; // file: the same 50 MB a single file may be (table.ts MAX_FILE)
/** Clutter that operating systems add to folders and zips. */
const JUNK = /(^|\/)(__MACOSX\/|\.[^/]*$|thumbs\.db$|desktop\.ini$)/i;

export const isZip = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

export interface Unpacked { files: { name: string; bytes: Uint8Array }[] }

/** A zip that is an archive of files, not an Excel workbook (.xlsx/.xlsm) or another Office document, which are zips too. */
export const isArchive = (b: Uint8Array): boolean => {
  if (!isZip(b)) return false;
  let office = false;
  try { unzipSync(b, { filter: (f) => { if (f.name === "[Content_Types].xml") office = true; return false; } }); } catch { return true; } // unreadable: let the archive path report it
  return !office;
};

/** What a folder or zip holds, without the clutter operating systems add. Every other file is taken in (read, or kept). */
export const withoutClutter = <T extends { name: string }>(entries: T[]): T[] => entries.filter((e) => !JUNK.test(e.name) && !e.name.endsWith("/"));

/** The files in a zip, with zips inside it opened too (up to 3 deep). Names keep their folder inside the zip ("2026/Oct/stmt.pdf"). */
/** budget is shared with zips inside it, so nesting can't multiply the limits. */
export const unzipArchive = (bytes: Uint8Array, name: string, depth = 1, budget = { entries: 0, total: 0 }): Unpacked => {
  if (depth > LIMITS.depth) throw new Error(`${name}: zips nested more than ${LIMITS.depth} deep aren't opened.`);
  // Streamed, entry by entry, counting the bytes that actually come out: a zip's declared sizes can lie (a "zip bomb").
  let stop = "", open_ = 0; const z: Record<string, Uint8Array> = {};
  const uz = new Unzip((f) => {
    if (stop || JUNK.test(f.name) || f.name.endsWith("/")) return;
    if (++budget.entries > LIMITS.entries) { stop = `it holds more than ${LIMITS.entries} files`; return; }
    const parts: Uint8Array[] = []; let size = 0; open_++;
    f.ondata = (err, chunk, final) => {
      if (stop) return;
      if (err) { stop = "it is damaged"; return; }
      size += chunk.length; budget.total += chunk.length;
      if (size > LIMITS.file) { stop = `${f.name} is larger than ${LIMITS.file / 1048576} MB`; f.terminate(); return; }
      if (budget.total > LIMITS.total) { stop = `its files add up to more than ${LIMITS.total / 1048576} MB`; f.terminate(); return; }
      parts.push(chunk);
      if (final) { open_--; const b = new Uint8Array(size); let o = 0; for (const p of parts) { b.set(p, o); o += p.length; } z[f.name] = b; }
    };
    f.start();
  });
  uz.register(UnzipInflate);
  try { for (let o = 0; o < bytes.length && !stop; o += 1 << 20) uz.push(bytes.subarray(o, Math.min(bytes.length, o + (1 << 20))), o + (1 << 20) >= bytes.length); }
  catch { stop ||= "it is damaged or not a zip"; }
  // A zip ends with its table of contents; without it, or with a file that never finished, it was cut short.
  const tail = bytes.subarray(Math.max(0, bytes.length - 65_557)); let end = false;
  for (let i = tail.length - 22; i >= 0 && !end; i--) end = tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06;
  if (!stop && (!end || open_)) stop = "it is damaged or cut short";
  if (stop) throw new Error(`${name} can't be opened: ${stop}.`);
  const all: { name: string; bytes: Uint8Array }[] = [], out: Unpacked = { files: [] };
  for (const [n, b] of Object.entries(z)) {
    if (isArchive(b)) out.files.push(...unzipArchive(b, `${name}/${n}`, depth + 1, budget).files); // a zip inside, whatever it's called
    else all.push({ name: n, bytes: b });
  }
  out.files.unshift(...all);
  return out;
};
