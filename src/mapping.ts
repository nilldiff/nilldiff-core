import { colInfo, keySet, normKey, type ColInfo, type ColType, type Table } from "./table.ts";
import { typed } from "./value.ts";

export interface Pair { a: number; b: number; label: string; type: ColType; tol: string }
export interface Mapping { key: { a: number; b: number; overlap: number } | null; pairs: Pair[] }

const SYN: Record<string, string> = { inv: "invoice", invoices: "invoice", no: "number", num: "number", nbr: "number", id: "number", ref: "number", reference: "number", amt: "amount", charges: "amount", charge: "amount", sum: "amount", bal: "balance", upb: "balance", outstanding: "balance", dt: "date", desc: "description", memo: "description", notes: "description", note: "description" };
const STOP = new Set(["of", "the", "a", "an"]);
const toks = (h: string): Set<string> => new Set(h.toLowerCase().replace(/#/g, " number ").split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t)).map((t) => SYN[t] ?? t));
/** How alike two headers are: Jaccard similarity of their words after folding synonyms (Inv # and Invoice Number agree; Amount and Charges agree). */
export const headerSim = (a: string, b: string): number => { const x = toks(a), y = toks(b); let n = 0; for (const t of x) if (y.has(t)) n++; return x.size + y.size - n ? n / (x.size + y.size - n) : 0; };
const IDHDR = /(^|[^a-z])(id|no|nbr|num|number|ref|key|account|acct|loan|invoice|inv|cusip|ticker|sku|po|order|#)([^a-z]|$)/i;
const idLike = (h: string, c: ColInfo): number => c.type === "date" ? 0 : c.type === "text" ? 1 : IDHDR.test(h) && c.intOnly ? 1 : c.intOnly ? 0.25 : 0.1;
const MAX_MATCHED = 2000, MAX_KEYS = 10, KEY_SAMPLE = 2000;
/** The likeliest key columns first: ID-like header and values, then the most distinct. Capped so a wide table of unique text columns can't make the search columns × columns × rows. */
const topKeys = (t: Table, info: ColInfo[]): number[] => info.flatMap((c, j) => (c.unique >= 0.9 && c.type !== "date" ? [j] : []))
  .sort((x, y) => (IDHDR.test(t.headers[y]!) ? 1 : 0) - (IDHDR.test(t.headers[x]!) ? 1 : 0) || idLike(t.headers[y]!, info[y]!) - idLike(t.headers[x]!, info[x]!) || info[y]!.unique - info[x]!.unique || x - y).slice(0, MAX_KEYS);
/** Share of a sample of the smaller set's keys found in the larger set (an estimate; the chosen key's overlap is counted exactly). */
const share = (sa: Set<string>, sb: Set<string>, cap: number): number => { const [s, l] = sa.size < sb.size ? [sa, sb] : [sb, sa]; let n = 0, m = 0; for (const k of s) { if (m++ >= cap) break; if (l.has(k)) n++; } return n / Math.max(1, m); };

/** Suggests the key and the column pairs to compare, from header similarity and, once a key lines the rows up, how often two columns agree on rows that match. */
export const suggestMapping = (A: Table, B: Table): Mapping => {
  const ia = A.headers.map((_, j) => colInfo(A, j)), ib = B.headers.map((_, j) => colInfo(B, j));
  let key: Mapping["key"] = null, bestScore = 0.15;
  const cand = (t: Table, info: ColInfo[]) => topKeys(t, info).map((j) => [j, keySet(t, j)] as const);
  const ca = cand(A, ia), cb = cand(B, ib); let best: [Set<string>, Set<string>] | null = null;
  for (const [i, sa] of ca) for (const [j, sb] of cb) {
    const overlap = share(sa, sb, KEY_SAMPLE), score = overlap * (0.4 + 0.6 * headerSim(A.headers[i]!, B.headers[j]!)) * Math.min(idLike(A.headers[i]!, ia[i]!), idLike(B.headers[j]!, ib[j]!));
    if (score > bestScore) { bestScore = score; key = { a: i, b: j, overlap }; best = [sa, sb]; }
  }
  if (!key) return { key: null, pairs: [] };
  key.overlap = share(...best!, Infinity);
  const pos = new Map<string, number>(); B.rows.forEach((r, i) => { const k = normKey(r[key!.b]!); if (k && !pos.has(k)) pos.set(k, i); });
  const matched: [string[], string[]][] = []; const step = Math.max(1, Math.floor(A.rows.length / MAX_MATCHED));
  for (let i = 0; i < A.rows.length && matched.length < MAX_MATCHED; i += step) { const o = pos.get(normKey(A.rows[i]![key.a]!)); if (o !== undefined) matched.push([A.rows[i]!, B.rows[o]!]); }
  // Each matched value is typed once per column, not once per column pair.
  const tv = (info: ColInfo[], side: 0 | 1) => info.map((c, j) => matched.map((m) => typed(c.type, m[side][j]!))), va = tv(ia, 0), vb = tv(ib, 1);
  const cands: (Pair & { score: number })[] = [];
  ia.forEach((ca1, i) => { if (i === key!.a) return; ib.forEach((cb1, j) => {
    if (j === key!.b || ca1.type !== cb1.type) return;
    let both = 0, eq = 0; for (let m = 0; m < matched.length; m++) { const x = va[i]![m], y = vb[j]![m]; if (x === null && y === null) continue; both++; if (x === y) eq++; }
    const hs = headerSim(A.headers[i]!, B.headers[j]!), ev = both ? eq / both : 0, score = 0.55 * ev + 0.45 * hs;
    if (score >= 0.4 && (hs > 0 || ev >= 0.7)) cands.push({ a: i, b: j, label: A.headers[i]!, type: ca1.type, tol: "exact", score });
  }); });
  const ua = new Set<number>(), ub = new Set<number>(), pairs: Pair[] = [];
  for (const c of cands.sort((x, y) => y.score - x.score)) if (!ua.has(c.a) && !ub.has(c.b)) { ua.add(c.a); ub.add(c.b); const { score: _s, ...p } = c; pairs.push(p); }
  return { key, pairs: pairs.sort((x, y) => x.a - y.a) };
};
