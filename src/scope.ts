import type { Txn } from "./parse.ts";
import { dayDiff } from "./dates.ts";

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** What a dropped spreadsheet is, judged from its first rows: a QuickBooks Transaction Report, an income statement by month, or a bank export. */
export const sniff = (rows: string[][]): "qbo" | "pnl" | "bank" => {
  const top = rows.slice(0, 60).map((r) => r.map(norm));
  if (top.some((r) => r.includes("transactiontype") && (r.includes("accountname") || r.includes("num")))) return "qbo";
  if (rows.slice(0, 8).some((r) => /profit and loss|income statement/i.test(r.join(" "))) && top.some((r) => r.filter((c) => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\d{2,4}$/.test(c)).length >= 2)) return "pnl";
  return "bank";
};

/** Distinct QuickBooks accounts in a multi-account report, in first-seen order. */
export const accounts = (t: Txn[]): string[] => [...new Set(t.flatMap((x) => (x.acct ? [x.acct] : [])))];

/** The QuickBooks account whose name carries the statement's last 4 digits, e.g. "Card (3008) - 2"; null when none or more than one does. */
export const pickAccount = (accts: string[], last4s: (string | null)[]): string | null => {
  const hit = accts.filter((a) => last4s.some((l) => l && a.includes(l)));
  return hit.length === 1 ? hit[0]! : null;
};

/** Statement lines that fall outside the dates QuickBooks covers (plus the match window): usually posted in the previous QuickBooks period, not missing. */
export const outsideQbo = (qbo: Txn[], bank: Txn[], windowDays: number): Txn[] => {
  if (!qbo.length) return [];
  const d = qbo.map((t) => t.date).sort(), lo = d[0]!, hi = d[d.length - 1]!;
  return bank.filter((b) => (b.date < lo && dayDiff(lo, b.date) > windowDays) || (b.date > hi && dayDiff(b.date, hi) > windowDays));
};
