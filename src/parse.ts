import { toCents } from "./money.ts";
import { toIsoDate } from "./dates.ts";

export interface Txn { id: string; date: string; cents: number; desc: string; num: string; acct?: string }
export interface Parsed { txns: Txn[]; skipped: { row: number; reason: string }[]; headerRow: number }

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const A = {
  date: ["date", "transactiondate", "postingdate", "posteddate", "trandate", "postdate"],
  amount: ["amount", "amt", "transactionamount"],
  out: ["debit", "debits", "withdrawal", "withdrawals", "moneyout", "paidout", "payment", "payments"],
  inn: ["credit", "credits", "deposit", "deposits", "moneyin", "paidin"],
  desc: ["description", "memo", "memodescription", "name", "payee", "originaldescription", "details", "vendor", "customer"],
  acct: ["accountname", "account", "bankaccount"],
  num: ["num", "no", "ref", "reference", "referenceno", "checknumber", "checkno", "docnum"],
};
const idx = (h: string[], names: string[]): number[] => h.flatMap((x, i) => (names.includes(x) ? [i] : []));

/** Reads a QuickBooks or bank export (title rows above the header are fine). Amounts are signed from the bank account's view: deposits positive. */
export const parseLedger = (rows: string[][], source: "qbo" | "bank", opts: { invert?: boolean } = {}): Parsed => {
  let hr = -1, h: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 60) && hr < 0; i++) {
    const n = rows[i]!.map(norm);
    if (idx(n, A.date).length && (idx(n, A.amount).length || (idx(n, A.out).length && idx(n, A.inn).length) || idx(n, A.out).length + idx(n, A.inn).length)) { hr = i; h = n; }
  }
  if (hr < 0) throw new Error(`${source === "qbo" ? "QuickBooks" : "Bank"} file: no header row with a date and an amount (or debit/credit) column. First row seen: ${(rows[0] ?? []).slice(0, 8).join(" | ")}`);
  const [di] = idx(h, A.date), [ai] = idx(h, A.amount), [oi] = idx(h, A.out), [ii] = idx(h, A.inn), [ni] = idx(h, A.num), [ci] = idx(h, A.acct);
  const dc = idx(h, A.desc), sign = opts.invert ? -1 : 1;
  const txns: Txn[] = [], skipped: Parsed["skipped"] = [];
  rows.slice(hr + 1).forEach((r, k) => {
    const row = hr + k + 2, date = toIsoDate(r[di!]);
    if (!date) { if (r.some((x) => x.trim())) skipped.push({ row, reason: "no date (total or note row)" }); return; }
    let c: number | null;
    if (ai !== undefined) c = toCents(r[ai]);
    else { const o = oi === undefined ? null : toCents(r[oi]), i = ii === undefined ? null : toCents(r[ii]); c = o === null && i === null ? null : (i ?? 0) - Math.abs(o ?? 0); }
    if (c === null) { skipped.push({ row, reason: "no readable amount" }); return; }
    const desc = [...new Set(dc.map((j) => (r[j] ?? "").trim()).filter(Boolean))].join(" ").slice(0, 1000);
    const acct = ci === undefined ? "" : (r[ci] ?? "").trim();
    txns.push({ id: `${source}:${row}`, date, cents: c * sign, desc, num: ni === undefined ? "" : (r[ni] ?? "").trim(), ...(acct && { acct }) });
  });
  return { txns, skipped, headerRow: hr + 1 };
};
