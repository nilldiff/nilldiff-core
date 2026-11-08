const NUM = /^(-?)(\d*)(?:\.(\d+))?$/;

/** Money text or number to integer cents. Accepts $, commas, (parens), a leading + or minus (including the typographic − and –) and a trailing minus. A CR or DR suffix is dropped: what it means depends on the statement, so the caller reads it. null when not money. */
export const toCents = (v: string | number | null | undefined): number | null => {
  let s = String(v ?? "").trim().replace(/\s?(?:CR|DR)$/i, "").replace(/[$€£\s,]/g, "").replace(/^[−–]/, "-").replace(/^\+/, "");
  if (!s || s === "-") return null;
  const neg = /^\(.*\)$/.test(s) || s.endsWith("-") || s.startsWith("-");
  s = s.replace(/^\(|\)$/g, "").replace(/^-|-$/g, "");
  const m = NUM.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const f = (m[3] ?? "").padEnd(3, "0");
  const c = Number(m[2] || 0) * 100 + Number(f.slice(0, 2)) + (Number(f[2]) >= 5 ? 1 : 0);
  return Number.isSafeInteger(c) && c <= 1e14 ? (neg ? -c : c) : null;
};

export const fmtCents = (c: number): string => {
  const a = Math.abs(c), s = `${Math.floor(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`;
  return c < 0 ? `(${s})` : s;
};

export const fmtPct = (p: number | null): string => (p === null ? "n/a" : `${p >= 0 ? "+" : ""}${(p * 100).toFixed(1)}%`);
