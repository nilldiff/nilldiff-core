# nildiff-core

The comparison engine behind [nildiff](https://www.nildiff.com). It compares two tables by a key column: what matches, what differs (with tolerances you set), and what exists on only one side. It runs entirely in the browser. Files are read in memory and never uploaded, stored or logged.

This repo is public so anyone can check exactly what happens to their files.

Results are produced automatically and provided as is, without warranty (see the license). They are not professional advice; check them against your source files before relying on them. This project is independent and not affiliated with any other company.

## What it does

- `readTable(name, bytes)` reads a spreadsheet (.xlsx), a CSV or a PDF with a text table into a `Table`. The header row is found automatically. A PDF's table is rebuilt from where each piece of text sits on the page, with no OCR and nothing in the PDF executed.
- `suggestMapping(a, b)` finds the key column the two tables share (unique, ID-like values) and pairs the other columns by name and by whether their values agree.
- `new Diff(a, b, mapping, { prec, tols })` compares every matched row. Amounts compare as numbers, dates as dates and text as text. Repeated keys are paired in file order. Tolerances are written plainly: `1`, `$1`, `0.1%`, `1 or 0.1%`, `3 days`, `ignore case`, `exact`.
- `diff.page(filter, offset, limit)` returns rows a page at a time; `diff.counts` and `diff.totals` summarise the result.
- `xlsxw` and `csv` write the result out.

Every test uses synthetic data (`tests/fixtures`, invented numbers).

Scanned (image-only) PDFs are not supported.

## Use

```sh
npm install
npm test
```

```ts
import { readTable } from "recon-core/table";
import { suggestMapping } from "recon-core/mapping";
import { Diff } from "recon-core/diff";
```

In a browser, call `setPdfWorker(url)` from `recon-core/pdftext` before reading a PDF.

## Limits

These are built in so a hostile file can't hang a tab:
- 50 MB per file, 150,000 rows and 200 columns per table;
- 60 pages, 50,000 text lines and 500,000 pieces of text per PDF;
- 8 million cells per CSV, counted while it is read;
- 2 million cells per spreadsheet;
- money as integer cents, capped at safe integers.

## License

AGPL-3.0-only. If you run a modified copy as a service, you must publish your changes.
