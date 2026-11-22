import { colInfo, type Table } from "./table.ts";
import { toCents, fmtCents } from "./money.ts";
import { toDay } from "./value.ts";

/**
 * Matching without a shared key: two lists of dated amounts (a ledger and a statement, two exports of payments, a remittance and a deposit
 * list) are lined up by amount within a few days of each other. Ties are broken by the closest date, then by how alike the descriptions are,
 * then by a matching reference. What is left is tried as groups (several lines on one side adding up exactly to one line on the other), and
 * same-amount lines just outside the window are shown as timing differences, never matched. Pure: tables in, plain data out.
 */

/** Which columns of a table hold each part of a line. An amount is one signed column, or money in and money out in two columns (in − out).
 *  flip turns every amount over, for a file that records the same movements with the opposite sign. */
export interface Side { date: number; amount: number | null; in: number | null; out: number | null; desc: number | null; ref: number | null; flip: boolean }
export interface MatchOpts { windowDays: number; maxGroup: number; poolCap: number; lateDays: number }
export const MATCH_DEFAULTS: MatchOpts = { windowDays: 3, maxGroup: 5, poolCap: 18, lateDays: 45 };
export interface Line { row: number; day: number; cents: number; desc: string; ref: string }
export interface Skipped { row: number; reason: string }
export type GroupKind = "1:1" | "many:1" | "1:many";
export interface Group { kind: GroupKind; a: Line[]; b: Line[]; days: number }
/** A line on each side with the same amount, further apart than the window: probably the same movement, recorded late. Not matched. */
export interface Timing { a: Line; b: Line; days: number }
export interface Totals { a: number; b: number; matched: number; timingA: number; timingB: number; onlyA: number; onlyB: number }
export interface MatchResult { groups: Group[]; timing: Timing[]; onlyA: Line[]; onlyB: Line[]; skippedA: Skipped[]; skippedB: Skipped[]; totals: Totals }

const cell = (r: string[], j: number | null) => (j === null ? "" : (r[j] ?? "").trim());
/** The lines of a table under a column choice. Rows without a date or an amount are skipped and named (totals, notes, blank amounts). */
export const linesOf = (t: Table, s: Side): { lines: Line[]; skipped: Skipped[] } => {
  const lines: Line[] = [], skipped: Skipped[] = [];
  t.rows.forEach((r, row) => {
    const day = toDay(cell(r, s.date));
    if (day === null) return void skipped.push({ row, reason: "no date" });
    let cents: number | null;
    if (s.amount !== null) cents = toCents(cell(r, s.amount));
    else { const i = toCents(cell(r, s.in)), o = toCents(cell(r, s.out)); cents = i === null && o === null ? null : (i ?? 0) - Math.abs(o ?? 0); }
    if (cents === null) return void skipped.push({ row, reason: "no amount" });
    lines.push({ row, day, cents: s.flip ? -cents : cents, desc: cell(r, s.desc), ref: cell(r, s.ref) });
  });
  return { lines, skipped };
};

const tok = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
const sim = (a: Set<string>, b: Set<string>): number => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const sum = (l: Line[]) => l.reduce((s, x) => s + x.cents, 0);
const span = (l: Line[]) => Math.max(...l.map((x) => Math.abs(x.day - l[0]!.day)));
const byDay = (x: Line, y: Line) => x.day - y.day || x.row - y.row;
const bucket = (l: Line[]) => { const m = new Map<number, Line[]>(); for (const x of l) (m.get(x.cents) ?? m.set(x.cents, []).get(x.cents)!).push(x); return m; };

/** Smallest set (2..maxK lines) of the candidates adding up exactly to target. */
const subset = (c: Line[], target: number, maxK: number): Line[] | null => {
  const pick: Line[] = [];
  const go = (start: number, k: number, left: number): boolean => {
    if (k === 0) return left === 0;
    for (let i = start; i < c.length; i++) { const v = c[i]!.cents; if (Math.abs(v) > Math.abs(left)) continue; pick.push(c[i]!); if (go(i + 1, k - 1, left - v)) return true; pick.pop(); }
    return false;
  };
  for (let k = 2; k <= maxK; k++) { pick.length = 0; if (go(0, k, target)) return [...pick]; }
  return null;
};

/** An amount repeated so often that every pair would be too many (thousands × thousands): matched in date order with two pointers instead. */
const HOT = 40_000;
export const matchLines = (A: Line[], B: Line[], o: Partial<MatchOpts> = {}): Omit<MatchResult, "skippedA" | "skippedB"> => {
  const { windowDays: w, maxGroup, poolCap, lateDays } = { ...MATCH_DEFAULTS, ...o };
  const usedA = new Set<number>(), usedB = new Set<number>(), groups: Group[] = [], bb = bucket(B), ba = bucket(A);
  const toks = new Map<Line, Set<string>>([...A, ...B].map((x) => [x, tok(x.desc)]));
  for (const [c, as] of ba) {
    const bs = bb.get(c); if (!bs || as.length * bs.length <= HOT) continue;
    const xs = [...as].sort(byDay), ys = [...bs].sort(byDay);
    for (let i = 0, j = 0; i < xs.length && j < ys.length;) { const x = xs[i]!, y = ys[j]!, d = Math.abs(x.day - y.day);
      if (d <= w) { usedA.add(x.row); usedB.add(y.row); groups.push({ kind: "1:1", a: [x], b: [y], days: d }); i++; j++; } else if (x.day < y.day) i++; else j++; }
  }
  const pairs: { a: Line; b: Line; cost: number }[] = [];
  for (const [c, as] of ba) { const bs = bb.get(c); if (!bs || as.length * bs.length > HOT) continue;
    for (const a of as) for (const b of bs) { const d = Math.abs(a.day - b.day); if (d <= w) pairs.push({ a, b, cost: d + (1 - sim(toks.get(a)!, toks.get(b)!)) * 3 - (a.ref && a.ref === b.ref ? 2 : 0) }); } }
  pairs.sort((x, y) => x.cost - y.cost || x.a.row - y.a.row || x.b.row - y.b.row);
  for (const { a, b } of pairs) { if (usedA.has(a.row) || usedB.has(b.row)) continue; usedA.add(a.row); usedB.add(b.row); groups.push({ kind: "1:1", a: [a], b: [b], days: Math.abs(a.day - b.day) }); }
  // Groups: one line against several lines on the other side, same sign, within the window, adding up exactly.
  const grouped = (singles: Line[], pool: Line[], usedS: Set<number>, usedP: Set<number>, kind: "many:1" | "1:many") => {
    for (const s of singles) {
      if (usedS.has(s.row)) continue;
      const c = pool.filter((p) => !usedP.has(p.row) && Math.sign(p.cents) === Math.sign(s.cents) && Math.abs(p.cents) < Math.abs(s.cents) && Math.abs(p.day - s.day) <= w)
        .sort((x, y) => Math.abs(x.day - s.day) - Math.abs(y.day - s.day) || x.row - y.row).slice(0, poolCap);
      const hit = c.length >= 2 ? subset(c, s.cents, maxGroup) : null;
      if (!hit) continue;
      usedS.add(s.row); hit.forEach((p) => usedP.add(p.row));
      groups.push(kind === "many:1" ? { kind, a: hit, b: [s], days: span([s, ...hit]) } : { kind, a: [s], b: hit, days: span([s, ...hit]) });
    }
  };
  grouped(B, A, usedB, usedA, "many:1");
  grouped(A, B, usedA, usedB, "1:many");
  // Timing: same amount, outside the window but within lateDays; the closest pairs first, each line in at most one.
  const restA = A.filter((x) => !usedA.has(x.row)), restB = B.filter((x) => !usedB.has(x.row)), rb = bucket(restB), tA = new Set<number>(), tB = new Set<number>(), timing: Timing[] = [];
  const cand = restA.flatMap((a) => (rb.get(a.cents) ?? []).map((b) => ({ a, b, days: Math.abs(a.day - b.day) }))).filter((x) => x.days > w && x.days <= lateDays);
  for (const x of cand.sort((p, q) => p.days - q.days || p.b.day - q.b.day || p.a.row - q.a.row)) if (!tA.has(x.a.row) && !tB.has(x.b.row)) { tA.add(x.a.row); tB.add(x.b.row); timing.push(x); }
  const onlyA = restA.filter((x) => !tA.has(x.row)), onlyB = restB.filter((x) => !tB.has(x.row));
  return { groups, timing, onlyA, onlyB, totals: { a: sum(A), b: sum(B), matched: groups.reduce((s, g) => s + sum(g.a), 0), timingA: sum(timing.map((t) => t.a)), timingB: sum(timing.map((t) => t.b)), onlyA: sum(onlyA), onlyB: sum(onlyB) } };
};
/** Both tables under their column choices, matched. */
export const matchTables = (A: Table, B: Table, sa: Side, sb: Side, o: Partial<MatchOpts> = {}): MatchResult => {
  const a = linesOf(A, sa), b = linesOf(B, sb);
  return { ...matchLines(a.lines, b.lines, o), skippedA: a.skipped, skippedB: b.skipped };
};

/** Opening balance + every line = closing balance? gap is closing − expected (0 when it ties out). */
export const tieOut = (lines: Line[], opening: number, closing: number) => { const expected = opening + sum(lines); return { expected, closing, gap: closing - expected }; };

const DATE_H = /date|posted|\bday\b|\bdt\b|value|effective|trans/i, AMT_H = /amount|amt|\bvalue\b|\btotal\b|\bnet\b|\bsum\b/i;
const IN_H = /deposit|credit|receipt|money in|paid in|inflow|increase|\bin\b/i, OUT_H = /withdraw|debit|charge|money out|paid out|outflow|decrease|payment|\bout\b/i;
const DESC_H = /desc|memo|narrat|detail|payee|particular|name|text|reference text|vendor|customer|merchant/i, REF_H = /\bref|check|cheque|chk|\bdoc|\bno\b|number|#|\bid\b/i;
/** The best guess at each side's columns, from column types and header words: a date column, an amount (or money in and out), a
 *  description and a reference. Whether B's amounts are recorded with the opposite sign is decided by which way more lines line up. */
export const suggestSides = (A: Table, B: Table, o: Partial<MatchOpts> = {}): { a: Side; b: Side } | null => {
  const pick = (t: Table): Side | null => {
    const info = t.headers.map((_, j) => colInfo(t, j)), of = (type: string) => info.flatMap((c, j) => (c.type === type ? [j] : []));
    const dates = of("date"), nums = of("num").filter((j) => !(info[j]!.intOnly && REF_H.test(t.headers[j]!))) /* a whole-number column named like an id is a reference, not money */, texts = of("text");
    const date = dates.find((j) => DATE_H.test(t.headers[j]!)) ?? dates[0]; if (date === undefined) return null;
    const amount = nums.find((j) => AMT_H.test(t.headers[j]!)) ?? null, inn = nums.find((j) => IN_H.test(t.headers[j]!)), out = nums.find((j) => OUT_H.test(t.headers[j]!) && j !== inn);
    const pair = amount === null && inn !== undefined && out !== undefined;
    if (amount === null && !pair && !nums.length) return null;
    const ref = [...texts, ...of("num")].find((j) => REF_H.test(t.headers[j]!) && !DESC_H.test(t.headers[j]!) && j !== amount) ?? null;
    const desc = texts.filter((j) => j !== ref).sort((x, y) => (DESC_H.test(t.headers[y]!) ? 1 : 0) - (DESC_H.test(t.headers[x]!) ? 1 : 0) || info[y]!.unique - info[x]!.unique)[0] ?? null;
    return { date, amount: pair ? null : amount ?? nums[0]!, in: pair ? inn! : null, out: pair ? out! : null, desc, ref, flip: false };
  };
  const a = pick(A), b = pick(B); if (!a || !b) return null;
  // Same sign or opposite: count lines that would line up (same amount, within the window) each way, on a sample.
  const w = { ...MATCH_DEFAULTS, ...o }.windowDays, la = linesOf(A, a).lines.slice(0, 5000), lb = linesOf(B, b).lines.slice(0, 5000);
  const count = (neg: boolean) => { const m = bucket(lb.map((x) => (neg ? { ...x, cents: -x.cents } : x))); return la.reduce((n, x) => n + ((m.get(x.cents) ?? []).some((y) => Math.abs(y.day - x.day) <= w) ? 1 : 0), 0); };
  return { a, b: { ...b, flip: count(true) > count(false) } };
};

/** A result as spreadsheet rows: one row per matched group, timing pair or unmatched line, with both sides' dates, descriptions and amounts. */
export const matchRows = (r: Omit<MatchResult, "skippedA" | "skippedB">, names: [string, string]): (string | number)[][] => {
  const d = (x: Line) => new Date(x.day * 864e5).toISOString().slice(0, 10), money = (l: Line[]) => (l.length ? sum(l) / 100 : "");
  const side = (l: Line[]) => [l.map(d).join(", "), l.map((x) => x.desc).join(" | "), money(l)];
  const head = ["Result", `Date (${names[0]})`, `Description (${names[0]})`, `Amount (${names[0]})`, `Date (${names[1]})`, `Description (${names[1]})`, `Amount (${names[1]})`, "Days apart"];
  const label: Record<GroupKind, string> = { "1:1": "Match", "many:1": `Match: ${names[0]} lines add up to one ${names[1]} line`, "1:many": `Match: ${names[1]} lines add up to one ${names[0]} line` };
  return [head,
    ...r.groups.map((g) => [label[g.kind], ...side(g.a), ...side(g.b), g.days]),
    ...r.timing.map((t) => [`Timing: same amount, ${t.days} days apart`, ...side([t.a]), ...side([t.b]), t.days]),
    ...r.onlyA.map((x) => [`Only in ${names[0]}`, ...side([x]), "", "", "", ""]),
    ...r.onlyB.map((x) => [`Only in ${names[1]}`, "", "", "", ...side([x]), ""])];
};
/** One line of the totals for people: what each side holds and what is left unexplained. */
export const summaryLine = (r: MatchResult, names: [string, string]) =>
  `${names[0]} ${fmtCents(r.totals.a)} · ${names[1]} ${fmtCents(r.totals.b)} · difference ${fmtCents(r.totals.a - r.totals.b)} · timing ${fmtCents(r.totals.timingA - r.totals.timingB)} · unexplained ${fmtCents(r.totals.onlyA - r.totals.onlyB)}`;
