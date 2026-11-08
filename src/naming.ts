const TAIL = /(?:account|acct)(?:\s?(?:number|no\.?|#|ending(?: in)?))?[\s:#xX*•.-]*(\d[\d-]{2,}\d(?: \d{3,4})*)\b/i; // "0000 1111 2222" counts as one number

/** Last 4 digits of the account number shown in the statement text, or null when none is found. */
export const accountLast4 = (lines: string[]): string | null => {
  for (const l of lines.slice(0, 80)) { const m = TAIL.exec(l.replace(/\s+/g, " ").slice(0, 300)); const d = m?.[1]?.replace(/\D/g, ""); if (d && d.length >= 4) return d.slice(-4); }
  return null;
};

export const cleanLabel = (s: string): string => s.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Standard name: <YYYYMM>_<Bank-Type>_Statement.pdf, e.g. 202610_Citi-Savings_Statement.pdf (date first so files stack chronologically), month taken from the statement period end. A clash gets -2, -3 ... */
export const statementName = (label: string, periodEnd: string, taken: ReadonlySet<string> = new Set()): string => {
  const l = cleanLabel(label), m = /^(\d{4})-(\d{2})-\d{2}$/.exec(periodEnd)?.slice(1, 3).join("");
  if (!l) throw new Error("Account label is empty after cleaning; use letters, digits, - or _.");
  if (!m) throw new Error("Statement period end is not a valid date.");
  const base = `${m}_${l}_Statement`;
  let n = 1, name = `${base}.pdf`;
  while (taken.has(name)) name = `${base}-${++n}.pdf`;
  return name;
};

/** Banks and card issuers by the names their statements print. Short names are what the file name uses. */
const BANKS: [RegExp, string][] = [
  [/american express|americanexpress|\bamex\b/i, "Amex"], [/jpmorgan chase|chase\.com|\bchase\b/i, "Chase"], [/bank of america|bankofamerica/i, "BofA"], [/wells fargo|wellsfargo/i, "WellsFargo"],
  [/citibank|citi\.com|\bciti\b|citibusiness/i, "Citi"], [/capital one|capitalone/i, "CapitalOne"], [/u\.s\. bank|\bus bank\b|usbank/i, "USBank"], [/\bpnc\b/i, "PNC"], [/truist/i, "Truist"],
  [/\btd bank\b/i, "TD"], [/discover (bank|card|it\b)|discover\.com/i, "Discover"], [/barclays/i, "Barclays"], [/synchrony/i, "Synchrony"], [/navy federal/i, "NavyFederal"],
  [/charles schwab|schwab bank/i, "Schwab"], [/ally bank/i, "Ally"], [/fifth third/i, "FifthThird"], [/keybank/i, "KeyBank"], [/huntington national|huntington bank/i, "Huntington"],
  [/regions bank|regions\.com/i, "Regions"], [/m&t bank|m and t bank/i, "MTBank"], [/citizens bank/i, "Citizens"], [/\bbmo\b|bank of the west/i, "BMO"], [/city national bank/i, "CityNational"],
  [/east west bank/i, "EastWest"], [/cathay bank/i, "Cathay"], [/banc of california/i, "BancOfCalifornia"], [/first citizens/i, "FirstCitizens"], [/silicon valley bank|\bsvb\b/i, "SVB"],
  [/comerica/i, "Comerica"], [/frost bank/i, "Frost"], [/santander/i, "Santander"], [/\bhsbc\b/i, "HSBC"], [/goldman sachs|apple card/i, "AppleCard"], [/\busaa\b/i, "USAA"],
  [/mercury technologies|mercury\.com/i, "Mercury"], [/\bbrex\b/i, "Brex"], [/ramp business|ramp\.com/i, "Ramp"], [/bluevine/i, "Bluevine"], [/relay financial|relayfi/i, "Relay"],
];
const KIND = /\b(money market|savings|checking)\b/i, DATED = /^(\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\.? \d{1,2}\b)/;

/** "<Bank>-<Type>" from the statement text, e.g. "Chase-Checking", "Amex-Credit-Card", "Citi-Savings"; null when the bank is not recognised.
 *  Looks at the header (the lines before the first transaction), where the bank prints its own name, so a payee like "CHASE CREDIT CRD AUTOPAY" further down cannot rename the file;
 *  falls back to the legal-name footer lines ("... Bank, N.A.", "Member FDIC"). */
export const detectLabel = (lines: string[], card: boolean): string | null => {
  const first = lines.findIndex((l) => DATED.test(l.trim()) && /\d\.\d{2}\b/.test(l)), head = lines.slice(0, Math.min(40, first < 0 ? 40 : first));
  const find = (ls: string[]) => { let best: [number, string] | null = null; for (const [re, n] of BANKS) { const i = ls.findIndex((l) => re.test(l)); if (i >= 0 && (!best || i < best[0])) best = [i, n]; } return best?.[1] ?? null; };
  const bank = find(head) ?? find(lines.filter((l) => /member fdic|\bn\.a\.|national association|equal housing lender/i.test(l)));
  if (!bank) return null;
  const k = card ? "Credit-Card" : (head.map((l) => KIND.exec(l)?.[1]).find(Boolean) ?? "checking").toLowerCase().replace(" ", "-");
  return cleanLabel(`${bank}-${k.replace(/(^|-)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())}`);
};
