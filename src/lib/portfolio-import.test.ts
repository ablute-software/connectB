import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  autoMapColumns, bucketImportItems, buildPortfolioImportPlan, detectDuplicateForEdit, detectDuplicates,
  detectHeaderAndMapping, formatDateDisplay, formatTicketDisplay, parsePortfolioCsvRows, parsePortfolioDate,
  parsePortfolioExitType, parsePortfolioFields, parsePortfolioInstrument, parsePortfolioRows, parsePortfolioSectors,
  parsePortfolioStage, parsePortfolioStatus, parsePortfolioXlsxRows, parseTicketAmount, pickImportTargetStatus,
  portfolioImportTemplateCsv, portfolioTemplateFields, portfolioTemplateFilename, acceptedValuesHelp,
  detectCsvDelimiter, stripEmptyRowsAndColumns, suggestSector, validateManualPortfolioInput,
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

  // Prompt AL757 §E — Nuno's own review of 753 found warning-only rows
  // starting UNCHECKED, forcing a click on "Import anyway" for every one
  // even though a warning (by definition) never blocks the import. Only an
  // error, or an un-opted duplicate, excludes a row by default now.
  it('includes a row with only a WARNING by default, distinctly from an error', () => {
    const plan = buildPortfolioImportPlan([HEADER, ['Acme Health', 'https://acmehealth.com', '1.500', 'current']], []);
    expect(plan.items[0].errors).toEqual([]);
    expect(plan.items[0].warnings.length).toBeGreaterThan(0);
    expect(plan.items[0].include).toBe(true);
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

  it('accepts a contact phone and trims it; absent stays null', () => {
    const withPhone = validateManualPortfolioInput({ companyName: 'Acme Health', contactPhone: '  +351 912345678  ' });
    expect('row' in withPhone && withPhone.row.contact_phone).toBe('+351 912345678');
    const withoutPhone = validateManualPortfolioInput({ companyName: 'Acme Health' });
    expect('row' in withoutPhone && withoutPhone.row.contact_phone).toBeNull();
  });
});

describe('stripEmptyRowsAndColumns — Prompt AL757 §A', () => {
  it('drops a fully blank row anywhere (top, middle) and renumbers nothing else', () => {
    const grid = [
      ['', '', ''],
      ['company_name', 'ticket_eur', 'country'],
      ['', '', ''],
      ['Acme', '100', 'Portugal'],
    ];
    const { rows, originalRowNumbers } = stripEmptyRowsAndColumns(grid);
    expect(rows).toEqual([
      ['company_name', 'ticket_eur', 'country'],
      ['Acme', '100', 'Portugal'],
    ]);
    // 1-based original file line numbers — row 1 (blank) and row 3 (blank)
    // are gone; the header is file line 2, the data row is file line 4.
    expect(originalRowNumbers).toEqual([2, 4]);
  });

  it('drops a fully blank column anywhere (left, middle, right)', () => {
    const grid = [
      ['', 'company_name', '', 'ticket_eur', ''],
      ['', 'Acme', '', '100', ''],
    ];
    const { rows } = stripEmptyRowsAndColumns(grid);
    expect(rows).toEqual([
      ['company_name', 'ticket_eur'],
      ['Acme', '100'],
    ]);
  });

  it('leaves a grid with no blank rows/columns untouched, row numbers 1..n', () => {
    const grid = [['company_name'], ['Acme'], ['Beta']];
    const { rows, originalRowNumbers } = stripEmptyRowsAndColumns(grid);
    expect(rows).toEqual(grid);
    expect(originalRowNumbers).toEqual([1, 2, 3]);
  });

  it('returns an empty grid for an all-blank file', () => {
    expect(stripEmptyRowsAndColumns([['', ''], ['', '']])).toEqual({ rows: [], originalRowNumbers: [] });
  });
});

describe('detectHeaderAndMapping — Prompt AL757 §A/§B', () => {
  it('finds the header on row 0 when it matches >= 2 aliases', () => {
    const detection = detectHeaderAndMapping([['company_name', 'ticket_eur'], ['Acme', '100']]);
    expect(detection.headerRowIndex).toBe(0);
    expect(detection.mapping.company_name).toBe(0);
    expect(detection.mapping.ticket_eur).toBe(1);
  });

  // "O cabeçalho é a primeira das primeiras 10 linhas não vazias com pelo
  // menos 2 células que batem num alias" — four junk/title lines above the
  // real header, each non-blank (so blank-row stripping alone can't skip
  // them) but matching at most 1 alias each.
  it('skips up to 4 junk/title lines above the real header, on line 5', () => {
    const grid = [
      ['Portfolio export'],
      ['Generated 2026-10-01'],
      [''],
      ['Confidential'],
      ['company_name', 'ticket_eur', 'country'],
      ['Acme', '100', 'Portugal'],
    ];
    const { rows } = stripEmptyRowsAndColumns(grid);
    const detection = detectHeaderAndMapping(rows);
    expect(rows[detection.headerRowIndex]).toEqual(['company_name', 'ticket_eur', 'country']);
    expect(detection.mapping.company_name).toBe(0);
  });

  // "Se nenhuma bater, usa a primeira linha não vazia e passa à detecção
  // por conteúdo... tudo marcado guessed" — a file that is pure data, no
  // header row recognizable at all. The first row is still treated as a
  // header (a known, accepted trade-off stated in this function's own
  // header comment) and every content-guessable field in the remaining
  // rows is resolved by VALUE, not by any column name.
  it('falls back to content-detection when no row matches >= 2 header aliases', () => {
    const grid = [
      ['jane@acmehealth.com', 'https://acmehealth.com', '350.000', '15/03/2022'],
      ['john@oldrobotics.example', 'https://oldrobotics.example', '120.000', '01/06/2019'],
    ];
    const detection = detectHeaderAndMapping(grid);
    expect(detection.headerRowIndex).toBe(0);
    expect(detection.mapping.contact_email).toBe(0);
    expect(detection.mapping.website).toBe(1);
    expect(detection.mapping.ticket_eur).toBe(2);
    expect(detection.mapping.invested_at).toBe(3);
    expect(detection.guessedFields.sort()).toEqual(['contact_email', 'invested_at', 'ticket_eur', 'website']);
  });

  it('never guesses company_name by content — no pattern exists for it', () => {
    // Every column here is content-guessable as something ELSE (or
    // nothing); the "company name" column (plain text, no recognizable
    // shape) stays unmapped rather than being guessed.
    const grid = [
      ['Acme Health', 'jane@acmehealth.com'],
      ['Old Robotics', 'john@oldrobotics.example'],
    ];
    const detection = detectHeaderAndMapping(grid);
    expect(detection.mapping.company_name).toBeUndefined();
    expect(detection.mapping.contact_email).toBe(1);
    expect(detection.unmappedColumns.map((c) => c.index)).toEqual([0]);
  });

  it('a money-shaped column needs a currency symbol, k/M suffix, or thousands grouping — a bare small number is never guessed as ticket_eur', () => {
    const grid = [['5'], ['12'], ['7']];
    const detection = detectHeaderAndMapping(grid);
    expect(detection.mapping.ticket_eur).toBeUndefined();
  });

  it('lists unmapped header columns with their own header text, for "Not imported"', () => {
    const detection = detectHeaderAndMapping([
      ['company_name', 'ticket_eur', 'Notes'],
      ['Acme', '100', 'met at a conference'],
    ]);
    expect(detection.unmappedColumns).toEqual([{ index: 2, header: 'Notes' }]);
  });
});

// Prompt AL757 — the three files Nuno actually tried in production, each
// reproduced here as a real fixture (not inlined) so a future regression
// shows up exactly where it would in his own workflow. All three must
// resolve the SAME five core fields, per the prompt's own requirement.
describe('Nuno\'s three real files — Prompt AL757', () => {
  function loadCsv(name: string): string[][] {
    return parsePortfolioCsvRows(readFileSync(join(FIXTURES, name), 'utf8'));
  }

  function assertCoreFieldsMapped(mapping: ReturnType<typeof detectHeaderAndMapping>['mapping']) {
    expect(mapping.company_name).toBeDefined();
    expect(mapping.ticket_eur).toBeDefined();
    expect(mapping.sectors).toBeDefined();
    expect(mapping.country).toBeDefined();
    expect(mapping.invested_at).toBeDefined();
    expect(mapping.contact_email).toBeDefined();
    expect(mapping.contact_phone).toBeDefined();
  }

  it('file 1 — plain EN header on row 1 — maps every field including Mail and Tel.', () => {
    const rows = loadCsv('al757-file1-en-header.csv');
    const { rows: stripped } = stripEmptyRowsAndColumns(rows);
    const detection = detectHeaderAndMapping(stripped);
    assertCoreFieldsMapped(detection.mapping);
    expect(detection.unmappedColumns).toEqual([]);
  });

  it('file 2 — same header, blank row on top and blank column on the left', () => {
    const rows = loadCsv('al757-file2-blank-row-col.csv');
    const { rows: stripped } = stripEmptyRowsAndColumns(rows);
    const detection = detectHeaderAndMapping(stripped);
    assertCoreFieldsMapped(detection.mapping);
    expect(detection.unmappedColumns).toEqual([]);
  });

  it('file 3 — Portuguese header, same blank row/column shape as file 2', () => {
    const rows = loadCsv('al757-file3-pt-header-blank-row-col.csv');
    const { rows: stripped } = stripEmptyRowsAndColumns(rows);
    const detection = detectHeaderAndMapping(stripped);
    assertCoreFieldsMapped(detection.mapping);
    expect(detection.unmappedColumns).toEqual([]);
  });

  it('all three files import Test1/Test2 with zero errors, at the row numbers a human would see in their own spreadsheet', () => {
    for (const [name, test1Row, test2Row] of [
      ['al757-file1-en-header.csv', 2, 3],
      ['al757-file2-blank-row-col.csv', 3, 4],
      ['al757-file3-pt-header-blank-row-col.csv', 3, 4],
    ] as const) {
      const rows = loadCsv(name);
      const parsed = parsePortfolioRows(rows);
      expect(parsed.map((p) => p.row)).toEqual([test1Row, test2Row]);
      for (const p of parsed) expect(p.errors).toEqual([]);
      expect(parsed[0].data?.companyName).toBe('Test1');
      expect(parsed[0].data?.ticketEur).toBe(100000);
      expect(parsed[0].data?.contactPhone).toBe('+351 912345678');
      expect(parsed[1].data?.companyName).toBe('Test2');
    }
  });

  it('the XLSX variant with the table starting away from A1 resolves the same core fields', () => {
    const buf = readFileSync(join(FIXTURES, 'al757-table-starts-at-c3.xlsx'));
    const rows = parsePortfolioXlsxRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const { rows: stripped } = stripEmptyRowsAndColumns(rows);
    const detection = detectHeaderAndMapping(stripped);
    expect(detection.mapping.company_name).toBeDefined();
    expect(detection.mapping.ticket_eur).toBeDefined();
    expect(detection.mapping.sectors).toBeDefined();
    expect(detection.mapping.country).toBeDefined();
    expect(detection.mapping.invested_at).toBeDefined();
    const parsed = parsePortfolioRows(rows);
    expect(parsed).toHaveLength(2);
    for (const p of parsed) expect(p.errors).toEqual([]);
    expect(parsed[0].data?.companyName).toBe('Test1');
  });
});

describe('new PT/EN header aliases — Prompt AL757 §B', () => {
  // Each alias tried with mixed case, accents, and stray punctuation, to
  // prove normalizeHeader's own accent/punctuation stripping (not just an
  // exact-string table entry) is what makes the match, same spirit as
  // normalizeToken elsewhere in this file.
  const CASES: { field: string; headers: string[] }[] = [
    { field: 'company_name', headers: ['Nome', 'NOME', 'Empresa', 'Nome da Empresa', 'Participada'] },
    { field: 'country', headers: ['País', 'PAÍS', 'Pais', 'Localização', 'localizacao', 'Geografia'] },
    { field: 'sectors', headers: ['Setor', 'Área', 'área', 'Indústria', 'Mercado'] },
    { field: 'ticket_eur', headers: ['Valor', 'Valor Investimento', 'Montante', 'Cheque'] },
    { field: 'invested_at', headers: ['Quando', 'Data', 'Data de Investimento', 'Ano'] },
    { field: 'stage_at_entry', headers: ['Fase', 'Ronda', 'Estágio', 'estagio'] },
    { field: 'instrument', headers: ['Instrumento', 'Tipo de Investimento'] },
    { field: 'status', headers: ['Estado', 'Situação', 'situacao'] },
    { field: 'exit_at', headers: ['Data de Saída', 'data saida'] },
    { field: 'exit_type', headers: ['Tipo de Saída'] },
    { field: 'contact_name', headers: ['Contacto', 'Nome do Contacto', 'Fundador'] },
    { field: 'contact_email', headers: ['Mail', 'MAIL', 'E-mail', 'Correio Eletrónico'] },
    { field: 'website', headers: ['Site', 'Página', 'pagina', 'Web'] },
    { field: 'contact_phone', headers: ['Tel.', 'tel', 'Telefone', 'Phone Number', 'Telemóvel'] },
  ];

  for (const { field, headers } of CASES) {
    for (const header of headers) {
      it(`"${header}" maps to ${field}`, () => {
        const mapping = autoMapColumns([header]);
        expect(mapping[field as keyof typeof mapping]).toBe(0);
      });
    }
  }
});

describe('content-based column detection — Prompt AL757 §B', () => {
  it('guesses contact_email, website, ticket_eur, invested_at and country from values, each marked "guessed"', () => {
    const grid = [
      ['x1', 'x2', 'x3', 'x4', 'x5'],
      ['jane@acmehealth.com', 'https://acmehealth.com', '€350.000', '15/03/2022', 'Portugal'],
      ['john@oldrobotics.example', 'https://oldrobotics.example', '1,5M', '2019', 'Spain'],
    ];
    const detection = detectHeaderAndMapping(grid);
    expect(detection.mapping).toEqual({ contact_email: 0, website: 1, ticket_eur: 2, invested_at: 3, country: 4 });
    expect(detection.guessedFields.sort()).toEqual(['contact_email', 'country', 'invested_at', 'ticket_eur', 'website']);
  });

  it('requires 80% of a column\'s values to match before guessing it', () => {
    const grid = [
      ['x1'],
      ['jane@acmehealth.com'],
      ['not an email'],
      ['also not an email'],
    ];
    const detection = detectHeaderAndMapping(grid);
    expect(detection.mapping.contact_email).toBeUndefined();
  });
});

describe('past without an exit date — Prompt AL757 §D', () => {
  it('a past company with no exit_at is valid, but now carries a warning', () => {
    const { data, errors, warnings } = parsePortfolioFields({ company_name: 'Old Robotics', status: 'past' });
    expect(errors).toEqual([]);
    expect(data?.status).toBe('past');
    expect(data?.exitAt).toBeUndefined();
    expect(warnings.some((w) => w.field === 'exit_at' && /no exit date/i.test(w.message))).toBe(true);
  });

  it('a current company with no exit_at carries no such warning (the field does not apply)', () => {
    const { warnings } = parsePortfolioFields({ company_name: 'Acme Health', status: 'current' });
    expect(warnings.some((w) => w.field === 'exit_at')).toBe(false);
  });
});

describe('default status for a file with no status column — Prompt AL757 §D', () => {
  const NO_STATUS_HEADER = ['company_name', 'ticket_eur'];

  it('falls back to the caller-supplied default (the active tab), not always current', () => {
    const rows = [NO_STATUS_HEADER, ['Acme', '100'], ['Beta', '200']];
    const asPast = parsePortfolioRows(rows, undefined, { defaultStatus: 'past' });
    expect(asPast.map((r) => r.data?.status)).toEqual(['past', 'past']);
    const asCurrent = parsePortfolioRows(rows, undefined, { defaultStatus: 'current' });
    expect(asCurrent.map((r) => r.data?.status)).toEqual(['current', 'current']);
  });

  it('omitting the option keeps the old default (current)', () => {
    const rows = [NO_STATUS_HEADER, ['Acme', '100']];
    expect(parsePortfolioRows(rows)[0].data?.status).toBe('current');
  });

  it('a file that DOES map a status column ignores the default for a non-blank cell, and still defaults a blank cell to current (unchanged behavior)', () => {
    const header = ['company_name', 'status'];
    const rows = [header, ['Acme', 'past'], ['Beta', '']];
    const parsed = parsePortfolioRows(rows, undefined, { defaultStatus: 'past' });
    expect(parsed[0].data?.status).toBe('past');
    // Beta's blank cell: parsePortfolioStatus's own rule (blank -> current)
    // still applies — the "active tab" default is only for a MISSING
    // column entirely, never a per-cell override of an existing one.
    expect(parsed[1].data?.status).toBe('current');
  });

  it('buildPortfolioImportPlan threads the same default through to its items', () => {
    const plan = buildPortfolioImportPlan([NO_STATUS_HEADER, ['Acme', '100']], [], undefined, { defaultStatus: 'past' });
    expect(plan.items[0].data?.status).toBe('past');
  });
});

describe('sector suggestion — Prompt AL757 §F', () => {
  it('an unmatched token close to a known short alias gets a suggestion, not a silent match', () => {
    expect(suggestSector('MedTec')).toBe('MedTech & Medical Devices');
    const parsed = parsePortfolioSectors('MedTec');
    expect(parsed.unmatched).toEqual(['MedTec']);
  });

  it('the warning carries the suggestion for the UI\'s one-click accept', () => {
    const { warnings } = parsePortfolioFields({ company_name: 'Acme', sectors: 'MedTec' });
    const w = warnings.find((x) => x.field === 'sectors');
    expect(w?.suggestion).toEqual({ token: 'MedTec', canonical: 'MedTech & Medical Devices' });
  });

  it('a short industry nickname resolves outright, no suggestion needed', () => {
    expect(parsePortfolioSectors('fintech').sectors).toEqual(['FinTech & InsurTech']);
    expect(parsePortfolioSectors('healthtech').sectors).toEqual(['Digital Health']);
    expect(parsePortfolioSectors('edtech').sectors).toEqual(['EdTech']);
    expect(parsePortfolioSectors('agritech').sectors).toEqual(['AgriTech & FoodTech']);
  });

  it('a confident abbreviation (margin >= 2 chars) resolves by containment, no suggestion', () => {
    expect(parsePortfolioSectors('roboti').sectors).toEqual(['Robotics & Automation']);
  });

  it('nothing close enough returns no suggestion at all', () => {
    expect(suggestSector('completely unrelated gibberish xyz')).toBeUndefined();
  });
});

describe('bucketImportItems — Prompt AL757 §C', () => {
  const baseRow = { data: { companyName: 'Acme', domain: null, sectors: [], status: 'current' as const }, errors: [], duplicate: null };

  it('an invalid row (null data) is skipped with its own reason', () => {
    const { candidates, skipped } = bucketImportItems([
      { row: 1, data: null, errors: [{ field: 'company_name', message: 'Company name is required.', severity: 'error' }], include: false, duplicate: null },
    ]);
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([{ row: 1, reason: 'Company name is required.' }]);
  });

  it('a row with an error is NEVER a candidate even when include is true', () => {
    const { candidates, skipped } = bucketImportItems([
      { ...baseRow, row: 1, errors: [{ field: 'ticket_eur', message: 'Could not parse ticket amount "abc".', severity: 'error' }], include: true },
    ]);
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([{ row: 1, reason: 'Could not parse ticket amount "abc".' }]);
  });

  it('a clean row left unchecked by the investor is skipped as "not selected"', () => {
    const { candidates, skipped } = bucketImportItems([{ ...baseRow, row: 1, include: false }]);
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([{ row: 1, reason: 'not selected' }]);
  });

  it('a clean, checked row becomes a candidate', () => {
    const { candidates, skipped } = bucketImportItems([{ ...baseRow, row: 1, include: true }]);
    expect(candidates).toEqual([{ row: 1, data: baseRow.data }]);
    expect(skipped).toEqual([]);
  });

  it('an un-opted duplicate is skipped with the duplicate reason, from the client\'s own flag', () => {
    const { candidates, skipped } = bucketImportItems([
      { ...baseRow, row: 1, include: false, duplicate: { against: 'existing' as const, reason: 'domain' as const } },
    ]);
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([{ row: 1, reason: 'duplicate (same website as a company already in your portfolio)' }]);
  });
});

// Prompt AL757 §C — "prova que, depois do import, a faixa de resultado
// existe e o separador ativo corresponde ao das linhas importadas." No
// React component-testing library exists in this repo (every other UI
// verification in this codebase is done live, in-browser — see CLAUDE.md);
// this is the equivalent INTEGRATION test the prompt itself offers as the
// alternative ("ou de integração"): it drives the exact same three pure
// functions PortfolioPanel/ImportFlow call in sequence (buildPortfolioImportPlan
// -> bucketImportItems, mirroring the commit route -> pickImportTargetStatus,
// exactly what commit() uses to tell the parent panel which tab to switch
// to), end to end, over a real file. A live-browser click-through of this
// same path is also done separately as part of this prompt's own
// production verification.
describe('import -> commit -> result banner -> tab switch, end to end — Prompt AL757 §C', () => {
  it('a file with no status column, imported while the investor sits on Past, creates rows AND switches to Past', () => {
    const rows = [
      ['company_name', 'ticket_eur'],
      ['Acme Health', '100000'],
      ['Beta Robotics', '45000'],
    ];
    const plan = buildPortfolioImportPlan(rows, [], undefined, { defaultStatus: 'past' });
    expect(plan.items.every((it) => it.include)).toBe(true);

    // What the commit route does with the plan the client sends it.
    const { candidates, skipped } = bucketImportItems(plan.items);
    expect(candidates).toHaveLength(2);
    expect(skipped).toEqual([]);
    const created = candidates.length;

    // What the result banner shows, and what tab it switches to — exactly
    // ImportFlow's own commit() logic.
    expect(created).toBeGreaterThan(0);
    const targetStatus = pickImportTargetStatus(plan.items);
    expect(targetStatus).toBe('past');
  });

  it('a file with a mixed status column switches to whichever status most of the imported rows actually landed on', () => {
    const rows = [
      ['company_name', 'ticket_eur', 'status'],
      ['Acme Health', '100000', 'past'],
      ['Beta Robotics', '45000', 'past'],
      ['Gamma Analytics', '20000', 'current'],
    ];
    const plan = buildPortfolioImportPlan(rows, []);
    const { candidates } = bucketImportItems(plan.items);
    expect(candidates).toHaveLength(3);
    expect(pickImportTargetStatus(plan.items)).toBe('past');
  });

  it('a file where everything is skipped (all duplicates) creates nothing and the banner has a reason for each row', () => {
    const rows = [
      ['company_name', 'ticket_eur'],
      ['Acme Health', '100000'],
    ];
    const plan = buildPortfolioImportPlan(rows, [{ companyName: 'Acme Health', domain: null }]);
    expect(plan.items[0].include).toBe(false);
    const { candidates, skipped } = bucketImportItems(plan.items);
    expect(candidates).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/duplicate/);
  });
});

describe('pickImportTargetStatus — Prompt AL757 §C/§D', () => {
  function item(status: 'current' | 'past', include = true) {
    return { include, data: { companyName: 'x', domain: null, sectors: [], status } };
  }

  it('picks the status most of the included rows resolved to', () => {
    expect(pickImportTargetStatus([item('past'), item('past'), item('current')])).toBe('past');
  });

  it('a tie, or nothing included, favors current', () => {
    expect(pickImportTargetStatus([item('past'), item('current')])).toBe('current');
    expect(pickImportTargetStatus([])).toBe('current');
  });

  it('ignores a row that is not included or has no data', () => {
    expect(pickImportTargetStatus([item('past', false), item('current')])).toBe('current');
  });
});

// Prompt AL758 §C — one template per tab.
describe('per-tab templates — Prompt AL758 §C', () => {
  const csvRows = (tab: 'current' | 'past') => parsePortfolioCsvRows(portfolioImportTemplateCsv(tab));

  it('are named portfolio-current-template.csv and portfolio-past-template.csv', () => {
    expect(portfolioTemplateFilename('current')).toBe('portfolio-current-template.csv');
    expect(portfolioTemplateFilename('past')).toBe('portfolio-past-template.csv');
  });

  it('Current: the exact columns, no status, no exit columns, two example rows', () => {
    const rows = csvRows('current');
    expect(rows[0]).toEqual([
      'company_name', 'website', 'country', 'stage_at_entry', 'sectors', 'ticket_eur', 'instrument', 'invested_at',
      'contact_name', 'contact_email', 'contact_phone',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).not.toContain('status');
    expect(rows[0]).not.toContain('exit_at');
    expect(rows[0]).not.toContain('exit_type');
  });

  it('Past: the exact columns, exit_at and exit_type present, no status; examples carry an instrument and an exit type', () => {
    const rows = csvRows('past');
    expect(rows[0]).toEqual([
      'company_name', 'website', 'country', 'stage_at_entry', 'sectors', 'ticket_eur', 'instrument', 'invested_at',
      'exit_at', 'exit_type', 'contact_name', 'contact_email', 'contact_phone',
    ]);
    expect(rows[0]).not.toContain('status');
    expect(rows).toHaveLength(3);
    const idx = (h: string) => rows[0].indexOf(h);
    expect(rows[1][idx('instrument')]).toBe('convertible_note');
    expect(rows[1][idx('exit_type')]).toBe('acquisition');
    expect(rows[1][idx('exit_at')]).not.toBe('');
  });

  for (const tab of ['current', 'past'] as const) {
    it(`${tab}: auto-maps every column with no intervention, nothing left unmapped`, () => {
      const { rows } = stripEmptyRowsAndColumns(csvRows(tab));
      const det = detectHeaderAndMapping(rows);
      expect(det.guessedFields).toEqual([]);
      expect(det.unmappedColumns).toEqual([]);
      const mapped = Object.entries(det.mapping).sort((a, b) => (a[1] as number) - (b[1] as number)).map(([k]) => k);
      expect(mapped).toEqual(portfolioTemplateFields(tab));
    });

    it(`${tab}: imports from its own tab with no errors and no warnings at all`, () => {
      const plan = buildPortfolioImportPlan(csvRows(tab), [], undefined, { defaultStatus: tab });
      expect(plan.items).toHaveLength(2);
      for (const it of plan.items) {
        expect(it.errors).toEqual([]);
        expect(it.warnings).toEqual([]);
        expect(it.include).toBe(true);
        expect(it.data?.status).toBe(tab);
      }
    });
  }

  it('the Past template carries its instrument, exit date and exit type through to the parsed rows', () => {
    const plan = buildPortfolioImportPlan(csvRows('past'), [], undefined, { defaultStatus: 'past' });
    const [first, second] = plan.items.map((i) => i.data);
    expect(first?.instrument).toBe('convertible_note');
    expect(first?.exitType).toBe('acquisition');
    expect(first?.exitAt).toBe('2023-09-01');
    expect(second?.instrument).toBe('equity');
    expect(second?.exitType).toBe('ipo');
    expect(second?.exitAt).toBe('2022-11-30');
  });

  it('accepted-values help lists instrument for both tabs and exit type only for Past, from the validator sets', () => {
    const current = acceptedValuesHelp('current');
    expect(current.map((h) => h.label)).toEqual(['Stage at entry', 'Instrument']);
    expect(current[1].values).toBe('equity | safe | convertible_note | other');
    const past = acceptedValuesHelp('past');
    expect(past.map((h) => h.label)).toEqual(['Stage at entry', 'Instrument', 'Exit type']);
    expect(past[2].values).toBe('acquisition | ipo | write_off | other');
  });
});

describe('exit columns depend on the tab you import from — Prompt AL758 §C', () => {
  const rows = [
    ['company_name', 'exit_at', 'exit_type'],
    ['Old Robotics', '2023-09-01', 'acquisition'],
    ['Acme Health', '', ''],
  ];

  it('from Current, a row WITH an exit date/type is an error (per row), not silently ignored', () => {
    const plan = buildPortfolioImportPlan(rows, [], undefined, { defaultStatus: 'current' });
    const [withExit, withoutExit] = plan.items;
    expect(withExit.errors.map((e) => e.field)).toEqual(['exit_at', 'exit_type']);
    expect(withExit.errors[0].message).toMatch(/import it from the Past tab/);
    expect(withExit.include).toBe(false);
    // A row with blank exit cells is fine — only a VALUE is refused.
    expect(withoutExit.errors).toEqual([]);
    expect(withoutExit.include).toBe(true);
  });

  it('from Past, the same file is accepted, and a past row with no exit date carries a warning', () => {
    const plan = buildPortfolioImportPlan(rows, [], undefined, { defaultStatus: 'past' });
    const [withExit, withoutExit] = plan.items;
    expect(withExit.errors).toEqual([]);
    expect(withExit.data?.status).toBe('past');
    expect(withExit.data?.exitAt).toBe('2023-09-01');
    expect(withoutExit.errors).toEqual([]);
    expect(withoutExit.warnings.some((w) => w.field === 'exit_at')).toBe(true);
  });

  it('the commit bucket never lets a Current-tab exit row in, even with include true', () => {
    const plan = buildPortfolioImportPlan(rows, [], undefined, { defaultStatus: 'current' });
    const forced = plan.items.map((it) => ({ ...it, include: true }));
    const { candidates, skipped } = bucketImportItems(forced);
    expect(candidates.map((c) => c.row)).toEqual([3]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/Past tab/);
  });
});
