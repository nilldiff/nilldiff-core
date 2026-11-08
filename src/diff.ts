import { fmtCents } from "./money.ts";
import { EXACT, parseTol, within, type Tol } from "./tol.ts";
import { normKey, type ColType, type Table } from "./table.ts";
import type { Mapping } from "./mapping.ts";
import { typed } from "./value.ts";

export type Status = "ok" | "tol" | "brk" | "onlyA" | "onlyB";
export type Filter = "exc" | "tol" | "ok" | "all";
export interface Opts { prec: "A" | "B"; tols: string[]; names: [string, string] }
export interface Cell { top: string; sub: string; cls: "ok" | "tol" | "brk" | "off" }
export interface Row { key: string; status: Status; result: string; cells: Cell[] }
export interface Counts { ok: number; tol: number; brk: number; onlyA: number; onlyB: number; fieldBreaks: number; dupKeysA: number; dupKeysB: number }
export interface Total { label: string; a: number; b: number }

const CODE: Status[] = ["ok", "tol", "brk", "onlyA", "onlyB"], FILTER: Record<Filter, (s: number) => boolean> = { exc: (s) => s >= 2, tol: (s) => s === 1, ok: (s) => s === 0, all: () => true };
const show = (t: ColType, raw: string, v: number | string | null): string => v === null ? raw.trim() : t === "num" ? fmtCents(v as number) : t === "date" ? new Date((v as number) * 864e5).toISOString().slice(0, 10) : String(v);
const delta = (t: ColType, d: number): string => t === "num" ? (d > 0 ? "+" : "−") + fmtCents(Math.abs(d)) : t === "date" ? (d > 0 ? "+" : "−") + Math.abs(d) + " d" : "";

/** The comparison of two tables on a key. Row indices and statuses are held compactly; display cells are built per page, so 150k rows never become 150k objects. */
export class Diff {
  readonly counts: Counts = { ok: 0, tol: 0, brk: 0, onlyA: 0, onlyB: 0, fieldBreaks: 0, dupKeysA: 0, dupKeysB: 0 };
  readonly totals: Total[] = [];
  readonly errors: (string | null)[];
  private ra: Int32Array; private rb: Int32Array; private st: Uint8Array;
  private tols: Tol[];
  constructor(readonly A: Table, readonly B: Table, readonly map: Mapping, readonly opts: Opts) {
    if (!map.key) throw new Error("A key column is needed to compare.");
    const parsed = map.pairs.map((p, i) => parseTol(opts.tols[i] ?? "", p.type));
    this.errors = parsed.map((t) => (typeof t === "string" ? t : null)); this.tols = parsed.map((t) => (typeof t === "string" ? EXACT : t));
    const { a: ka, b: kb } = map.key, seen = new Map<string, number[]>();
    B.rows.forEach((r, i) => { const k = normKey(r[kb]!); if (!k) return; const l = seen.get(k); l ? (l.push(i), this.counts.dupKeysB++) : seen.set(k, [i]); });
    const ra: number[] = [], rb: number[] = [], used = new Map<string, number>();
    A.rows.forEach((r, i) => { const k = normKey(r[ka]!); if (!k) return; const u = used.get(k) ?? 0; used.set(k, u + 1); if (u) this.counts.dupKeysA++; ra.push(i); rb.push(seen.get(k)?.[u] ?? -1); });
    const taken = new Set<number>(); for (const j of rb) if (j >= 0) taken.add(j);
    B.rows.forEach((r, i) => { if (normKey(r[kb]!) && !taken.has(i)) { ra.push(-1); rb.push(i); } });
    this.ra = Int32Array.from(ra); this.rb = Int32Array.from(rb); this.st = new Uint8Array(ra.length);;
    const sums = map.pairs.map(() => [0, 0]);
    for (let i = 0; i < ra.length; i++) {
      if (this.ra[i]! < 0) { this.st[i] = 4; this.counts.onlyB++; } else if (this.rb[i]! < 0) { this.st[i] = 3; this.counts.onlyA++; }
      else { let nb = 0, nt = 0; map.pairs.forEach((p, k) => { const c = this.cmp(i, k); if (c.cls === "brk") nb++; else if (c.cls === "tol") nt++; }); this.st[i] = nb ? 2 : nt ? 1 : 0; this.counts[nb ? "brk" : nt ? "tol" : "ok"]++; this.counts.fieldBreaks += nb; }
      map.pairs.forEach((p, k) => { if (p.type !== "num") return; const x = this.ra[i]! >= 0 ? typed("num", A.rows[this.ra[i]!]![p.a]!) : null, y = this.rb[i]! >= 0 ? typed("num", B.rows[this.rb[i]!]![p.b]!) : null; if (typeof x === "number") sums[k]![0]! += x; if (typeof y === "number") sums[k]![1]! += y; });
    }
    map.pairs.forEach((p, k) => { if (p.type === "num") this.totals.push({ label: p.label, a: sums[k]![0]!, b: sums[k]![1]! }); });
  }
  /** One compared field on one matched row: the winning record's value on top, the other record's value and the gap beneath when they differ. */
  private cmp(i: number, k: number): Cell & { d: number } {
    const p = this.map.pairs[k]!, ra = this.A.rows[this.ra[i]!]![p.a]!, rb = this.B.rows[this.rb[i]!]![p.b]!, aw = this.opts.prec === "A";
    const x = typed(p.type, ra), y = typed(p.type, rb), w = aw ? x : y, o = aw ? y : x, wr = aw ? ra : rb, or = aw ? rb : ra, top = show(p.type, wr, w);
    if (w === null && o === null) return { top, sub: "", cls: "ok", d: 0 };
    if (w === null || o === null || (p.type === "text" ? false : typeof w !== "number" || typeof o !== "number")) return { top, sub: `${this.opts.names[aw ? 1 : 0]} ${show(p.type, or, o) || "blank"}`, cls: "brk", d: 0 };
    if (p.type === "text") { const same = this.tols[k]!.ci ? String(w).toLowerCase() === String(o).toLowerCase() : w === o; return { top, sub: same ? "" : `${this.opts.names[aw ? 1 : 0]} ${show(p.type, or, o)}`, cls: same ? "ok" : "brk", d: 0 }; }
    const d = (o as number) - (w as number);
    if (d === 0) return { top, sub: "", cls: "ok", d };
    return { top, sub: `${this.opts.names[aw ? 1 : 0]} ${show(p.type, or, o)} · Δ ${delta(p.type, d)}`, cls: within(d, w as number, this.tols[k]!) ? "tol" : "brk", d };
  }
  private sel(f: Filter): number[] { const out: number[] = []; for (let i = 0; i < this.st.length; i++) if (FILTER[f](this.st[i]!)) out.push(i); return out; }
  count(f: Filter): number { const c = this.counts; return f === "exc" ? c.brk + c.onlyA + c.onlyB : f === "tol" ? c.tol : f === "ok" ? c.ok : this.st.length; }
  private row(i: number): Row {
    const s = this.st[i]!, status = CODE[s]!, { key, pairs } = this.map, only = s >= 3, src = only ? (s === 3 ? this.A : this.B) : null, r = only ? src!.rows[(s === 3 ? this.ra : this.rb)[i]!]! : null;
    const cells: Cell[] = pairs.map((p, k) => only ? { top: show(p.type, r![s === 3 ? p.a : p.b]!, typed(p.type, r![s === 3 ? p.a : p.b]!)), sub: "", cls: "off" } : this.cmp(i, k));
    const nb = cells.filter((c) => c.cls === "brk").length;
    return { key: only ? r![s === 3 ? key!.a : key!.b]! : this.A.rows[this.ra[i]!]![key!.a]!, status, cells, result: s === 3 ? `Only in ${this.opts.names[0]}` : s === 4 ? `Only in ${this.opts.names[1]}` : nb ? `${nb} break${nb > 1 ? "s" : ""}` : s === 1 ? "Within tolerance" : "Clean" };
  }
  /** At most `limit` rows of a filter, starting at `offset`. */
  page(f: Filter, offset: number, limit: number): Row[] { return this.sel(f).slice(offset, offset + limit).map((i) => this.row(i)); }
  /** Every row of a filter as spreadsheet cells: key, result, then for each compared field A, B, the gap and the value used. */
  exportRows(f: Filter): (string | number)[][] {
    const { pairs } = this.map, num = (t: ColType, raw: string) => { const v = typed(t, raw); return v === null ? "" : t === "num" ? (v as number) / 100 : t === "date" ? show(t, raw, v) : String(v); };
    const head = ["Key", "Result", ...pairs.flatMap((p) => [`${p.label} (${this.opts.names[0]})`, `${p.label} (${this.opts.names[1]})`, `${p.label} gap`, `${p.label} used`])];
    const body = this.sel(f).map((i) => {
      const a = this.ra[i]! >= 0 ? this.A.rows[this.ra[i]!]! : null, b = this.rb[i]! >= 0 ? this.B.rows[this.rb[i]!]! : null, row = this.row(i);
      return [row.key, row.result, ...pairs.flatMap((p) => { const x = a ? num(p.type, a[p.a]!) : "", y = b ? num(p.type, b[p.b]!) : "", g = typeof x === "number" && typeof y === "number" ? Math.round((y - x) * 100) / 100 : ""; return [x, y, g, this.opts.prec === "A" ? (x !== "" ? x : y) : (y !== "" ? y : x)]; })] as (string | number)[];
    });
    return [head, ...body];
  }
}
