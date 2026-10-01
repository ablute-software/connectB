#!/usr/bin/env node
// Prompt AL756 — regenerates portfolio-import.xlsx. Run with:
//   node src/lib/__fixtures__/generate-portfolio-import-xlsx.mjs
//
// Deliberately writes INTEGER Excel serial numbers directly into cells —
// never a JS `Date` object through aoa_to_sheet, which is exactly the
// local-timezone-dependent path that corrupted the ORIGINAL version of this
// fixture (it stored 44634.99947916667, one day minus 45 seconds, instead
// of the clean 44635 a real Excel file always has for a date-only cell —
// see portfolio-import.ts's own xlsxCellToString header for the full
// account). This script's own output is therefore reproducible on any
// machine, in any time zone — there is no Date construction anywhere in it
// for the serial values themselves.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';

const HEADER = ['company_name', 'website', 'country', 'stage_at_entry', 'sectors', 'ticket_eur',
  'instrument', 'invested_at', 'status', 'exit_at', 'exit_type', 'contact_name', 'contact_email'];

// 44635 = 15 March 2022; 44743 = 1 July 2022 (days since the Excel epoch,
// 1899-12-30) — both integers, computed by hand against that epoch, not
// derived from a Date object.
const INVESTED_AT_SERIAL = 44635;

const row1 = [
  'Acme Health', 'https://acmehealth.com', 'Portugal', 'seed', 'digital health|diagnostics',
  350000, 'safe', INVESTED_AT_SERIAL, 'current', '', '', 'Jane Doe', 'jane@acmehealth.com',
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([HEADER, row1]);

// F2 = ticket_eur, a money-formatted number — must NOT be read as a date.
ws.F2.z = '€ #,##0.00';
// H2 = invested_at, a genuine date-formatted integer serial.
ws.H2.z = 'dd/mm/yyyy';

// N1 — outside every mapped column on purpose, a bare year-shaped NUMBER
// with no date format at all ('General'). Proves xlsxCellToString decides
// "is this a date" purely from the cell's own number format (XLSX.SSF.
// is_date(cell.z)), never from the magnitude of the number — a date-typed
// cell and a plain integer that happens to look like a year must not be
// confused in either direction.
//
// Setting a cell directly (rather than through aoa_to_sheet) does not
// extend the sheet's own '!ref' range — and a cell outside that range is
// silently dropped by XLSX.write/writeFile. Must extend it by hand.
ws.N1 = { t: 'n', v: 2019 };
const range = XLSX.utils.decode_range(ws['!ref']);
range.e.c = Math.max(range.e.c, XLSX.utils.decode_cell('N1').c);
range.e.r = Math.max(range.e.r, XLSX.utils.decode_cell('N1').r);
ws['!ref'] = XLSX.utils.encode_range(range);

XLSX.utils.book_append_sheet(wb, ws, 'Portfolio');

const outPath = join(dirname(fileURLToPath(import.meta.url)), 'portfolio-import.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`written: ${outPath}`);
console.log(`H2 (invested_at) serial: ${INVESTED_AT_SERIAL} -> expect 2022-03-15 in every time zone`);
