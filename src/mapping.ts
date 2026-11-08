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
const MAX_MATCHED = 2000;

/** Suggests the key and the column pairs to compare, from header similarity and, once a key lines the rows up, how often two columns agree on rows that match. */
export const suggestMapping = (A: Table, B: Table): Mapping => {
  const ia = A.headers.map((_, j) => colInfo(A, j)), ib = B.headers.map((_, j) => colInfo(B, j));
  let key: Mapping["key"] = null, bestScore = 0.15;
  const cand = (t: Table, info: ColInfo[]) => info.flatMap((c, j) => (c.unique >= 0.9 && c.type !== "date" ? [[j, keySet(t, j)] as const] : []));
  const ca = cand(A, ia), cb = cand(B, ib);
  for (const [i, sa] of ca) for (const [j, sb] of cb) {
    let n = 0; const [s, l] = sa.size < sb.size ? [sa, sb] : [sb, sa]; for (const k of s) if (l.has(k)) n++;
    const overlap = n / Math.max(1, s.size), score = overlap * (0.4 + 0.6 * headerSim(A.headers[i]!, B.headers[j]!)) * Math.min(idLike(A.headers[i]!, ia[i]!), idLike(B.headers[j]!, ib[j]!));
    if (score > bestScore) { bestScore = score; key = { a: i, b: j, overlap }; }
  }
  if (!key) return { key: null, pairs: [] };
  const pos = new Map<string, number>(); B.rows.forEach((r, i) => { const k = normKey(r[key!.b]!); if (k && !pos.has(k)) pos.set(k, i); });
  const matched: [string[], string[]][] = []; const step = Math.max(1, Math.floor(A.rows.length / MAX_MATCHED));
  for (let i = 0; i < A.rows.length && matched.length < MAX_MATCHED; i += step) { const o = pos.get(normKey(A.rows[i]![key.a]!)); if (o !== undefined) matched.push([A.rows[i]!, B.rows[o]!]); }
  const cands: (Pair & { score: number })[] = [];
  ia.forEach((ca1, i) => { if (i === key!.a) return; ib.forEach((cb1, j) => {
    if (j === key!.b || ca1.type !== cb1.type) return;
    let both = 0, eq = 0; for (const [ra, rb] of matched) { const x = typed(ca1.type, ra[i]!), y = typed(cb1.type, rb[j]!); if (x === null && y === null) continue; both++; if (x === y) eq++; }
    const hs = headerSim(A.headers[i]!, B.headers[j]!), ev = both ? eq / both : 0, score = 0.55 * ev + 0.45 * hs;
    if (score >= 0.4 && (hs > 0 || ev >= 0.7)) cands.push({ a: i, b: j, label: A.headers[i]!, type: ca1.type, tol: "exact", score });
  }); });
  const ua = new Set<number>(), ub = new Set<number>(), pairs: Pair[] = [];
  for (const c of cands.sort((x, y) => y.score - x.score)) if (!ua.has(c.a) && !ub.has(c.b)) { ua.add(c.a); ub.add(c.b); const { score: _s, ...p } = c; pairs.push(p); }
  return { key, pairs: pairs.sort((x, y) => x.a - y.a) };
};
