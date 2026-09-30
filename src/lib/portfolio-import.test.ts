import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  autoMapColumns, buildPortfolioImportPlan, detectDuplicates, parsePortfolioCsvRows, parsePortfolioDate,
  parsePortfolioRows, parsePortfolioXlsxRows, parseTicketAmount, portfolioImportTemplateCsv,
} from './portfolio-import';

describe('parsePortfolioDate — Prompt 746 Phase 1', () => {
  it('accepts ISO yyyy-mm-dd as-is', () => {
    expect(parsePortfolioDate('2022-03-15')).toBe('2022-03-15');
  });

  it('reads DD/MM/YYYY as the Portuguese convention, never MM/DD', () => {
    // The 3rd of January, not the 1st of March — this is the exact
    // ambiguous case an MM/DD reading would silently get wrong.
    expect(parsePortfolioDate('03/01/2022')).toBe('2022-01-03');
  });

  it('reads DD-MM-YYYY (dash separator) the same way', () => {
    expect(parsePortfolioDate('15-03-2022')).toBe('2022-03-15');
  });

  it('accepts a single-digit day/month', () => {
    expect(parsePortfolioDate('5/6/2022')).toBe('2022-06-05');
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
});

describe('parseTicketAmount — Prompt 746 Phase 1', () => {
  it('parses a bare integer', () => {
    expect(parseTicketAmount('350000')).toBe(350000);
  });

  it('parses with thousands-separator commas', () => {
    expect(parseTicketAmount('350,000')).toBe(350000);
  });

  it('parses a euro-prefixed amount', () => {
    expect(parseTicketAmount('€350000')).toBe(350000);
  });

  it('parses a "k" suffix', () => {
    expect(parseTicketAmount('350k')).toBe(350_000);
    expect(parseTicketAmount('€350k')).toBe(350_000);
  });

  it('parses an "M" suffix, including a decimal', () => {
    expect(parseTicketAmount('1.2M')).toBe(1_200_000);
    expect(parseTicketAmount('€1.2M')).toBe(1_200_000);
  });

  it('parses a bare "M" (whole million)', () => {
    expect(parseTicketAmount('2M')).toBe(2_000_000);
  });

  it('is case-insensitive on the suffix', () => {
    expect(parseTicketAmount('500K')).toBe(500_000);
    expect(parseTicketAmount('1m')).toBe(1_000_000);
  });

  it('tolerates internal spaces (e.g. "€ 350 k" pasted from a spreadsheet)', () => {
    expect(parseTicketAmount('€ 350 k')).toBe(350_000);
  });

  it('returns undefined for unparseable text', () => {
    expect(parseTicketAmount('a lot')).toBeUndefined();
    expect(parseTicketAmount('')).toBeUndefined();
  });
});

describe('autoMapColumns — Prompt 746 Phase 1', () => {
  it('maps our own canonical headers to themselves', () => {
    const headers = ['company_name', 'website', 'country', 'stage_at_entry', 'sectors', 'ticket_eur',
      'instrument', 'invested_at', 'status', 'exit_at', 'exit_type', 'contact_name', 'contact_email'];
    const mapping = autoMapColumns(headers);
    for (let i = 0; i < headers.length; i++) expect(mapping[headers[i] as keyof typeof mapping]).toBe(i);
  });

  it('maps common real-world spreadsheet header spellings', () => {
    const mapping = autoMapColumns(['Company', 'Amount (EUR)', 'Investment Date', 'Founder Email']);
    expect(mapping.company_name).toBe(0);
    expect(mapping.ticket_eur).toBeUndefined(); // "Amount (EUR)" isn't a listed alias verbatim — see next case
    expect(mapping.contact_email).toBe(3);
  });

  it('leaves an unrecognized column unmapped rather than guessing', () => {
    const mapping = autoMapColumns(['Some Random Column']);
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it('is case- and separator-insensitive', () => {
    const mapping = autoMapColumns(['COMPANY_NAME', 'Stage At Entry']);
    expect(mapping.company_name).toBe(0);
    expect(mapping.stage_at_entry).toBe(1);
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

  it('parses a fully valid row with no errors', () => {
    const [result] = parsePortfolioRows([HEADER, row()]);
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      companyName: 'Acme Health', website: 'https://acmehealth.com', domain: 'acmehealth.com',
      country: 'Portugal', stageAtEntry: 'seed', sectors: ['digital health', 'diagnostics'],
      ticketEur: 350_000, instrument: 'safe', investedAt: '2022-03-15', exitAt: undefined,
      exitType: undefined, contactName: 'Jane Doe', contactEmail: 'jane@acmehealth.com', status: 'current',
    });
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

  it('flags an unrecognized stage', () => {
    const [result] = parsePortfolioRows([HEADER, row({ stage_at_entry: 'growth' })]);
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
    const [result] = parsePortfolioRows([HEADER, row({ sectors: 'fintech | healthtech |  ' })]);
    expect(result.data?.sectors).toEqual(['fintech', 'healthtech']);
  });

  it('works with a custom column mapping (out-of-order / renamed headers)', () => {
    const customHeader = ['Company', 'Amount'];
    const mapping = { company_name: 0, ticket_eur: 1 } as const;
    const [result] = parsePortfolioRows([customHeader, ['Beta Robotics', '500k']], mapping);
    expect(result.data?.companyName).toBe('Beta Robotics');
    expect(result.data?.ticketEur).toBe(500_000);
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

describe('buildPortfolioImportPlan — Prompt 746 Phase 1', () => {
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
    expect(result.data?.sectors).toEqual(['fintech', 'healthtech']);
  });
});

describe('XLSX parsing — Prompt 746 Phase 1', () => {
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

  it('returns an empty array for a sheet with no rows at all', () => {
    // A workbook with literally zero sheets isn't a writable .xlsx file
    // (SheetJS itself refuses it) and so can never actually reach an
    // investor's upload — an empty SHEET is the realistic edge case: a
    // template downloaded and re-uploaded with nothing filled in.
    const buf = buildXlsx([]);
    expect(parsePortfolioXlsxRows(buf)).toEqual([]);
  });
});
