import { dayDiff } from "./dates.ts";
import type { Txn } from "./parse.ts";

export interface Match { kind: "1:1" | "N:1" | "1:N"; qbo: Txn[]; bank: Txn[]; maxDays: number }
export interface Recon {
  matched: Match[]; unmatchedQbo: Txn[]; unmatchedBank: Txn[];
  qboCents: number; bankCents: number; matchedCents: number; unmatchedQboCents: number; unmatchedBankCents: number;
}
export interface ReconOpts { windowDays: number; maxGroup: number; poolCap: number }
const DEF: ReconOpts = { windowDays: 7, maxGroup: 5, poolCap: 18 };

const tok = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
const sim = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};
const sum = (t: Txn[]): number => t.reduce((s, x) => s + x.cents, 0);
const span = (t: Txn[]): number => Math.max(...t.map((x) => Math.abs(dayDiff(x.date, t[0]!.date))));

/** Smallest subset (2..maxK items) of same-sign candidates summing exactly to target. */
const subset = (c: Txn[], target: number, maxK: number): Txn[] | null => {
  const pick: Txn[] = [];
  const go = (start: number, k: number, left: number): boolean => {
    if (k === 0) return left === 0;
    for (let i = start; i < c.length; i++) {
      const v = c[i]!.cents;
      if (Math.abs(v) > Math.abs(left)) continue;
      pick.push(c[i]!);
      if (go(i + 1, k - 1, left - v)) return true;
      pick.pop();
    }
    return false;
  };
  for (let k = 2; k <= maxK; k++) { pick.length = 0; if (go(0, k, target)) return [...pick]; }
  return null;
};

/** Matches QuickBooks lines to bank lines: exact amount within a date window (best date and description first), then batched deposits and splits. */
const HOT = 40_000;
export const reconcile = (qbo: Txn[], bank: Txn[], o: Partial<ReconOpts> = {}): Recon => {
  const { windowDays: w, maxGroup, poolCap } = { ...DEF, ...o };
  const usedQ = new Set<string>(), usedB = new Set<string>(), matched: Match[] = [];

  const byCents = new Map<number, Txn[]>();
  for (const b of bank) (byCents.get(b.cents) ?? byCents.set(b.cents, []).get(b.cents)!).push(b);
  const toks = new Map<string, Set<string>>([...qbo, ...bank].map((t) => [t.id, tok(t.desc)]));
  const pairs: { q: Txn; b: Txn; cost: number }[] = [];
  // Amounts that repeat thousands of times would make O(n^2) pairs: match those in date order with two pointers instead.
  const qCount = new Map<number, Txn[]>();
  for (const q of qbo) (qCount.get(q.cents) ?? qCount.set(q.cents, []).get(q.cents)!).push(q);
  const hot = new Set([...qCount].filter(([c, qs]) => qs.length * (byCents.get(c)?.length ?? 0) > HOT).map(([c]) => c));
  for (const c of hot) {
    const qs = [...qCount.get(c)!].sort((x, y) => (x.date + x.id < y.date + y.id ? -1 : 1)), bs = [...byCents.get(c)!].sort((x, y) => (x.date + x.id < y.date + y.id ? -1 : 1));
    for (let i = 0, j = 0; i < qs.length && j < bs.length;) {
      const q = qs[i]!, b = bs[j]!, d = Math.abs(dayDiff(q.date, b.date));
      if (d <= w) { usedQ.add(q.id); usedB.add(b.id); matched.push({ kind: "1:1", qbo: [q], bank: [b], maxDays: d }); i++; j++; }
      else if (q.date < b.date) i++; else j++;
    }
  }
  for (const q of qbo) if (!hot.has(q.cents)) for (const b of byCents.get(q.cents) ?? []) {
    const d = Math.abs(dayDiff(q.date, b.date));
    if (d <= w) pairs.push({ q, b, cost: d + (1 - sim(toks.get(q.id)!, toks.get(b.id)!)) * 3 - (q.num && q.num === b.num ? 2 : 0) });
  }
  pairs.sort((x, y) => x.cost - y.cost || (x.q.id < y.q.id ? -1 : 1) || (x.b.id < y.b.id ? -1 : 1));
  for (const { q, b } of pairs) {
    if (usedQ.has(q.id) || usedB.has(b.id)) continue;
    usedQ.add(q.id); usedB.add(b.id);
    matched.push({ kind: "1:1", qbo: [q], bank: [b], maxDays: Math.abs(dayDiff(q.date, b.date)) });
  }

  const groups = (singles: Txn[], pool: Txn[], usedS: Set<string>, usedP: Set<string>, kind: "N:1" | "1:N") => {
    for (const s of singles) {
      if (usedS.has(s.id)) continue;
      const c = pool
        .filter((p) => !usedP.has(p.id) && Math.sign(p.cents) === Math.sign(s.cents) && Math.abs(p.cents) < Math.abs(s.cents) && Math.abs(dayDiff(p.date, s.date)) <= w)
        .sort((x, y) => Math.abs(dayDiff(x.date, s.date)) - Math.abs(dayDiff(y.date, s.date)) || (x.id < y.id ? -1 : 1))
        .slice(0, poolCap);
      const hit = c.length >= 2 ? subset(c, s.cents, maxGroup) : null;
      if (!hit) continue;
      usedS.add(s.id); hit.forEach((p) => usedP.add(p.id));
      matched.push(kind === "N:1" ? { kind, qbo: hit, bank: [s], maxDays: span([s, ...hit]) } : { kind, qbo: [s], bank: hit, maxDays: span([s, ...hit]) });
    }
  };
  groups(bank, qbo, usedB, usedQ, "N:1");
  groups(qbo, bank, usedQ, usedB, "1:N");

  const unmatchedQbo = qbo.filter((t) => !usedQ.has(t.id)), unmatchedBank = bank.filter((t) => !usedB.has(t.id));
  return {
    matched, unmatchedQbo, unmatchedBank,
    qboCents: sum(qbo), bankCents: sum(bank), matchedCents: matched.reduce((s, m) => s + sum(m.bank), 0),
    unmatchedQboCents: sum(unmatchedQbo), unmatchedBankCents: sum(unmatchedBank),
  };
};
