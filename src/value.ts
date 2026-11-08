import { toIsoDate } from "./dates.ts";
import { toCents } from "./money.ts";
import type { ColType } from "./table.ts";

export const toDay = (s: string): number | null => { const d = toIsoDate(s); return d ? Date.parse(d) / 864e5 : null; };
/** A cell as a comparable value: cents for numbers, a day number for dates, tidy text otherwise; null when blank or not parseable as its column's type. */
export const typed = (type: ColType, s: string): number | string | null => !s.trim() ? null : type === "num" ? toCents(s) : type === "date" ? toDay(s) : s.trim().replace(/\s+/g, " ");
