const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
    ? `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
};
const year = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Date text, US m/d/y, ISO, "Jan 5, 2026" or an Excel serial to YYYY-MM-DD. null when not a date. */
export const toIsoDate = (v: string | number | null | undefined): string | null => {
  const s = String(v ?? "").trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s))) return iso(+m[1]!, +m[2]!, +m[3]!);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) return iso(year(m[3]!), +m[1]!, +m[2]!);
  if ((m = /^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/i.exec(s))) { const i = MONTHS.indexOf(m[1]!.toLowerCase()); return i < 0 ? null : iso(+m[3]!, i + 1, +m[2]!); }
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 25000 && +s < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5).toISOString().slice(0, 10);
  return null;
};

/** Month label ("Jan 2026", "January 2026", "Jan-26", "2026-01") to YYYY-MM. */
export const toMonth = (v: string): string | null => {
  const s = v.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})$/.exec(s))) return +m[2]! >= 1 && +m[2]! <= 12 ? s : null;
  if ((m = /^([a-z]{3})[a-z]*[ -](\d{2}|\d{4})$/i.exec(s))) { const i = MONTHS.indexOf(m[1]!.toLowerCase()); return i < 0 ? null : `${year(m[2]!)}-${String(i + 1).padStart(2, "0")}`; }
  return null;
};

export const dayDiff = (a: string, b: string): number => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
