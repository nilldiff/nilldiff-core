# recon-core

The processing code behind [TieOut](#): it reads bank and card statement PDFs, QuickBooks reports and bank exports (CSV or xlsx), and reconciles them. It runs entirely in the browser. Files are read in memory and never uploaded, stored or logged.

This repo is public so anyone can check exactly what happens to their files.

## What it does

- `readFile(name, bytes)` → sources. A PDF statement is read from its text, with no OCR and nothing executed. A spreadsheet is read by its header row. A QuickBooks report with several accounts gives one source per account.
- `toRecords(sources)` merges statements of the same account (several months) and ledgers of the same account name.
- `groupRecords(records)` puts records for the same account together: same last 4 digits, or for a file with no account number, the account whose amounts it shares.
- `compare(precedence, other)` compares two records over the dates both cover:
  - exact amount within a 7-day window, best date and description first;
  - batched deposits and splits (up to 5 lines);
  - lines with the same date and description but a different amount, reported as "amount differs";
  - automatic sign flip when the other record uses the opposite convention.
- `ledgerRows(comparison)` gives the reconciled ledger. The record you choose takes precedence: its date, description and amount win. Lines only the other record has are listed after it.

Statement layouts read today, all tested on synthetic statements in `tests/fixtures` (invented numbers):
- sectioned (Deposits / Withdrawals / Checks / Fees);
- columnar (Deposits / Withdrawals / Balance, one- or two-line headers);
- running balance;
- signed amounts, CR/DR, (parentheses);
- checks-paid tables;
- card statements with transaction and posting dates and payments as negatives;
- numeric, month-name and ISO dates.

The bank and account type are read from the header for file naming (`<YYYYMM>_<Bank-Type>_Statement.pdf`).

Scanned (image-only) PDFs are not supported.

## Use

```sh
npm install
npm test
```

```ts
import { readFile, toRecords, groupRecords, compare, ledgerRows } from "recon-core/records";
```

In a browser, set `GlobalWorkerOptions.workerSrc` for `pdfjs-dist` before reading a PDF.

## Limits

These are built in so a hostile file can't hang a tab:
- 50 MB per file, 60 pages and 50,000 text lines per PDF;
- 20,000 transactions per statement;
- 2 million cells per spreadsheet;
- money as integer cents, capped at safe integers.

## License

AGPL-3.0-only. If you run a modified copy as a service, you must publish your changes.
