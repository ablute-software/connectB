// Prompt AL759 §A/§B — which mapping fields make sense for the destination,
// the collapsed mapping summary, and the preview classification — all pure.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPortfolioImportPlan, classifyItem, detectHeaderAndMapping, droppedExitNotice, effectiveMappingForDestination,
  errorRowsCsv, isAmbiguousDayDate, mappingSummary, needsReadAs, parsePortfolioCsvRows, planSummaryText, sampleItems,
  setIncludeForClass, shouldCollapseMapping, stripEmptyRowsAndColumns, summarizePlan, visibleMappingFields,
  PORTFOLIO_IMPORT_FIELDS, portfolioImportTemplateCsv, attentionItems,
} from './portfolio-import';

const FIXTURES = join(__dirname, '__fixtures__');
const load = (name: string) => parsePortfolioCsvRows(readFileSync(join(FIXTURES, name), 'utf8'));
const detect = (rows: string[][]) => detectHeaderAndMapping(stripEmptyRowsAndColumns(rows).rows);

describe('mapping fields by destination — Prompt AL759 §A', () => {
  const noStatus = { company_name: 0, exit_at: 1, exit_type: 2 };
  const withStatus = { company_name: 0, status: 1 };

  it('no status column + destination Current: exit_at, exit_type and status are hidden', () => {
    const v = visibleMappingFields({ company_name: 0 }, 'current');
    expect(v).not.toContain('exit_at');
    expect(v).not.toContain('exit_type');
    expect(v).not.toContain('status');
    expect(v).toContain('company_name');
    expect(v).toContain('contact_phone');
  });

  it('destination Past: the exit fields are shown', () => {
    const v = visibleMappingFields({ company_name: 0 }, 'past');
    expect(v).toContain('exit_at');
    expect(v).toContain('exit_type');
  });

  it('a file WITH a status column mapped shows everything, whatever the destination', () => {
    expect(visibleMappingFields(withStatus, 'current')).toEqual([...PORTFOLIO_IMPORT_FIELDS]);
    expect(visibleMappingFields(withStatus, 'past')).toEqual([...PORTFOLIO_IMPORT_FIELDS]);
  });

  it('changing the destination changes what is visible, immediately (pure in the destination)', () => {
    expect(visibleMappingFields({ company_name: 0 }, 'current')).not.toContain('exit_at');
    expect(visibleMappingFields({ company_name: 0 }, 'past')).toContain('exit_at');
  });

  it('into Current, auto-detected exit columns are dropped from the plan AND named in a notice', () => {
    const e = effectiveMappingForDestination(noStatus, 'current');
    expect(e.mapping).toEqual({ company_name: 0 });
    expect(e.droppedExitFields).toEqual(['exit_at', 'exit_type']);
    expect(droppedExitNotice(e.droppedExitFields)).toBe(
      'Exit date / Exit type found in the file but not imported: these apply to Past companies only. Import into Past, or move them later.',
    );
    expect(droppedExitNotice(['exit_type'])).toMatch(/^Exit type found in the file/);
  });

  it('into Past, or with a status column, nothing is dropped and there is no notice', () => {
    expect(effectiveMappingForDestination(noStatus, 'past')).toEqual({ mapping: noStatus, droppedExitFields: [] });
    expect(effectiveMappingForDestination({ ...noStatus, status: 3 }, 'current').droppedExitFields).toEqual([]);
    expect(droppedExitNotice([])).toBeNull();
  });

  it('a Past file imported into Current: no errors, the exit columns are named as not imported — nothing silent', () => {
    const rows = parsePortfolioCsvRows(portfolioImportTemplateCsv('past'));
    const det = detect(rows);
    const e = effectiveMappingForDestination(det.mapping, 'current');
    const plan = buildPortfolioImportPlan(rows, [], e.mapping, { defaultStatus: 'current' });
    for (const it of plan.items) {
      expect(it.errors).toEqual([]);
      expect(it.data?.status).toBe('current');
      expect(it.data?.exitAt).toBeUndefined();
      expect(it.data?.exitType).toBeUndefined();
    }
    expect(e.droppedExitFields).toEqual(['exit_at', 'exit_type']);
    const header = stripEmptyRowsAndColumns(rows).rows[det.headerRowIndex];
    expect(mappingSummary(header, e.mapping).notImported).toEqual(['exit_at', 'exit_type']);
    // Into Past the same file keeps them.
    const asPast = buildPortfolioImportPlan(rows, [], det.mapping, { defaultStatus: 'past' });
    expect(asPast.items[0].data?.exitType).toBe('acquisition');
  });
});

describe('collapsed mapping — Prompt AL759 §A', () => {
  it('Nuno\'s three files collapse to one summary line: every column matched, nothing not imported', () => {
    for (const name of ['al757-file1-en-header.csv', 'al757-file2-blank-row-col.csv', 'al757-file3-pt-header-blank-row-col.csv']) {
      const rows = load(name);
      const det = detect(rows);
      expect(shouldCollapseMapping(det.mapping, det.guessedFields)).toBe(true);
      const header = stripEmptyRowsAndColumns(rows).rows[det.headerRowIndex];
      const summary = mappingSummary(header, effectiveMappingForDestination(det.mapping, 'current').mapping);
      // These files have 7 columns (Name/Nome, Ticket, Sector, Location, Mail, Tel., Date/Quando) — all matched.
      expect(summary.text).toBe('7 columns matched');
      expect(summary.notImported).toEqual([]);
    }
  });

  it('names what was left out: "6 columns matched · 2 not imported: Notes, Owner"', () => {
    const rows = [['company_name', 'ticket_eur', 'country', 'sectors', 'invested_at', 'website', 'Notes', 'Owner'], ['Acme', '1', 'PT', 'EdTech', '2020', 'a.com', 'x', 'y']];
    const det = detect(rows);
    const header = stripEmptyRowsAndColumns(rows).rows[det.headerRowIndex];
    expect(mappingSummary(header, det.mapping).text).toBe('6 columns matched · 2 not imported: Notes, Owner');
  });

  it('a nameless column is called by its position', () => {
    expect(mappingSummary(['company_name', ''], { company_name: 0 }).text).toBe('1 column matched · 1 not imported: column 2');
  });

  it('opens by itself when a column was GUESSED from the values', () => {
    const headerless = [
      ['jane@acmehealth.com', 'https://acmehealth.com', '350.000', '15/03/2022'],
      ['john@oldrobotics.example', 'https://oldrobotics.example', '120.000', '01/06/2019'],
    ];
    const det = detect(headerless);
    expect(det.guessedFields.length).toBeGreaterThan(0);
    expect(shouldCollapseMapping(det.mapping, det.guessedFields)).toBe(false);
  });

  it('opens by itself when the company name was not found', () => {
    const rows = [['ticket_eur', 'country'], ['100', 'Portugal']];
    const det = detect(rows);
    expect(det.mapping.company_name).toBeUndefined();
    expect(shouldCollapseMapping(det.mapping, det.guessedFields)).toBe(false);
  });
});

// 48 plain rows, 1 with a warning, 1 with an error — the shape the prompt's
// own test describes.
function plan50() {
  const rows: string[][] = [['company_name', 'ticket_eur']];
  for (let i = 1; i <= 48; i++) rows.push([`Co ${i}`, '1000']);
  rows.push(['Warn Co', '1.500']);
  rows.push(['', '5']);
  return buildPortfolioImportPlan(rows, [], undefined, { defaultStatus: 'current' });
}

describe('preview summary — Prompt AL759 §B', () => {
  it('50 rows: 48 ready, 1 warning, 1 error -> "48 ready · 1 with warning · 1 error", importing 49', () => {
    const plan = plan50();
    const s = summarizePlan(plan.items);
    expect(s).toEqual({ ready: 48, withWarnings: 1, duplicates: 0, errors: 1, total: 50, included: 49 });
    expect(planSummaryText(s)).toBe('48 ready · 1 with warning · 1 error');
  });

  it('zero parts are left out and plurals agree', () => {
    expect(planSummaryText({ ready: 10, withWarnings: 0, duplicates: 0, errors: 0, total: 10, included: 10 })).toBe('10 ready');
    expect(planSummaryText({ ready: 48, withWarnings: 2, duplicates: 1, errors: 1, total: 52, included: 50 })).toBe('48 ready · 2 with warnings · 1 duplicate · 1 error');
    expect(planSummaryText({ ready: 0, withWarnings: 0, duplicates: 3, errors: 2, total: 5, included: 0 })).toBe('0 ready · 3 duplicates · 2 errors');
  });

  it('one class per row, worst first: an error beats a duplicate beats a warning', () => {
    const base = { data: { companyName: 'x', domain: null, sectors: [], status: 'current' as const }, errors: [], warnings: [], duplicate: null };
    const issue = { message: 'm', severity: 'error' as const };
    expect(classifyItem(base)).toBe('ready');
    expect(classifyItem({ ...base, warnings: [{ ...issue, severity: 'warning' }] })).toBe('warning');
    expect(classifyItem({ ...base, warnings: [{ ...issue, severity: 'warning' }], duplicate: { against: 'batch', reason: 'name' } })).toBe('duplicate');
    expect(classifyItem({ ...base, errors: [issue], duplicate: { against: 'batch', reason: 'name' } })).toBe('error');
    expect(classifyItem({ ...base, data: null })).toBe('error');
  });

  it('only the non-ready rows need attention; the sample is the first 5 usable rows, in file order', () => {
    const plan = plan50();
    expect(attentionItems(plan.items).map((i) => i.row)).toEqual([50, 51]);
    const sample = sampleItems(plan.items);
    expect(sample).toHaveLength(5);
    expect(sample.map((i) => i.data?.companyName)).toEqual(['Co 1', 'Co 2', 'Co 3', 'Co 4', 'Co 5']);
    // A row with an error is never in the sample.
    expect(sampleItems(plan.items, 100).some((i) => i.errors.length > 0)).toBe(false);
  });

  it('"Exclude all duplicates" unticks ONLY the duplicates; warnings stay included (and back again)', () => {
    const rows = [['company_name', 'ticket_eur'], ['Dup A', '100'], ['Dup B', '100'], ['Warn', '1.500'], ['Fine', '100'], ['', '1']];
    const plan = buildPortfolioImportPlan(rows, [{ companyName: 'Dup A', domain: null }, { companyName: 'Dup B', domain: null }]);
    const byName = (items: typeof plan.items) => Object.fromEntries(items.map((i) => [i.data?.companyName ?? '(none)', i.include]));
    // Duplicates start excluded.
    expect(byName(plan.items)).toEqual({ 'Dup A': false, 'Dup B': false, Warn: true, Fine: true, '(none)': false });
    const included = setIncludeForClass(plan.items, 'duplicate', true);
    expect(byName(included)).toEqual({ 'Dup A': true, 'Dup B': true, Warn: true, Fine: true, '(none)': false });
    const excluded = setIncludeForClass(included, 'duplicate', false);
    expect(byName(excluded)).toEqual({ 'Dup A': false, 'Dup B': false, Warn: true, Fine: true, '(none)': false });
    // "Exclude rows with warnings" touches only the warning row.
    expect(byName(setIncludeForClass(plan.items, 'warning', false))).toEqual({ 'Dup A': false, 'Dup B': false, Warn: false, Fine: true, '(none)': false });
  });

  it('an error row can never be switched on by a bulk action', () => {
    const plan = plan50();
    const all = setIncludeForClass(setIncludeForClass(plan.items, 'warning', true), 'duplicate', true);
    expect(all.find((i) => i.row === 51)?.include).toBe(false);
  });
});

describe('"read as" only where it earns its place — Prompt AL759 §B', () => {
  it('a day <= 12 non-ISO date is human-ambiguous; ISO and day > 12 are not', () => {
    expect(isAmbiguousDayDate('03/04/2022', '2022-04-03')).toBe(true);
    expect(isAmbiguousDayDate('15/03/2022', '2022-03-15')).toBe(false);
    expect(isAmbiguousDayDate('2022-04-03', '2022-04-03')).toBe(false);
    expect(isAmbiguousDayDate('05/05/2022', '2022-05-05')).toBe(false); // day == month: no swap to misread
    expect(isAmbiguousDayDate(undefined, undefined)).toBe(false);
  });

  it('a plain ready row has no "read as"; a warning row or an ambiguous date does', () => {
    const plan = buildPortfolioImportPlan([['company_name', 'invested_at', 'ticket_eur'], ['Plain', '15/03/2022', '100'], ['Amb', '03/04/2022', '100'], ['Warn', '15/03/2022', '1.500']], []);
    expect(plan.items.map(needsReadAs)).toEqual([false, true, true]);
  });
});

describe('Download rows with errors — Prompt AL759 §B', () => {
  it('writes the ORIGINAL rows with their error appended, header copied from the file, so it can be fixed in Excel and re-imported', () => {
    const fileRows = [
      ['', '', ''],
      ['Name', 'Ticket', 'Country'],
      ['Test1', '100k', 'Portugal'],
      ['', '200k', 'França'],
      ['Test3', 'abc', 'Spain'],
    ];
    const plan = buildPortfolioImportPlan(fileRows, []);
    const csv = errorRowsCsv({ fileRows, headerRowNumber: 2, items: plan.items });
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('Name,Ticket,Country,error');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(',200k,França,Company name is required.');
    expect(lines[2]).toBe('Test3,abc,Spain,"Could not parse ticket amount ""abc""."');
    // Round trip: the downloaded file is itself a valid import file.
    const again = buildPortfolioImportPlan(parsePortfolioCsvRows(csv), []);
    expect(again.items).toHaveLength(2);
  });

  it('is just the header when nothing failed', () => {
    const fileRows = [['company_name', 'ticket_eur'], ['Acme', '100']];
    const plan = buildPortfolioImportPlan(fileRows, []);
    expect(errorRowsCsv({ fileRows, headerRowNumber: 1, items: plan.items })).toBe('company_name,ticket_eur,error\n');
  });
});
