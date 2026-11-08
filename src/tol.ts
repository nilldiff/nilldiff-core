import type { ColType } from "./table.ts";

/** A free-form tolerance typed by the user. Numbers: "1" or "$1" (dollars), "0.1%", or both ("1 or 0.1%"). Dates: "3" or "3 days". Text: "ignore case". Blank or "exact": no tolerance. */
export interface Tol { abs: number; pct: number; ci: boolean }
export const EXACT: Tol = { abs: 0, pct: 0, ci: false };
export const parseTol = (text: string, type: ColType): Tol | string => {
  const s = text.trim().toLowerCase().replace(/[±]|\+-/g, "");
  if (!s || s === "exact" || /^0+(\.0+)?$/.test(s)) return EXACT;
  if (type === "text") return /^(ci|case|ignore case|case.?insensitive)$/.test(s) ? { ...EXACT, ci: true } : "Text: type exact or ignore case.";
  const t = { ...EXACT };
  for (const p of s.replace(/(\d)\s+(?=d(ays?)?\b)/g, "$1").split(/[\s,;/]+|\bor\b/).filter(Boolean)) {
    const m = /^\$?(\d*\.?\d+)(%|d|days?)?$/.exec(p);
    if (!m) return type === "date" ? "Dates: a number of days, e.g. 3." : "Amounts: dollars or a percent, e.g. 1 or 0.1%.";
    const v = Number(m[1]), u = m[2];
    if (type === "date") { if (u === "%") return "Dates: a number of days, e.g. 3."; t.abs = Math.max(t.abs, v); }
    else if (u === "%") t.pct = Math.max(t.pct, v / 100);
    else if (u) return "Amounts: dollars or a percent, e.g. 1 or 0.1%.";
    else t.abs = Math.max(t.abs, Math.round(v * 100)); // cents
  }
  return t;
};
/** Whether a gap d (cents, or days) around the winning value w is inside the tolerance. */
export const within = (d: number, w: number, t: Tol): boolean => Math.abs(d) <= t.abs + 1e-9 || (t.pct > 0 && Math.abs(d) <= t.pct * Math.abs(w) + 1e-9);
