import { parseCsv } from "./csv.ts";
import { dayDiff } from "./dates.ts";
import { accountLast4, detectLabel } from "./naming.ts";
import { parseLedger, type Txn } from "./parse.ts";
import { reconcile, type Match, type ReconOpts } from "./reconcile.ts";
import { sniff } from "./scope.ts";
import { parseStatement, type Statement } from "./statement.ts";
import { isXlsx, readXlsx } from "./xlsx.ts";

/** One account's lines from one file: a statement PDF, or one account of a spreadsheet (a QuickBooks report can hold several). */
export interface Source {
  file: string; kind: "statement" | "ledger"; txns: Txn[]; period: { from: string; to: string } | null; last4: string | null;
  name: string; card: boolean; skipped: number; check: Statement["check"] | null;
}
/** Every source for the same account and kind, e.g. three monthly statements of one checking account. */
export interface Rec { id: string; kind: Source["kind"]; name: string; last4: string | null; card: boolean; sources: Source[]; txns: Txn[]; from: string | null; to: string | null }
export class FileError extends Error {}

const MAX_FILE = 50 * 2 ** 20, MAX_FILES = 60;
const tail4 = (s: string): string | null => /\((?:\D*?)(\d{4})\)|(?:\D|^)(\d{4})\s*$/.exec(s)?.slice(1).find(Boolean) ?? null;
const span = (t: Txn[]): [string, string] | null => { if (!t.length) return null; let lo = t[0]!.date, hi = lo; for (const x of t) { if (x.date < lo) lo = x.date; if (x.date > hi) hi = x.date; } return [lo, hi]; };

/** Reads one file into sources. Nothing is kept: the bytes are only read. PDF text extraction loads on first use. */
export const readFile = async (file: string, bytes: Uint8Array, n = 0): Promise<Source[]> => {
  if (bytes.length > MAX_FILE) throw new FileError(`${file}: larger than ${MAX_FILE / 2 ** 20} MB.`);
  const pre = (t: Txn[]) => t.map((x) => ({ ...x, id: `${n}:${x.id}` }));
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) { // %PDF
    const { pdfLayout } = await import("./pdftext.ts"), { lines, cells } = await pdfLayout(bytes), s = parseStatement(lines, cells), last4 = accountLast4(lines);
    return [{ file, kind: "statement", txns: pre(s.txns), period: s.period, last4, name: detectLabel(lines, s.card)?.replace(/-/g, " ") ?? (last4 ? `Account ending ${last4}` : file), card: s.card, skipped: s.skipped.length, check: s.check }];
  }
  const rows = isXlsx(bytes) ? readXlsx(bytes) : parseCsv(new TextDecoder().decode(bytes)), kind = sniff(rows);
  if (kind === "pnl") throw new FileError(`${file}: this is a profit and loss report, not a list of transactions.`);
  const p = parseLedger(rows, kind === "qbo" ? "qbo" : "bank"), by = new Map<string, Txn[]>();
  for (const t of pre(p.txns)) (by.get(t.acct ?? "") ?? by.set(t.acct ?? "", []).get(t.acct ?? "")!).push(t);
  const base = file.replace(/\.[^.]+$/, "");
  return [...by].map(([acct, txns]) => ({ file, kind: "ledger", txns, period: null, last4: acct ? tail4(acct) : null, name: acct || base, card: /card|amex|visa|mastercard/i.test(acct), skipped: p.skipped.length, check: null }));
};

/** Groups sources into records: statements of one account merge (several months), as do ledgers of one account name. */
export const toRecords = (sources: Source[]): Rec[] => {
  const by = new Map<string, Source[]>();
  for (const s of sources) { const k = s.kind === "statement" ? `s:${s.last4 ?? s.file}` : `l:${s.name}`; (by.get(k) ?? by.set(k, []).get(k)!).push(s); }
  return [...by].map(([id, ss]) => {
    const txns = ss.flatMap((s) => s.txns), d = span(txns), ps = ss.flatMap((s) => (s.period ? [s.period] : []));
    const from = [...ps.map((p) => p.from), ...(d ? [d[0]] : [])].sort()[0] ?? null, to = [...ps.map((p) => p.to), ...(d ? [d[1]] : [])].sort().at(-1) ?? null;
    return { id, kind: ss[0]!.kind, name: ss[0]!.name, last4: ss.find((s) => s.last4)?.last4 ?? null, card: ss.some((s) => s.card), sources: ss, txns, from, to };
  });
};

/** Records that describe the same account, compared together: same last 4 digits; a record with no account number joins the group whose amounts it shares most. */
export const groupRecords = (recs: Rec[]): Rec[][] => {
  const groups: Rec[][] = [], key = new Map<string, Rec[]>();
  let loose: Rec[] | null = null;
  for (const r of recs) if (r.last4) { let g = key.get(r.last4); if (!g) { g = []; groups.push(g); key.set(r.last4, g); } g.push(r); }
  const overlap = (a: Rec, b: Rec) => { const m = new Map<number, number>(); for (const t of a.txns) m.set(Math.abs(t.cents), (m.get(Math.abs(t.cents)) ?? 0) + 1); let n = 0; for (const t of b.txns) { const k = m.get(Math.abs(t.cents)); if (k) { n++; m.set(Math.abs(t.cents), k - 1); } } return n / Math.max(1, Math.min(a.txns.length, b.txns.length)); };
  const keyed = [...groups];
  for (const r of recs) if (!r.last4) {
    const best = keyed.map((g) => [g, Math.max(...g.map((x) => overlap(x, r)))] as const).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 0.3) best[0].push(r); else { if (!loose) groups.push((loose = [])); loose.push(r); }
  }
  return groups;
};

export interface Conflict { ref: Txn; other: Txn }
export interface Comparison {
  ref: Rec; other: Rec; flipped: boolean; from: string | null; to: string | null;
  matched: Match[]; dateDiffers: Match[]; conflicts: Conflict[]; onlyRef: Txn[]; onlyOther: Txn[]; outsideRef: Txn[]; outsideOther: Txn[];
  refCents: number; otherCents: number; deltaCents: number;
}
const tok = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z]{3,}/g) ?? []);
const sim = (a: Set<string>, b: Set<string>): number => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const sum = (t: Txn[]): number => t.reduce((s, x) => s + x.cents, 0);

/** Compares a record against the one that takes precedence, over the dates both cover.
 *  The other record's signs are flipped when that matches clearly more lines (a card register against its statement, a ledger exported from the other side).
 *  Lines left over on both sides with the same date (within the window) and a similar description are reported as one line whose amount differs. */
export const compare = (ref: Rec, other: Rec, o: Partial<ReconOpts> = {}): Comparison => {
  const w = o.windowDays ?? 7, from = [ref.from, other.from].filter(Boolean).sort().at(-1) ?? null, to = [ref.to, other.to].filter(Boolean).sort()[0] ?? null;
  const inside = (t: Txn) => (!from || dayDiff(from, t.date) <= w) && (!to || dayDiff(t.date, to) <= w);
  const R = ref.txns.filter(inside), O0 = other.txns.filter(inside);
  const a = reconcile(R, O0, o), neg = O0.map((t) => ({ ...t, cents: -t.cents })), b = reconcile(R, neg, o);
  const flipped = b.matched.length > Math.max(1, a.matched.length * 1.5), r = flipped ? b : a;
  const used = new Set<string>(), conflicts: Conflict[] = [], ot = new Map(r.unmatchedBank.map((t) => [t.id, tok(t.desc)]));
  const pairs = r.unmatchedQbo.flatMap((q) => { const qt = tok(q.desc); return r.unmatchedBank.flatMap((x) => { const d = Math.abs(dayDiff(q.date, x.date)), s = sim(qt, ot.get(x.id)!); return d <= w && s >= 0.5 ? [{ q, x, cost: d - s * 10 }] : []; }); }).sort((p, q) => p.cost - q.cost);
  for (const { q, x } of pairs) if (!used.has(q.id) && !used.has(x.id)) { used.add(q.id); used.add(x.id); conflicts.push({ ref: q, other: x }); }
  const onlyRef = r.unmatchedQbo.filter((t) => !used.has(t.id)), onlyOther = r.unmatchedBank.filter((t) => !used.has(t.id));
  const flip = (t: Txn) => (flipped ? { ...t, cents: -t.cents } : t), O = flipped ? neg : O0;
  return {
    ref, other, flipped, from, to, matched: r.matched, dateDiffers: r.matched.filter((m) => m.maxDays > 0), conflicts, onlyRef, onlyOther,
    outsideRef: ref.txns.filter((t) => !inside(t)), outsideOther: other.txns.filter((t) => !inside(t)).map(flip),
    refCents: sum(R), otherCents: sum(O), deltaCents: sum(R) - sum(O),
  };
};

/** The reconciled ledger: every line of the record that takes precedence (its date, description and amount win), then the lines only the other record has.
 *  Columns: Date, Description, Amount, Status, Other date, Other amount, Other description, File. */
export const ledgerRows = (c: Comparison): (string | number)[][] => {
  const n = c.other.name, cents = (v: number) => v / 100, file = (t: Txn) => c.ref.sources.concat(c.other.sources).find((s) => s.txns.some((x) => x.id === t.id))?.file ?? "";
  const otherOf = new Map<string, { st: string; o: Txn[] }>();
  for (const m of c.matched) for (const q of m.qbo) otherOf.set(q.id, { st: m.qbo.length > 1 || m.bank.length > 1 ? `Matched (grouped ${m.kind})` : m.maxDays ? "Matched, date differs" : "Matched", o: m.bank });
  for (const k of c.conflicts) otherOf.set(k.ref.id, { st: `Amount differs in ${n}`, o: [k.other] });
  const rows: (string | number)[][] = [["Date", "Description", "Amount", "Status", "Other date", "Other amount", "Other description", "File"]];
  for (const t of [...c.ref.txns].sort((a, b) => a.date.localeCompare(b.date))) {
    const m = otherOf.get(t.id), out = c.outsideRef.includes(t), o = m?.o ?? [];
    rows.push([t.date, t.desc, cents(t.cents), m?.st ?? (out ? `Outside the dates ${n} covers` : `Missing from ${n}`), o.map((x) => x.date).join(", "), o.length ? cents(sum(o)) : "", o.map((x) => x.desc).join(" | "), file(t)]);
  }
  for (const t of [...c.onlyOther].sort((a, b) => a.date.localeCompare(b.date))) rows.push(["", "", "", `Only in ${n}`, t.date, cents(t.cents), t.desc, file(t)]);
  return rows;
};
