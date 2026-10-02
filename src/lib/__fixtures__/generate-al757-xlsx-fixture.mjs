#!/usr/bin/env node
// Prompt AL757 — regenerates al757-table-starts-at-c3.xlsx. Run with:
//   node src/lib/__fixtures__/generate-al757-xlsx-fixture.mjs
//
// A real spreadsheet investor's table that doesn't start at A1 — the exact
// shape stripEmptyRowsAndColumns/detectHeaderAndMapping exist to handle:
// two blank rows above it, two blank columns to its left, header at C3.
// Mirrors al757-file2-blank-row-col.csv's own content so the same
// assertions apply regardless of file format.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';

const HEADER = ['Name', 'Ticket', 'Sector', 'Location', 'Mail', 'Tel.', 'Date'];
const ROW1 = ['Test1', 100000, 'Digital Health', 'Portugal', 'test1@example.com', '+351 912345678', '2025-01-01'];
const ROW2 = ['Test2', 45000, 'MedTec', 'Spain', 'test2@example.com', '+34 612345678', '2022-09-04'];

// Built as one grid with literal blank cells, rather than aoa_to_sheet +
// a {origin: 'C3'} write — simpler, and avoids relying on that API's own
// handling of a worksheet that doesn't exist yet.
const grid = [
  [],
  [],
  ['', '', ...HEADER],
  ['', '', ...ROW1],
  ['', '', ...ROW2],
];
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(grid);
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

const outPath = join(dirname(fileURLToPath(import.meta.url)), 'al757-table-starts-at-c3.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`written: ${outPath}`);
console.log('table starts at C3 — rows 1-2 and columns A-B are blank');
