import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  autoMapColumns, buildPortfolioImportPlan, detectDuplicateForEdit, detectDuplicates, formatDateDisplay,
  formatTicketDisplay, parsePortfolioCsvRows, parsePortfolioDate, parsePortfolioExitType, parsePortfolioFields,
  parsePortfolioInstrument, parsePortfolioRows, parsePortfolioSectors, parsePortfolioStage, parsePortfolioStatus,
  parsePortfolioXlsxRows, parseTicketAmount, portfolioImportTemplateCsv, detectCsvDelimiter, validateManualPortfolioInput,
} from './portfolio-import';

const FIXTURES = join(__dirname, '__fixtures__');

describe('parsePortfolioDate — Prompt 746 Phase 1 + Prompt 753', () => {
  it('accepts ISO yyyy-mm-dd as-is', () => {
    expect(parsePortfolioDate('2022-03-15')).toEqual({ iso: '2022-03-15', ambiguous: false });
  });

  it('reads DD/MM/YYYY as the Portuguese convention, never MM/DD', () => {
    // The 3rd of January, not the 1st of March — this is the exact
    // ambiguous case an MM/DD reading would silently get wrong.
    expect(parsePortfolioDate('03/01/2022')).toEqual({ iso: '2022-01-03', ambiguous: false });
  });

  it('reads DD-MM-YYYY (dash separator) the same way', () => {
    expect(parsePortfolioDate('15-03-2022')).toEqual({ iso: '2022-03-15', ambiguous: false });
  });

  it('reads DD.MM.YYYY (dot separator)', () => {
    expect(parsePortfolioDate('15.03.2022')).toEqual({ iso: '2022-03-15', ambiguous: false });
  });

  it('accepts a single-digit day/month', () => {
    expect(parsePortfolioDate('5/6/2022')).toEqual({ iso: '2022-06-05', ambiguous: false });
  });

  it('rejects an invalid calendar date (31 April)', () => {
    expect(parsePortfolioDate('31/04/2022')).toBeUndefined();
  });

  it('rejects a month out of range', () => {
    expect(parsePortfolioDate('15/13/2022')).toBeUndefined();
  });

  it('rejects garbage text', () => {
    expect(parsePortfolioDate('whenever')).toBeUndefined();
  });

  it('rejects an invalid ISO date (Feb 30)', () => {
    expect(parsePortfolioDate('2022-02-30')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parsePortfolioDate('')).toBeUndefined();
    expect(parsePortfolioDate('   ')).toBeUndefined();
  });

  it('reads a 2-digit year, flagged ambiguous (the century is a guess)', () => {
    expect(parsePortfolioDate('15/03/22')).toEqual({ iso: '2022-03-15', ambiguous: true });
    expect(parsePortfolioDate('15/03/75')).toEqual({ iso: '1975-03-15', ambiguous: true });
  });

  it('reads a bare year, flagged ambiguous', () => {
    expect(parsePortfolioDate('2019')).toEqual({ iso: '2019-01-01', ambiguous: true });
  });

  it('reads "15 Mar 2022" (English month abbreviation)', () => {
    expect(parsePortfolioDate('15 Mar 2022')).toEqual({ iso: '2022-03-15', ambiguous: false });
  });

  it('reads "15 March 2022" (full English month name)', () => {
    expect(parsePortfolioDate('15 March 2022')).toEqual({ iso: '2022-03-15', ambiguous: false });
  });

  it('reads "15 de março de 2022" (Portuguese, with accent and "de")', () => {
    expect(parsePortfolioDate('15 de março de 2022')).toEqual({ iso: '2022-03-15', ambiguous: false });
  });

  it('reads an Excel serial date number as text', () => {
    // 44635 = 15 March 2022 (days since 1899-12-30).
    expect(parsePortfolioDate('44635')).toEqual({ iso: '2022-03-15', ambiguous: false });
  });

  it('does not misread a short, unrelated number as a serial date', () => {
    expect(parsePortfolioDate('5')).toBeUndefined();
    expect(parsePortfolioDate('42')).toBeUndefined();
  });
});

describe('formatDateDisplay', () => {
  it('spells the date out, so a day/month swap is easy to spot', () => {
    expect(formatDateDisplay('2022-03-15')).toBe('15 Mar 2022');
  });
});

describe('parseTicketAmount — Prompt 746 Phase 1 + Prompt 753 (never guesses in silence)', () => {
  it('parses a bare integer', () => {
    expect(parseTicketAmount('350000')).toEqual({ value: 350000, ambiguous: false });
  });

  it('parses with thousands-separator commas', () => {
    expect(parseTicketAmount('350,000')).toEqual({ value: 350000, ambiguous: false });
  });

  it('parses a euro-prefixed amount', () => {
    expect(parseTicketAmount('€350000')).toEqual({ value: 350000, ambiguous: false });
  });

  it('parses a "k" suffix', () => {
    expect(parseTicketAmount('350k')).toEqual({ value: 350_000, ambiguous: false });
    expect(parseTicketAmount('€350k')).toEqual({ value: 350_000, ambiguous: false });
  });

  it('parses an "M" suffix, including a decimal', () => {
    expect(parseTicketAmount('1.2M')).toEqual({ value: 1_200_000, ambiguous: false });
    expect(parseTicketAmount('€1.2M')).toEqual({ value: 1_200_000, ambiguous: false });
  });

  it('parses a bare "M" (whole million)', () => {
    expect(parseTicketAmount('2M')).toEqual({ value: 2_000_000, ambiguous: false });
  });

  it('is case-insensitive on the suffix', () => {
    expect(parseTicketAmount('500K')).toEqual({ value: 500_000, ambiguous: false });
    expect(parseTicketAmount('1m')).toEqual({ value: 1_000_000, ambiguous: false });
  });

  it('tolerates internal spaces (e.g. "€ 350 k" pasted from a spreadsheet)', () => {
    expect(parseTicketAmount('€ 350 k')).toEqual({ value: 350_000, ambiguous: false });
  });

  it('returns undefined for unparseable text', () => {
    expect(parseTicketAmount('a lot')).toBeUndefined();
    expect(parseTicketAmount('abc')).toBeUndefined();
    expect(parseTicketAmount('')).toBeUndefined();
  });

  it('returns undefined for a negative amount', () => {
    expect(parseTicketAmount('-5')).toBeUndefined();
  });

  // --- Prompt 753 §A: the bug report's own worked examples ---

  it('reads "350.000" (PT thousands dot) as 350 000, confidently', () => {
    expect(parseTicketAmount('350.000')).toEqual({ value: 350_000, ambiguous: false });
  });

  it('reads "€350.000" the same way', () => {
    expect(parseTicketAmount('€350.000')).toEqual({ value: 350_000, ambiguous: false });
  });

  it('reads "350.000,00" (PT thousands dot + decimal comma) as 350 000', () => {
    expect(parseTicketAmount('350.000,00')).toEqual({ value: 350_000, ambiguous: false });
  });

  it('reads "€ 1.250.000" (multiple thousands groups) as 1 250 000, confidently', () => {
    expect(parseTicketAmount('€ 1.250.000')).toEqual({ value: 1_250_000, ambiguous: false });
  });

  it('reads "1,250.50" (US thousands comma + decimal dot) as 1250.5, rounded', () => {
    expect(parseTicketAmount('1,250.50')).toEqual({ value: 1251, ambiguous: false });
  });

  it('reads "1,5M" as 1 500 000, not 15 000 000 (Phase 1\'s own bug)', () => {
    expect(parseTicketAmount('1,5M')).toEqual({ value: 1_500_000, ambiguous: false });
  });

  it('reads "2,5 M" (space before suffix) as 2 500 000', () => {
    expect(parseTicketAmount('2,5 M')).toEqual({ value: 2_500_000, ambiguous: false });
  });

  it('reads "1.5k" as 1500', () => {
    expect(parseTicketAmount('1.5k')).toEqual({ value: 1500, ambiguous: false });
  });

  it('flags "1.500" (single 3-digit group, short leading digits) as ambiguous — reads 1500 but warns', () => {
    expect(parseTicketAmount('1.500')).toEqual({ value: 1500, ambiguous: true });
  });

  it('flags "1,500" the same way, mirrored', () => {
    expect(parseTicketAmount('1,500')).toEqual({ value: 1500, ambiguous: true });
  });

  it('rejects "1,5" with no suffix — never guesses a decimal reading in silence', () => {
    expect(parseTicketAmount('1,5')).toBeUndefined();
  });
});

describe('formatTicketDisplay', () => {
  it('shows the full number with thousands separators, not a compact form', () => {
    expect(formatTicketDisplay(350000)).toBe('€350,000');
  });
});

describe('parsePortfolioStatus — Prompt 753 §B (never defaults silently on a real value)', () => {
  it('defaults blank to current', () => {
    expect(parsePortfolioStatus('')).toBe('current');
  });

  it.each(['past', 'passado', 'Passado', 'EXITED', 'exit', 'saída', 'saida', 'vendido', 'realised', 'realized', 'written off'])(
    '"%s" reads as past', (v) => { expect(parsePortfolioStatus(v)).toBe('past'); },
  );

  it.each(['current', 'atual', 'Atual', 'ACTUAL', 'ativo', 'active', 'held', 'em carteira'])(
    '"%s" reads as current', (v) => { expect(parsePortfolioStatus(v)).toBe('current'); },
  );

  it('a genuinely unrecognized value is an error, never silently "current"', () => {
    expect(parsePortfolioStatus('whatever')).toBeUndefined();
    expect(parsePortfolioStatus('xyz')).toBeUndefined();
  });
});

describe('parsePortfolioStage — Prompt 753 §B', () => {
  it.each([
    ['Série A', 'series_a'], ['Series A', 'series_a'], ['A', 'series_a'], ['Seed', 'seed'],
    ['Pre-seed', 'pre_seed'], ['Pre seed', 'pre_seed'], ['Series C+', 'series_c_plus'],
    ['Series C', 'series_c_plus'], ['Series D', 'series_c_plus'], ['Growth', 'later'], ['Late', 'later'],
  ])('"%s" -> %s', (input, expected) => { expect(parsePortfolioStage(input)).toBe(expected); });

  it('a bare high letter (E, F, ...) still folds into series_c_plus', () => {
    expect(parsePortfolioStage('E')).toBe('series_c_plus');
    expect(parsePortfolioStage('Series F')).toBe('series_c_plus');
  });

  it('an unrecognized value is undefined (error)', () => {
    expect(parsePortfolioStage('banana')).toBeUndefined();
  });
});

describe('parsePortfolioInstrument — Prompt 753 §B', () => {
  it.each([
    ['Convertible', 'convertible_note'], ['Convertible note', 'convertible_note'],
    ['Nota convertível', 'convertible_note'], ['Ações', 'equity'], ['Shares', 'equity'],
    ['Equity', 'equity'], ['SAFE', 'safe'], ['ASA', 'other'],
  ])('"%s" -> %s', (input, expected) => { expect(parsePortfolioInstrument(input)).toBe(expected); });
});

describe('parsePortfolioExitType — Prompt 753 §B', () => {
  it.each([
    ['M&A', 'acquisition'], ['Aquisição', 'acquisition'], ['Venda', 'acquisition'],
    ['IPO', 'ipo'], ['Falência', 'write_off'],
  ])('"%s" -> %s', (input, expected) => { expect(parsePortfolioExitType(input)).toBe(expected); });
});

describe('parsePortfolioSectors — Prompt 753 §D', () => {
  it('splits on |, ;, comma, or /', () => {
    expect(parsePortfolioSectors('Digital Health|Diagnostics').sectors).toEqual(['Digital Health', 'Diagnostics']);
    expect(parsePortfolioSectors('Digital Health;Diagnostics').sectors).toEqual(['Digital Health', 'Diagnostics']);
    expect(parsePortfolioSectors('digital health, diagnostics').sectors.length).toBe(2);
    expect(parsePortfolioSectors('Digital Health/Diagnostics').sectors).toEqual(['Digital Health', 'Diagnostics']);
  });

  it('matches case-insensitively against the taxonomy and returns the canonical casing', () => {
    const { sectors, unmatched } = parsePortfolioSectors('digital health');
    expect(sectors).toEqual(['Digital Health']);
    expect(unmatched).toEqual([]);
  });

  it('keeps an unmatched sector as typed, flagged in `unmatched` rather than dropped', () => {
    const { sectors, unmatched } = parsePortfolioSectors('Digital Health|not-a-real-sector');
    expect(sectors).toEqual(['Digital Health', 'not-a-real-sector']);
    expect(unmatched).toEqual(['not-a-real-sector']);
  });
});

describe('detectCsvDelimiter — Prompt 753 §C', () => {
  it('detects a semicolon-delimited header (PT Excel export)', () => {
    expect(detectCsvDelimiter('company_name;website;ticket_eur\nAcme;https://acme.com;350000')).toBe(';');
  });

  it('detects a comma-delimited header', () => {
    expect(detectCsvDelimiter('company_name,website,ticket_eur\nAcme,https://acme.com,350000')).toBe(',');
  });

  it('detects a tab-delimited header', () => {
    expect(detectCsvDelimiter('company_name\twebsite\tticket_eur')).toBe('\t');
  });

  it('ignores a delimiter character sitting inside a quoted field', () => {
    expect(detectCsvDelimiter('"a;b;c";website\nAcme;https://acme.com')).toBe(';');
  });

  it('defaults to comma when nothing else is found', () => {
    expect(detectCsvDelimiter('single column header')).toBe(',');
  });
});

describe('parsePortfolioRows — Prompt 746 Phase 1', () => {
  const HEADER = ['company_name', 'website', 'country', 'stage_at_entry', 'sectors', 'ticket_eur',
    'instrument', 'invested_at', 'status', 'exit_at', 'exit_type', 'contact_name', 'contact_email'];

  function row(overrides: Record<string, string> = {}): string[] {
    const base: Record<string, string> = {
      company_name: 'Acme Health', website: 'https://acmehealth.com', country: 'Portugal',
      stage_at_entry: 'seed', sectors: 'digital health|diagnostics', ticket_eur: '350k',
      instrument: 'safe', invested_at: '15/03/2022', status: 'current', exit_at: '', exit_type: '',
      contact_name: 'Jane Doe', contact_email: 'jane@acmehealth.com',
    };
    const merged = { ...base, ...overrides };
    return HEADER.map((h) => merged[h] ?? '');
  }

  it('parses a fully valid row with no errors or warnings', () => {
    const [result] = parsePortfolioRows([HEADER, row()]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.data).toEqual({
      companyName: 'Acme Health', website: 'https://acmehealth.com', domain: 'acmehealth.com',
      country: 'Portugal', stageAtEntry: 'seed', sectors: ['Digital Health', 'Diagnostics'],
      ticketEur: 350_000, instrument: 'safe', investedAt: '2022-03-15', exitAt: undefined,
      exitType: undefined, contactName: 'Jane Doe', contactEmail: 'jane@acmehealth.com', status: 'current',
    });
  });

  it('carries the original cell text per mapped field in `raw`', () => {
    const [result] = parsePortfolioRows([HEADER, row({ ticket_eur: '350k' })]);
    expect(result.raw.ticket_eur).toBe('350k');
    expect(result.raw.company_name).toBe('Acme Health');
  });

  it('normalizes a website with www. into a bare domain', () => {
    const [result] = parsePortfolioRows([HEADER, row({ website: 'https://www.AcmeHealth.com/' })]);
    expect(result.data?.domain).toBe('acmehealth.com');
  });

  it('flags a missing company name and returns null data', () => {
    const [result] = parsePortfolioRows([HEADER, row({ company_name: '' })]);
    expect(result.data).toBeNull();
    expect(result.errors.some((e) => e.field === 'company_name')).toBe(true);
  });

  it('flags an unparseable ticket amount but keeps the rest of the row', () => {
    const [result] = parsePortfolioRows([HEADER, row({ ticket_eur: 'a lot of money' })]);
    expect(result.errors.some((e) => e.field === 'ticket_eur')).toBe(true);
    expect(result.data?.companyName).toBe('Acme Health');
    expect(result.data?.ticketEur).toBeUndefined();
  });

  it('warns (not errors) on an ambiguous ticket amount, and still provides a best-guess value', () => {
    const [result] = parsePortfolioRows([HEADER, row({ ticket_eur: '1.500' })]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.field === 'ticket_eur')).toBe(true);
    expect(result.data?.ticketEur).toBe(1500);
  });

  it('accepts a Portuguese-formatted stage with accents', () => {
    const [result] = parsePortfolioRows([HEADER, row({ stage_at_entry: 'Série A' })]);
    expect(result.errors).toEqual([]);
    expect(result.data?.stageAtEntry).toBe('series_a');
  });

  it('flags a genuinely unrecognized stage', () => {
    const [result] = parsePortfolioRows([HEADER, row({ stage_at_entry: 'banana' })]);
    expect(result.errors.some((e) => e.field === 'stage_at_entry')).toBe(true);
  });

  it('flags an unrecognized instrument', () => {
    const [result] = parsePortfolioRows([HEADER, row({ instrument: 'debt' })]);
    expect(result.errors.some((e) => e.field === 'instrument')).toBe(true);
  });

  it('flags a malformed contact email', () => {
    const [result] = parsePortfolioRows([HEADER, row({ contact_email: 'not-an-email' })]);
    expect(result.errors.some((e) => e.field === 'contact_email')).toBe(true);
  });

  it('defaults status to "current" when the column is blank', () => {
    const [result] = parsePortfolioRows([HEADER, row({ status: '' })]);
    expect(result.data?.status).toBe('current');
  });

  it('flags status values that are neither blank nor recognized — never silently "current" (Prompt 753\'s own bug)', () => {
    // `data` stays populated (same contract as any other field error, e.g.
    // an unparseable ticket amount above) — what actually blocks the row
    // from being imported is `errors.length > 0`, checked downstream by
    // buildPortfolioImportPlan/the commit route, not `data` being null.
    const [result] = parsePortfolioRows([HEADER, row({ status: 'Something Else Entirely' })]);
    expect(result.errors.some((e) => e.field === 'status')).toBe(true);
  });

  it('reads a Portuguese status alias ("Passado")', () => {
    const [result] = parsePortfolioRows([HEADER, row({ status: 'Passado', exit_at: '2023-09-01', exit_type: 'acquisition' })]);
    expect(result.errors).toEqual([]);
    expect(result.data?.status).toBe('past');
  });

  it('accepts exit_at/exit_type on a past row', () => {
    const [result] = parsePortfolioRows([HEADER, row({ status: 'past', exit_at: '2023-09-01', exit_type: 'acquisition' })]);
    expect(result.errors).toEqual([]);
    expect(result.data?.exitAt).toBe('2023-09-01');
    expect(result.data?.exitType).toBe('acquisition');
  });

  it('flags exit_at/exit_type present on a current row', () => {
    const [result] = parsePortfolioRows([HEADER, row({ status: 'current', exit_at: '2023-09-01', exit_type: 'acquisition' })]);
    expect(result.errors.some((e) => e.field === 'exit_at')).toBe(true);
    expect(result.errors.some((e) => e.field === 'exit_type')).toBe(true);
  });

  it('skips fully blank rows rather than reporting them as errors', () => {
    const results = parsePortfolioRows([HEADER, row(), HEADER.map(() => ''), row({ company_name: 'Second Co', website: '' })]);
    expect(results).toHaveLength(2);
  });

  it('returns nothing for a header-only file', () => {
    expect(parsePortfolioRows([HEADER])).toEqual([]);
  });

  it('returns nothing for a completely empty file', () => {
    expect(parsePortfolioRows([])).toEqual([]);
  });

  it('parses sectors on the pipe-delimited convention already used elsewhere in this codebase', () => {
    const [result] = parsePortfolioRows([HEADER, row({ sectors: 'FinTech & InsurTech | Digital Health |  ' })]);
    expect(result.data?.sectors).toEqual(['FinTech & InsurTech', 'Digital Health']);
  });

  it('warns on a sector that does not match the taxonomy, but keeps it', () => {
    const [result] = parsePortfolioRows([HEADER, row({ sectors: 'not-a-real-sector' })]);
    expect(result.warnings.some((w) => w.field === 'sectors')).toBe(true);
    expect(result.data?.sectors).toEqual(['not-a-real-sector']);
  });

  it('works with a custom column mapping (out-of-order / renamed headers)', () => {
    const customHeader = ['Company', 'Amount'];
    const mapping = { company_name: 0, ticket_eur: 1 } as const;
    const [result] = parsePortfolioRows([customHeader, ['Beta Robotics', '500k']], mapping);
    expect(result.data?.companyName).toBe('Beta Robotics');
    expect(result.data?.ticketEur).toBe(500_000);
  });
});

describe('parsePortfolioFields — the shared single-row parser (Prompt 753 §E)', () => {
  it('is what the row-level editor re-validates against, and produces the exact same result parsePortfolioRows would', () => {
    const direct = parsePortfolioFields({ company_name: 'Acme', ticket_eur: '1.500' });
    expect(direct.data?.ticketEur).toBe(1500);
    expect(direct.warnings.some((w) => w.field === 'ticket_eur')).toBe(true);
  });
});

describe('detectDuplicates — Prompt 746 Phase 1', () => {
  it('flags a row matching an EXISTING company by domain', () => {
    const dups = detectDuplicates(
      [{ row: 1, companyName: 'Acme Health Inc', domain: 'acmehealth.com' }],
      [{ companyName: 'Acme Health', domain: 'acmehealth.com' }],
    );
    expect(dups.get(1)).toEqual({ against: 'existing', reason: 'domain' });
  });

  it('flags a row matching an EXISTING company by normalized name when domains differ (or are absent)', () => {
    const dups = detectDuplicates(
      [{ row: 1, companyName: 'Acme Health Ventures', domain: null }],
      [{ companyName: 'Acme Health Ventures Inc', domain: null }],
    );
    expect(dups.get(1)).toEqual({ against: 'existing', reason: 'name' });
  });

  it('does not flag genuinely different companies', () => {
    const dups = detectDuplicates(
      [{ row: 1, companyName: 'Beta Robotics', domain: 'betarobotics.com' }],
      [{ companyName: 'Acme Health', domain: 'acmehealth.com' }],
    );
    expect(dups.size).toBe(0);
  });

  it('flags the SECOND occurrence of the same company within one import batch, not the first', () => {
    const dups = detectDuplicates(
      [
        { row: 1, companyName: 'Acme Health', domain: 'acmehealth.com' },
        { row: 2, companyName: 'Acme Health', domain: 'acmehealth.com' },
      ],
      [],
    );
    expect(dups.get(1)).toBeUndefined();
    expect(dups.get(2)).toEqual({ against: 'batch', reason: 'domain' });
  });

  it('flags a within-batch duplicate by normalized name even with no website on either row', () => {
    const dups = detectDuplicates(
      [
        { row: 1, companyName: 'Acme Health Ltd', domain: null },
        { row: 2, companyName: 'ACME HEALTH', domain: null },
      ],
      [],
    );
    expect(dups.get(2)?.reason).toBe('name');
  });
});

describe('detectDuplicateForEdit — Prompt 753 §F', () => {
  const existing = [
    { id: 'a', companyName: 'Acme Health', domain: 'acmehealth.com' },
    { id: 'b', companyName: 'Beta Robotics', domain: 'betarobotics.com' },
  ];

  it('warns when the edited row now collides with ANOTHER existing row', () => {
    const dup = detectDuplicateForEdit({ companyName: 'Acme Health', domain: 'acmehealth.com' }, 'b', existing);
    expect(dup).toEqual({ against: 'existing', reason: 'domain' });
  });

  it('never flags a row against ITSELF', () => {
    const dup = detectDuplicateForEdit({ companyName: 'Acme Health', domain: 'acmehealth.com' }, 'a', existing);
    expect(dup).toBeNull();
  });

  it('is null when nothing collides', () => {
    const dup = detectDuplicateForEdit({ companyName: 'Gamma Biotech', domain: 'gammabio.com' }, 'a', existing);
    expect(dup).toBeNull();
  });
});

describe('buildPortfolioImportPlan — Prompt 746 Phase 1 + Prompt 753', () => {
  const HEADER = ['company_name', 'website', 'ticket_eur', 'status'];

  it('marks a clean, non-duplicate row as included by default', () => {
    const plan = buildPortfolioImportPlan([HEADER, ['Acme Health', 'https://acmehealth.com', '350k', 'current']], []);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].include).toBe(true);
  });

  it('excludes a row with a validation error by default', () => {
    const plan = buildPortfolioImportPlan([HEADER, ['', 'https://acmehealth.com', '350k', 'current']], []);
    expect(plan.items[0].include).toBe(false);
    expect(plan.items[0].data).toBeNull();
  });

  it('excludes a row that duplicates an existing company by default', () => {
    const plan = buildPortfolioImportPlan(
      [HEADER, ['Acme Health', 'https://acmehealth.com', '350k', 'current']],
      [{ companyName: 'Acme Health', domain: 'acmehealth.com' }],
    );
    expect(plan.items[0].include).toBe(false);
    expect(plan.items[0].duplicate).toEqual({ against: 'existing', reason: 'domain' });
  });

  it('excludes a row with only a WARNING by default, distinctly from an error (can still be opted in)', () => {
    const plan = buildPortfolioImportPlan([HEADER, ['Acme Health', 'https://acmehealth.com', '1.500', 'current']], []);
    expect(plan.items[0].errors).toEqual([]);
    expect(plan.items[0].warnings.length).toBeGreaterThan(0);
    expect(plan.items[0].include).toBe(false);
    // Unlike an error row, a warning row's own data is still populated —
    // "Import anyway" just flips `include`, it never needs to re-parse.
    expect(plan.items[0].data).not.toBeNull();
  });

  it('never sends an invite — the plan has no notion of one at all (Phase 2 concern only)', () => {
    const plan = buildPortfolioImportPlan([HEADER, ['Acme Health', 'https://acmehealth.com', '350k', 'current']], []);
    expect(JSON.stringify(plan)).not.toMatch(/invite/i);
  });
});

describe('CSV round-trip — Prompt 746 Phase 1', () => {
  it('parses the downloadable template itself with zero errors', () => {
    const csv = portfolioImportTemplateCsv();
    const rows = parsePortfolioCsvRows(csv);
    const parsed = parsePortfolioRows(rows);
    expect(parsed.length).toBeGreaterThan(0);
    for (const p of parsed) expect(p.errors).toEqual([]);
  });

  it('handles a quoted field containing a comma (RFC4180)', () => {
    const csv = 'company_name,sectors\n"Acme, Inc.","fintech|healthtech"';
    const rows = parsePortfolioCsvRows(csv);
    const [result] = parsePortfolioRows(rows);
    expect(result.data?.companyName).toBe('Acme, Inc.');
  });
});

describe('XLSX parsing — Prompt 746 Phase 1 + Prompt 753 §C', () => {
  function buildXlsx(rows: (string | number)[][]): ArrayBuffer {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return out;
  }

  it('reads a real .xlsx workbook into the same row shape CSV produces', () => {
    const buf = buildXlsx([
      ['company_name', 'website', 'ticket_eur', 'status'],
      ['Acme Health', 'https://acmehealth.com', '350000', 'current'],
    ]);
    const rows = parsePortfolioXlsxRows(buf);
    expect(rows[0]).toEqual(['company_name', 'website', 'ticket_eur', 'status']);
    expect(rows[1][0]).toBe('Acme Health');
  });

  it('parses ticket amounts from an xlsx NUMBER cell (not a string with a suffix)', () => {
    const buf = buildXlsx([
      ['company_name', 'ticket_eur'],
      ['Acme Health', 350000],
    ]);
    const rows = parsePortfolioXlsxRows(buf);
    const [result] = parsePortfolioRows(rows);
    expect(result.data?.ticketEur).toBe(350000);
  });

  it('parses a PT-formatted date typed into an xlsx text cell', () => {
    const buf = buildXlsx([
      ['company_name', 'invested_at'],
      ['Acme Health', '15/03/2022'],
    ]);
    const rows = parsePortfolioXlsxRows(buf);
    const [result] = parsePortfolioRows(rows);
    expect(result.data?.investedAt).toBe('2022-03-15');
  });

  it('reads a genuine Excel DATE cell (not text) as the correct calendar date, not shifted by a day or read month-first', () => {
    // Prompt AL756 — the cell is built from a plain INTEGER serial written
    // directly, never a JS Date object through aoa_to_sheet. That path is
    // itself time-zone dependent (confirmed: under TZ=Asia/Tokyo or
    // TZ=Europe/Paris, aoa_to_sheet([...], [new Date(Date.UTC(2022,2,15))])
    // produces the serial 44634.99947916667 — one day minus 45 seconds —
    // not the clean 44635 a real Excel file has) and would have made this
    // very test flaky by the exact mechanism this prompt fixes. 44635 =
    // 15 March 2022, days since the Excel epoch (1899-12-30), computed by
    // hand against that epoch, not derived from a Date.
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['company_name', 'invested_at'],
      ['Acme Health', 44635],
    ]);
    sheet.B2.z = 'dd/mm/yyyy';
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const rows = parsePortfolioXlsxRows(buf);
    expect(rows[1][1]).toBe('2022-03-15');
    const [result] = parsePortfolioRows(rows);
    expect(result.data?.investedAt).toBe('2022-03-15');
  });

  // Prompt AL756 — the regression guard for the bug itself: Prompt 753's
  // `cellDates: true` built the cell's Date object in the LOCAL time zone
  // of whoever ran the parser (the investor's own browser, in production),
  // not an immovable UTC anchor as that code's own comment claimed.
  // Reproduced directly before fixing (not assumed from the bug report):
  // TZ=UTC read 44635 back as 2022-03-14. xlsxCellToString now does the
  // serial->calendar-date conversion by pure day-count arithmetic
  // (Date.UTC + a fixed day offset, never a locally-resolved Date) — this
  // matrix is what actually proves that: the SAME four values come back
  // identically whichever TZ the test process is stubbed to, including
  // the UTC value that used to be wrong.
  describe('time-zone independence (Prompt AL756)', () => {
    const TIMEZONES = ['UTC', 'Europe/Paris', 'Asia/Tokyo', 'America/Los_Angeles'];

    afterEach(() => { vi.unstubAllEnvs(); });

    it.each(TIMEZONES)('TZ=%s: serial 44635 reads as 2022-03-15, serial 44743 as 2022-07-01', (tz) => {
      vi.stubEnv('TZ', tz);
      const wb = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([
        ['invested_at', 'exit_at', 'ticket_eur', 'year_not_a_date'],
        [44635, 44743, 350000, 2019],
      ]);
      sheet.A2.z = 'dd/mm/yyyy';
      sheet.B2.z = 'dd/mm/yyyy';
      sheet.C2.z = '€ #,##0.00';
      // D2 deliberately has NO date format — proves the date/not-date
      // decision comes from the cell's own number format, never from the
      // numeric value happening to look year-shaped.
      XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      const rows = parsePortfolioXlsxRows(buf);
      expect(rows[1][0]).toBe('2022-03-15');
      expect(rows[1][1]).toBe('2022-07-01');
      expect(rows[1][2]).toBe('350000');
      expect(rows[1][3]).toBe('2019');
    });
  });

  it('returns an empty array for a sheet with no rows at all', () => {
    // A workbook with literally zero sheets isn't a writable .xlsx file
    // (SheetJS itself refuses it) and so can never actually reach an
    // investor's upload — an empty SHEET is the realistic edge case: a
    // template downloaded and re-uploaded with nothing filled in.
    const buf = buildXlsx([]);
    expect(parsePortfolioXlsxRows(buf)).toEqual([]);
  });
});

// Prompt 753's own explicit requirement: "Um CSV com ; e vírgula decimal,
// uma folha XLSX com datas em série e dinheiro formatado, e um ficheiro com
// BOM. Os três ficheiros ficam em src/lib/__fixtures__/ e entram nos testes
// de ponta a ponta do plano de import."
describe('end-to-end fixtures — Prompt 753', () => {
  it('portfolio-import-pt.csv (semicolon delimiter, PT decimals, PT status/stage/dates) imports with no errors', () => {
    const text = readFileSync(join(FIXTURES, 'portfolio-import-pt.csv'), 'utf8');
    const rows = parsePortfolioCsvRows(text);
    expect(rows[0]).toContain('company_name');
    const plan = buildPortfolioImportPlan(rows, []);
    for (const item of plan.items) expect(item.errors).toEqual([]);
    expect(plan.items).toHaveLength(2);

    const first = plan.items[0];
    expect(first.data?.companyName).toBe('Acme Saude');
    expect(first.data?.status).toBe('past');
    expect(first.data?.stageAtEntry).toBe('series_a');
    expect(first.data?.ticketEur).toBe(350_000);
    expect(first.data?.instrument).toBe('convertible_note');
    expect(first.data?.investedAt).toBe('2022-03-15');
    expect(first.data?.exitType).toBe('acquisition');

    const second = plan.items[1];
    expect(second.data?.companyName).toBe('Beta Robotics');
    expect(second.data?.status).toBe('current');
    expect(second.data?.ticketEur).toBe(1_500_000);
  });

  it('portfolio-import.xlsx (serial date formatted as dd/mm/yyyy, currency-formatted money cell) imports with no errors', () => {
    const buf = readFileSync(join(FIXTURES, 'portfolio-import.xlsx'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const rows = parsePortfolioXlsxRows(ab);
    const plan = buildPortfolioImportPlan(rows, []);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].errors).toEqual([]);
    expect(plan.items[0].data?.investedAt).toBe('2022-03-15');
    expect(plan.items[0].data?.ticketEur).toBe(350000);
  });

  it('portfolio-import-bom.csv (UTF-8 BOM) does not leak the BOM into the first header name', () => {
    const text = readFileSync(join(FIXTURES, 'portfolio-import-bom.csv'), 'utf8');
    const rows = parsePortfolioCsvRows(text);
    expect(rows[0][0]).toBe('company_name');
    const plan = buildPortfolioImportPlan(rows, []);
    expect(plan.items[0].errors).toEqual([]);
    expect(plan.items[0].data?.companyName).toBe('Acme Health');
  });
});

describe('lone \\r line endings — Prompt 753 §C', () => {
  it('splits rows on a bare \\r, not just \\r\\n or \\n', () => {
    const csv = 'company_name,ticket_eur\rAcme Health,350000\rBeta Robotics,500000';
    const rows = parsePortfolioCsvRows(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe('Acme Health');
    expect(rows[2][0]).toBe('Beta Robotics');
  });
});

describe('validateManualPortfolioInput — Prompt 746 Phase 1 + Prompt AL756', () => {
  it('accepts a minimal valid row, status omitted defaults to current', () => {
    const result = validateManualPortfolioInput({ companyName: 'Acme Health' });
    expect('row' in result).toBe(true);
    if ('row' in result) expect(result.row.status).toBe('current');
  });

  it('accepts an explicit "past" status', () => {
    const result = validateManualPortfolioInput({ companyName: 'Acme Health', status: 'past' });
    expect('row' in result && result.row.status).toBe('past');
  });

  // Prompt AL756 — the bug itself: `body.status === 'past' ? 'past' :
  // 'current'` silently turned any garbage value into 'current'. Harmless
  // from the UI's own <select> (never sends anything else), but a real gap
  // for PATCH, callable directly. A present, unrecognized status is now a
  // 400, same "never silently substitute" rule as every parser in this file.
  it('rejects a present but unrecognized status instead of silently defaulting to current', () => {
    const result = validateManualPortfolioInput({ companyName: 'Acme Health', status: 'archived' });
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('archived');
  });

  it('rejects a missing company name', () => {
    const result = validateManualPortfolioInput({});
    expect('error' in result).toBe(true);
  });

  it('rejects an ambiguous ticket amount outright — no soft "warning" landing on this path', () => {
    const result = validateManualPortfolioInput({ companyName: 'Acme Health', ticketEur: '1.500' });
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('ambiguous');
  });
});
