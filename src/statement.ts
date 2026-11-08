import { toCents } from "./money.ts";
import { toIsoDate } from "./dates.ts";
import type { Txn } from "./parse.ts";
import type { Cell } from "./pdftext.ts";

export interface Statement {
  txns: Txn[]; skipped: { line: number; text: string; reason: string }[];
  period: { from: string; to: string } | null;
  card: boolean; // a credit card statement: charges add to the balance, payments reduce it
  check: { begin: number | null; end: number | null; sum: number; ok: boolean | null };
}
export class StatementError extends Error {}

const MON = "(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?";
const MONEY = /(?:[-−–+] ?(?=\$)|[-(−–+])?\$?(?:\d{1,3}(?:,\d{3})+|\d{1,15})\.\d{2}\)?(?:-|\s?(?:CR|DR)\b)?/g, ONE_MONEY = new RegExp(`^${MONEY.source}$`);
const FULL = `(?:${MON} \\d{1,2},? ?\\d{4}|\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`, SEP = "\\s*(?:-|–|through|thru|to)\\s*";
const RANGE = new RegExp(`(${FULL})${SEP}(${FULL})`, "i"), RANGE_NOYEAR = new RegExp(`\\b(${MON} \\d{1,2})${SEP}(${MON} \\d{1,2},? ?\\d{4})`, "i");
const LEAD = new RegExp(`^(?:(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?|(\\d{4})-(\\d{2})-(\\d{2})|(${MON})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?)\\*?(?=\\s|$)`, "i");
const CHECKS = new RegExp(`(?:^|\\s)(\\d{3,7})\\s*[*^]?\\s+(\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)\\s+(${MONEY.source})`, "g"), CHECK_ROW = /^\d{3,7}\s*[*^]?\s+\d{1,2}\/\d{1,2}\b/;
const MAX_TXNS = 20_000, MAX_DESC = 1000; // a hostile PDF could otherwise grow one description past what an Excel cell holds
const NEW_CHARGES = /^new charges\b/i, SECTION = /^(detail( continued)?|amount|payments and credits|summary)\b/i;
const CLOSING = new RegExp(`(?:closing date|statement closing date|statement date|period ending|statement ending)\\s*:?\\s*(${FULL})`, "i"), DAYS = /days in billing period:?\s+(\d{1,3})/i, TOTAL = /\baccount total\s*$/i;
const BAL_ON = /(beginning|ending) balance on (\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i;
const CREDIT_HDR = /^(deposits?|credits?|additions?|other credits|interest|transfers? in)\b/i;
const DEBIT_HDR = /^(withdrawals?|debits?|checks?|electronic|atm|fees?|service charges?|other debits|subtractions?|transfers? out|payments?|purchases?)\b/i;
const BAL_TABLE = /^(daily (ending |ledger )?balances?|daily balance summary|balance summary|ending daily balance summary)\b/i; // a table of dates and balances, not transactions
const NOISE = /page \d+ of \d+|continued|^total\b|daily (ending )?balance/i;
const BEGIN = /^(beginning|opening|previous|starting) balance|^balance (forward|last statement)/i, END = /^(ending|closing|new) balance|^balance this statement/i;
const COL_IN = /^(deposits?|credits?|additions?|money in|amount credited)\b/i, COL_OUT = /^(withdrawals?|debits?|subtractions?|charges?|money out|amount debited|checks? (paid|and|&|\/))/i, COL_BAL = /\bbalance\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNo = (s: string): number => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
const iso = (s: string): string | null => toIsoDate(s.replace(/\.(?= )/, "").replace(/(\d),(\d)/, "$1, $2").replace(/^([a-z]{3})[a-z]*/i, "$1"));
const mid = (c: Cell): number => (c.x0 + c.x1) / 2;

/** Transactions from the text lines of a bank or card statement. Signs come, in order, from the column an amount sits under (when the PDF's cells are given),
 *  the running balance, an explicit sign (minus, parentheses, CR/DR), else the section header; anything unclear is left out and reported, so the begin + sum = end check fails instead of guessing. */
export const parseStatement = (lines: string[], cells?: Cell[][]): Statement => {
  const head = lines.slice(0, 80), anyYear = lines.slice(0, 60).join(" ").match(/\b20\d\d\b/)?.[0];
  let period: Statement["period"] = null;
  for (const l of head.slice(0, 60)) {
    if (period) break;
    const m = RANGE.exec(l), f = m && iso(m[1]!), t = m && iso(m[2]!);
    if (f && t) { period = { from: f, to: t }; break; }
    const n = RANGE_NOYEAR.exec(l), to = n && iso(n[2]!);
    if (n && to) { const y = +to.slice(0, 4) - (monthNo(n[1]!) > +to.slice(5, 7) ? 1 : 0), from = iso(`${n[1]!}, ${y}`); if (from) period = { from, to }; }
  }
  if (!period) { // "Beginning balance on 1/1 ... Ending balance on 1/31": the year comes from the header
    const on = (k: string) => lines.map((l) => BAL_ON.exec(l)).find((m) => m && m[1]!.toLowerCase() === k)?.[2], b = on("beginning"), e = on("ending");
    const at = (s: string, y: number) => toIsoDate(s.split("/").length === 3 ? s : `${s}/${y}`);
    if (b && e && anyYear) { const to = at(e, +anyYear), from = at(b, +anyYear - (+b.split("/")[0]! > +e.split("/")[0]! ? 1 : 0)); if (from && to) period = { from, to }; }
  }
  if (!period) { // card statements show only a closing date: the period is the billing-cycle days (default 30) back from it
    const to = head.map((l) => CLOSING.exec(l)?.[1]).filter(Boolean).map((s) => iso(s!)).find(Boolean), n = Math.min(62, Math.max(1, +(head.map((l) => DAYS.exec(l)?.[1]).find(Boolean) ?? 30)));
    if (to) period = { from: new Date(Date.parse(`${to}T00:00:00Z`) - (n - 1) * 864e5).toISOString().slice(0, 10), to };
  }
  const yearOf = (mo: number, y?: string): number => {
    if (y) return y.length === 2 ? 2000 + +y : +y;
    if (period) { const [fy, fm] = period.from.split("-").map(Number) as [number, number], ty = +period.to.slice(0, 4); return fy === ty ? fy : mo >= fm ? fy : ty; }
    if (anyYear) return +anyYear;
    throw new StatementError("Could not find the statement year. Dates have no year and no statement period was found.");
  };
  /** The date a line starts with, and the rest; a second date right after it (card "transaction date, posting date") is the posting date and is the one used. */
  const lead = (s: string): { mo: number; day: number; y?: string; rest: string } | null => {
    const m = LEAD.exec(s);
    if (!m) return null;
    const d = m[1] ? { mo: +m[1], day: +m[2]!, y: m[3] } : m[4] ? { mo: +m[5]!, day: +m[6]!, y: m[4] } : { mo: monthNo(m[7]!), day: +m[8]!, y: m[9] };
    return { ...d, rest: s.slice(m[0].length).trim() };
  };

  const card = head.some((l) => /minimum payment due|payment due date|new charges|credit limit|available credit|pay over time/i.test(l));
  const signOf = (tok: string): number => (/CR$/i.test(tok) ? (card ? -1 : 1) : /DR$/i.test(tok) ? (card ? 1 : -1) : /^[-(−–]|\)$|-$/.test(tok) ? -1 : /^\+/.test(tok) ? 1 : 0);
  const txns: Txn[] = [], skipped: Statement["skipped"] = [];
  let sign = 0, prevBal: number | null = null, begin: number | null = null, end: number | null = null, last: Txn | null = null, inBalTable = false;
  let cols: { in: Cell; out: Cell; bal: Cell } | null = null, prevCells: Cell[] = [];
  const add = (i: number, date: string, cents: number, desc: string, num: string) => { // a check listed again in a "checks paid" summary is the same check
    if (num && txns.some((t) => t.num === num && Math.abs(t.cents) === Math.abs(cents))) { last = null; return; }
    last = { id: `bank:${i + 1}`, date, cents, desc: desc.slice(0, MAX_DESC), num }; txns.push(last);
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s{2,}/g, "  ").trim(), money = line.match(MONEY) ?? [], cs = cells?.[i] ?? [];
    if (!card && cs.length && !money.length) { // a column header row ("Deposits/Credits  Withdrawals/Debits  Balance"), possibly split over two lines
      const both = [...prevCells, ...cs], ci = both.find((c) => COL_IN.test(c.s)), co = both.find((c) => COL_OUT.test(c.s) && c !== ci), cb = both.find((c) => COL_BAL.test(c.s) && c !== ci && c !== co);
      if (ci && co && cb) { cols = { in: ci, out: co, bal: cb }; inBalTable = false; sign = 0; last = null; prevCells = cs; return; }
    }
    prevCells = money.length ? [] : cs;
    if (TOTAL.test(line)) { begin = end = prevBal = null; last = null; return; } // card statements repeat the balances per portion: the Account Total block is the one that ties out
    if (BEGIN.test(line) && money.length) { begin ??= toCents(money[0]!); prevBal ??= begin; last = null; return; }
    if (END.test(line) && money.length) { end ??= toCents(money[money.length - 1]!); last = null; return; }
    if (!money.length && BAL_TABLE.test(line)) { inBalTable = true; last = null; return; }
    if (!card && CHECK_ROW.test(line)) { // a checks-paid table: "1234  01/10  500.00  1235 * 01/12  250.00"
      for (const m of line.matchAll(CHECKS)) { const [mo, day, y] = m[2]!.split("/"), date = toIsoDate(`${yearOf(+mo!, y)}-${mo}-${day}`), a = toCents(m[3]!); if (date && a !== null) add(i, date, -Math.abs(a), `CHECK ${m[1]}`, m[1]!); }
      last = null; return;
    }
    const d = RANGE.test(line) && !money.length ? null : lead(line);
    if (!d) {
      if (!money.length && card && line.length <= 60 && /^(transactions|purchases( and adjustments)?|charges)\b/i.test(line)) { sign = 1; last = null; return; }
      if (!money.length && NEW_CHARGES.test(line)) { sign = 1; inBalTable = false; last = null; return; } // card charges are unsigned and add to the balance
      if (!money.length && SECTION.test(line)) { if (/payments and credits/i.test(line)) sign = card ? -1 : 0; inBalTable = false; last = null; return; } // a combined heading must not keep the charges' sign
      if (!money.length && !NOISE.test(line) && line.length <= 60 && !/\d/.test(line) && (CREDIT_HDR.test(line) || DEBIT_HDR.test(line))) { sign = card ? (/^(payments?|credits?|deposits?)/i.test(line) ? -1 : 1) : CREDIT_HDR.test(line) && !/^(checks?|fees?)/i.test(line) ? 1 : -1; inBalTable = false; last = null; return; }
      if (last && !money.length && !NOISE.test(line)) last.desc = `${last.desc} ${line}`.trim().slice(0, MAX_DESC);
      else last = null;
      return;
    }
    if (inBalTable) return;
    if (!(line.match(MONEY) ?? []).length && last && /^[\d/\s]*$/.test(d.rest)) { last.desc = `${last.desc} ${line}`.trim().slice(0, MAX_DESC); return; } // arrival/departure or rental date lines under a charge
    const use = lead(d.rest) ?? d, rest = use.rest;
    const date = toIsoDate(`${yearOf(use.mo, use.y)}-${use.mo}-${use.day}`), toks = rest.match(MONEY) ?? [];
    let desc = rest.replace(MONEY, " ").replace(/\s+/g, " ").trim().slice(0, MAX_DESC), num = (/\bcheck\s*(?:no\.?|#)?\s*(\d{3,})/i.exec(desc) ?? /^(\d{3,7})\s+check\b/i.exec(desc))?.[1] ?? "";
    if (!num && /^\d{3,7}$/.test(desc) && sign < 0 && !card) { num = desc; desc = `CHECK ${desc}`; } // date, check number, amount under a Checks heading
    if (!date) { skipped.push({ line: i + 1, text: line, reason: "not a valid date" }); last = null; return; }
    if (!toks.length && NOISE.test(line)) { last = null; return; } // "January 31, 2026  Page 1 of 3"
    if (!toks.length) { skipped.push({ line: i + 1, text: line, reason: "dated line without an amount" }); last = null; return; }
    let a = toCents(toks[0]!)!, cents: number | null = null, bal = toks.length >= 2 ? toCents(toks[toks.length - 1]!) : null;
    const c = cols as { in: Cell; out: Cell; bal: Cell } | null;
    if (c && cs.length) { // place each amount under its column by distance to the header (headers may be right-aligned or centred over the numbers)
      const near = (x: Cell) => ([["in", c.in], ["out", c.out], ["bal", c.bal]] as const).map(([k, h]) => [k, Math.min(Math.abs(x.x1 - h.x1), Math.abs(mid(x) - mid(h)))] as const).sort((p, q) => p[1] - q[1])[0]![0];
      const placed = cs.filter((x) => ONE_MONEY.test(x.s)).map((x) => [near(x), x.s] as const), amt = placed.find(([k]) => k !== "bal"), b = placed.find(([k]) => k === "bal");
      if (placed.length) bal = b ? toCents(b[1]) : null;
      if (amt) { a = toCents(amt[1])!; cents = (amt[0] === "in" ? 1 : -1) * Math.abs(a); }
    }
    if (cents === null && bal !== null && prevBal !== null) { const delta = bal - prevBal; if (Math.abs(delta) === Math.abs(a)) cents = delta; }
    if (cents === null) { const e = signOf(toks[0]!); cents = e ? e * Math.abs(a) : sign ? sign * Math.abs(a) : card ? Math.abs(a) : null; } // cards print payments and credits with a minus or CR, so an unsigned card amount is a charge
    if (bal !== null) prevBal = bal;
    if (cents === null) { skipped.push({ line: i + 1, text: line, reason: "could not tell deposit from withdrawal" }); last = null; return; }
    add(i, date, cents, desc, num);
  });
  if (txns.length > MAX_TXNS) throw new StatementError(`${txns.length} transactions in one statement is more than a real statement holds (limit ${MAX_TXNS}); not stored.`);
  const sum = txns.reduce((s, t) => s + t.cents, 0);
  return { txns, skipped, period, card, check: { begin, end, sum, ok: begin !== null && end !== null ? begin + sum === end : null } };
};
