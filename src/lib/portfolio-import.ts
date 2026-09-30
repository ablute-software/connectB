// Prompt 746 Phase 1 — investor Portfolio tab: CSV/Excel import.
//
// Pure functions only (no I/O), mirroring structured-import.ts's own split
// so both the API routes and the client-side upload step can share the
// exact same logic, and so this file can be unit-tested directly. Reuses
// parseCsv (RFC4180-ish, already handles quoted fields) from structured-
// import.ts and normalizeName/normalizeDomain from catalog-dedupe.ts rather
// than reimplementing either — this repo's own stated convention.
//
// XLSX parsing uses the `xlsx` package (SheetJS, MIT/Apache — checked
// package.json before adding it: no xlsx-capable library existed in this
// repo already). parsePortfolioXlsxRows turns a workbook's first sheet into
// the exact same string[][] shape parseCsv produces, so everything below
// (column mapping, row parsing, duplicate detection) runs identically
// regardless of which file format the investor uploaded.
import * as XLSX from 'xlsx';
import { parseCsv } from './structured-import';
import { normalizeName, normalizeDomain } from './catalog-dedupe';

export type PortfolioStatus = 'current' | 'past';

// ---------- canonical columns + column mapping ----------

export const PORTFOLIO_IMPORT_FIELDS = [
  'company_name', 'website', 'country', 'stage_at_entry', 'sectors', 'ticket_eur',
  'instrument', 'invested_at', 'status', 'exit_at', 'exit_type', 'contact_name', 'contact_email',
] as const;

export type PortfolioImportField = typeof PORTFOLIO_IMPORT_FIELDS[number];

/** target field -> the column index it was found/assigned at in the uploaded file. Absent = not mapped. */
export type ColumnMapping = Partial<Record<PortfolioImportField, number>>;

// Real spreadsheets an investor already has rarely use our exact snake_case
// header names — these are the header spellings worth auto-detecting before
// asking a human to map the rest by hand. Never exhaustive by design: a
// miss just leaves that field unmapped, which the mapping-step UI surfaces
// for a manual pick, same as the founder-side importer's own "conflict"
// tier defers to a human rather than guessing.
const HEADER_ALIASES: Record<PortfolioImportField, string[]> = {
  company_name: ['company_name', 'company', 'name', 'startup', 'portfolio company'],
  website: ['website', 'url', 'site'],
  country: ['country', 'hq_country', 'location', 'geography'],
  stage_at_entry: ['stage_at_entry', 'stage', 'stage at entry', 'round'],
  sectors: ['sectors', 'sector', 'industry', 'industries', 'vertical'],
  ticket_eur: ['ticket_eur', 'ticket', 'amount', 'amount_eur', 'investment', 'invested amount', 'check size'],
  instrument: ['instrument', 'security', 'instrument_type', 'round type'],
  invested_at: ['invested_at', 'investment_date', 'date', 'date invested', 'investment date'],
  status: ['status'],
  exit_at: ['exit_at', 'exit date', 'exit_date'],
  exit_type: ['exit_type', 'exit', 'exit type'],
  contact_name: ['contact_name', 'contact', 'founder', 'founder_name', 'founder name'],
  contact_email: ['contact_email', 'email', 'founder_email', 'founder email'],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\s-]+/g, ' ');
}

export function autoMapColumns(headerRow: string[]): ColumnMapping {
  const normalized = headerRow.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  for (const field of PORTFOLIO_IMPORT_FIELDS) {
    const aliases = HEADER_ALIASES[field].map(normalizeHeader);
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) mapping[field] = idx;
  }
  return mapping;
}

export function portfolioImportTemplateCsv(): string {
  const header = PORTFOLIO_IMPORT_FIELDS.join(',');
  const example1 = 'Acme Health,https://acmehealth.com,Portugal,seed,"digital health|diagnostics",350000,safe,15/03/2022,current,,,Jane Doe,jane@acmehealth.com';
  const example2 = 'Old Robotics,https://oldrobotics.example,Spain,pre_seed,robotics,120000,convertible_note,2019-06-01,past,2023-09-01,acquisition,John Roe,john@oldrobotics.example';
  return `${header}\n${example1}\n${example2}\n`;
}

// ---------- date + amount parsing ----------

// "Datas PT e ISO" (the prompt's own wording): ISO yyyy-mm-dd is accepted
// as-is; any slash/dash-separated form is read as DD/MM/YYYY, the
// Portuguese convention — never MM/DD, which would silently swap day and
// month for most of the month on exactly the ambiguous dates a founder or
// investor is most likely to type by hand (the 1st-12th of a month).
export function parsePortfolioDate(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (isoMatch) {
    // Still validate it's a real calendar date, not just the right shape —
    // `new Date('2022-02-30')` does NOT throw or produce NaN, it silently
    // rolls over to March 2nd, so the round-trip check below (same
    // technique the DD/MM/YYYY branch already uses) is required, not
    // redundant with the regex.
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return undefined;
    return t;
  }
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const d = new Date(`${iso}T00:00:00Z`);
    // Catches e.g. 31/04/2022 (April has 30 days) — Date rolls it over to
    // May, so re-check the day survived instead of trusting the construct.
    if (Number.isNaN(d.getTime()) || d.getUTCDate() !== day || d.getUTCMonth() + 1 !== month) return undefined;
    return iso;
  }
  return undefined;
}

// "Tickets com €, k e M" (the prompt's own wording). Handles a bare number
// (with optional , thousands separators), and a decimal number followed by
// a k/M suffix, with an optional leading currency symbol and internal
// spaces stripped first. Not a full locale-aware money parser — European
// "350.000,00" (period as thousands separator) is intentionally out of
// scope, since the prompt names exactly three things to support and this
// covers all three unambiguously; a value that doesn't parse is a row error
// the preview surfaces, never a silent guess.
export function parseTicketAmount(raw: string): number | undefined {
  const stripped = raw.trim().replace(/[€$£\s]/g, '');
  if (!stripped) return undefined;
  const suffixMatch = /^(-?[\d.,]+)([kKmM])$/.exec(stripped);
  if (suffixMatch) {
    const base = Number(suffixMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(base)) return undefined;
    const mult = suffixMatch[2].toLowerCase() === 'k' ? 1_000 : 1_000_000;
    return Math.round(base * mult);
  }
  const plain = Number(stripped.replace(/,/g, ''));
  return Number.isFinite(plain) ? Math.round(plain) : undefined;
}

// ---------- row parsing ----------

export interface PortfolioCompanyRow {
  companyName: string;
  website?: string;
  domain: string | null;
  country?: string;
  stageAtEntry?: string;
  sectors: string[];
  ticketEur?: number;
  instrument?: string;
  investedAt?: string;
  exitAt?: string;
  exitType?: string;
  contactName?: string;
  contactEmail?: string;
  status: PortfolioStatus;
}

export interface RowError { field?: PortfolioImportField; message: string }

export interface ParsedPortfolioRow {
  /** 1-based, header row excluded — what the preview UI shows next to each error. */
  row: number;
  /** null only when the row has no usable company name at all. */
  data: PortfolioCompanyRow | null;
  errors: RowError[];
}

const VALID_STAGES = new Set(['pre_seed', 'seed', 'series_a', 'series_b', 'series_c_plus', 'later', 'other']);
const VALID_INSTRUMENTS = new Set(['equity', 'safe', 'convertible_note', 'other']);
const VALID_EXIT_TYPES = new Set(['acquisition', 'ipo', 'write_off', 'other']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slug(v: string): string {
  return v.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Turns file rows (header + data, as produced by parseCsv or
 * parsePortfolioXlsxRows) into validated portfolio-company rows, per-row
 * errors, and a resolved column mapping. No DB access — duplicate
 * detection against EXISTING rows is a separate step (detectDuplicates),
 * since only the caller (an API route, under RLS) knows what already
 * exists for this firm.
 */
export function parsePortfolioRows(rows: string[][], mapping?: ColumnMapping): ParsedPortfolioRow[] {
  if (rows.length === 0) return [];
  const map = mapping ?? autoMapColumns(rows[0]);
  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));

  return dataRows.map((r, i) => {
    const rowNum = i + 1;
    const get = (field: PortfolioImportField): string => {
      const idx = map[field];
      return idx == null ? '' : (r[idx] ?? '').trim();
    };
    const errors: RowError[] = [];

    const companyName = get('company_name');
    if (!companyName) errors.push({ field: 'company_name', message: 'Company name is required.' });

    const website = get('website') || undefined;
    const domain = normalizeDomain(website);
    const country = get('country') || undefined;

    let stageAtEntry: string | undefined;
    const stageRaw = get('stage_at_entry');
    if (stageRaw) {
      const s = slug(stageRaw);
      if (VALID_STAGES.has(s)) stageAtEntry = s;
      else errors.push({ field: 'stage_at_entry', message: `Unrecognized stage "${stageRaw}".` });
    }

    const sectorsRaw = get('sectors');
    const sectors = sectorsRaw ? sectorsRaw.split('|').map((s) => s.trim()).filter(Boolean) : [];

    let ticketEur: number | undefined;
    const ticketRaw = get('ticket_eur');
    if (ticketRaw) {
      ticketEur = parseTicketAmount(ticketRaw);
      if (ticketEur === undefined) errors.push({ field: 'ticket_eur', message: `Could not parse ticket amount "${ticketRaw}".` });
    }

    let instrument: string | undefined;
    const instrumentRaw = get('instrument');
    if (instrumentRaw) {
      const s = slug(instrumentRaw);
      if (VALID_INSTRUMENTS.has(s)) instrument = s;
      else errors.push({ field: 'instrument', message: `Unrecognized instrument "${instrumentRaw}".` });
    }

    let investedAt: string | undefined;
    const investedAtRaw = get('invested_at');
    if (investedAtRaw) {
      investedAt = parsePortfolioDate(investedAtRaw);
      if (investedAt === undefined) errors.push({ field: 'invested_at', message: `Could not parse date "${investedAtRaw}".` });
    }

    const statusRaw = slug(get('status') || 'current');
    const status: PortfolioStatus = statusRaw === 'past' ? 'past' : 'current';

    let exitAt: string | undefined;
    const exitAtRaw = get('exit_at');
    if (exitAtRaw) {
      if (status !== 'past') {
        errors.push({ field: 'exit_at', message: 'Exit date only applies to a Past company — set status to "past" or clear this column.' });
      } else {
        exitAt = parsePortfolioDate(exitAtRaw);
        if (exitAt === undefined) errors.push({ field: 'exit_at', message: `Could not parse date "${exitAtRaw}".` });
      }
    }

    let exitType: string | undefined;
    const exitTypeRaw = get('exit_type');
    if (exitTypeRaw) {
      if (status !== 'past') {
        errors.push({ field: 'exit_type', message: 'Exit type only applies to a Past company — set status to "past" or clear this column.' });
      } else {
        const s = slug(exitTypeRaw);
        if (VALID_EXIT_TYPES.has(s)) exitType = s;
        else errors.push({ field: 'exit_type', message: `Unrecognized exit type "${exitTypeRaw}".` });
      }
    }

    const contactName = get('contact_name') || undefined;
    const contactEmailRaw = get('contact_email');
    const contactEmail = contactEmailRaw || undefined;
    if (contactEmailRaw && !EMAIL_RE.test(contactEmailRaw)) {
      errors.push({ field: 'contact_email', message: `"${contactEmailRaw}" doesn't look like an email address.` });
    }

    if (!companyName) return { row: rowNum, data: null, errors };

    return {
      row: rowNum,
      data: {
        companyName, website, domain, country, stageAtEntry, sectors, ticketEur, instrument,
        investedAt, exitAt, exitType, contactName, contactEmail, status,
      },
      errors,
    };
  });
}

// ---------- duplicate detection ----------

export type DuplicateReason = 'domain' | 'name';
export interface DuplicateMatch { against: 'existing' | 'batch'; reason: DuplicateReason }

export interface ExistingPortfolioCompany { companyName: string; domain: string | null }

/**
 * "Mesmo domain, ou mesmo nome normalizado" (the prompt's own wording) —
 * checked against rows already in the DB for this firm AND against earlier
 * rows in the SAME import batch (a file can list the same company twice).
 * Keyed by row number (1-based, matching ParsedPortfolioRow.row) so the
 * preview UI can annotate the same rows parsePortfolioRows produced.
 */
export function detectDuplicates(
  rows: { row: number; companyName: string; domain: string | null }[],
  existing: ExistingPortfolioCompany[],
): Map<number, DuplicateMatch> {
  const existingDomains = new Set(existing.map((e) => e.domain).filter((d): d is string => !!d));
  const existingNames = new Set(existing.map((e) => normalizeName(e.companyName)));
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();
  const result = new Map<number, DuplicateMatch>();

  for (const r of rows) {
    const normName = normalizeName(r.companyName);
    if (r.domain && existingDomains.has(r.domain)) { result.set(r.row, { against: 'existing', reason: 'domain' }); continue; }
    if (existingNames.has(normName)) { result.set(r.row, { against: 'existing', reason: 'name' }); continue; }
    if (r.domain && seenDomains.has(r.domain)) { result.set(r.row, { against: 'batch', reason: 'domain' }); continue; }
    if (seenNames.has(normName)) { result.set(r.row, { against: 'batch', reason: 'name' }); continue; }
    if (r.domain) seenDomains.add(r.domain);
    seenNames.add(normName);
  }
  return result;
}

// ---------- full plan (parse + dedupe + default include) ----------

export interface PortfolioImportPlanItem {
  row: number;
  data: PortfolioCompanyRow | null;
  errors: RowError[];
  duplicate: DuplicateMatch | null;
  include: boolean;
}

export interface PortfolioImportPlan {
  mapping: ColumnMapping;
  items: PortfolioImportPlanItem[];
}

export function buildPortfolioImportPlan(
  rows: string[][],
  existing: ExistingPortfolioCompany[],
  mapping?: ColumnMapping,
): PortfolioImportPlan {
  const map = mapping ?? (rows.length ? autoMapColumns(rows[0]) : {});
  const parsed = parsePortfolioRows(rows, map);
  const dupInput = parsed
    .filter((p): p is ParsedPortfolioRow & { data: PortfolioCompanyRow } => p.data !== null)
    .map((p) => ({ row: p.row, companyName: p.data.companyName, domain: p.data.domain }));
  const dups = detectDuplicates(dupInput, existing);

  const items: PortfolioImportPlanItem[] = parsed.map((p) => {
    const duplicate = dups.get(p.row) ?? null;
    return {
      row: p.row, data: p.data, errors: p.errors, duplicate,
      include: p.data !== null && p.errors.length === 0 && duplicate === null,
    };
  });
  return { mapping: map, items };
}

// ---------- XLSX ----------

/** Reads a workbook's first sheet into the same string[][] shape parseCsv produces. */
export function parsePortfolioXlsxRows(data: ArrayBuffer): string[][] {
  const wb = XLSX.read(new Uint8Array(data), { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
  return rows.map((r) => r.map((c) => (c == null ? '' : String(c))));
}

export function parsePortfolioCsvRows(text: string): string[][] {
  return parseCsv(text);
}

// ---------- manual "Add manually" form validation ----------

export interface ManualPortfolioInputRow {
  status: PortfolioStatus; company_name: string; website: string | null; domain: string | null;
  country: string | null; stage_at_entry: string | null; sectors: string[]; ticket_eur: number | null;
  instrument: string | null; invested_at: string | null; exit_at: string | null; exit_type: string | null;
  contact_name: string | null; contact_email: string | null;
}

// Shared by the "Add manually" API route (app/api/portal/investor-profile/
// portfolio/route.ts) — kept here, not in the route file, because a route.ts
// file's exports are constrained by Next's own route-handler typing to the
// recognized HTTP-verb names (GET/POST/…), so a plain helper export there
// fails `next build`'s type check (confirmed: "does not satisfy the
// constraint '{ [x: string]: never; }'" — this file's own pure-function
// convention is the natural home for it anyway.
export function validateManualPortfolioInput(body: Record<string, unknown>): { error: string } | { row: ManualPortfolioInputRow } {
  const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
  if (!companyName) return { error: 'Company name is required.' };
  const status: PortfolioStatus = body.status === 'past' ? 'past' : 'current';

  const website = typeof body.website === 'string' && body.website.trim() ? body.website.trim() : null;
  const domain = normalizeDomain(website);

  let ticketEur: number | null = null;
  if (body.ticketEur !== undefined && body.ticketEur !== null && body.ticketEur !== '') {
    const parsed = typeof body.ticketEur === 'number' ? body.ticketEur : parseTicketAmount(String(body.ticketEur));
    if (parsed === undefined) return { error: `Could not parse ticket amount "${body.ticketEur}".` };
    ticketEur = parsed;
  }

  let investedAt: string | null = null;
  if (typeof body.investedAt === 'string' && body.investedAt.trim()) {
    // Manual-form dates come from an <input type="date"> (always ISO) — but
    // the same parser as the import path is reused anyway, once, rather
    // than assuming that and silently accepting a differently-shaped date
    // if the form ever changes.
    const parsed = parsePortfolioDate(body.investedAt.trim());
    if (parsed === undefined) return { error: `Could not parse invested date "${body.investedAt}".` };
    investedAt = parsed;
  }

  let exitAt: string | null = null;
  let exitType: string | null = null;
  if (status === 'past') {
    if (typeof body.exitAt === 'string' && body.exitAt.trim()) {
      const parsed = parsePortfolioDate(body.exitAt.trim());
      if (parsed === undefined) return { error: `Could not parse exit date "${body.exitAt}".` };
      exitAt = parsed;
    }
    if (typeof body.exitType === 'string' && body.exitType.trim()) {
      if (!VALID_EXIT_TYPES.has(body.exitType)) return { error: `Unrecognized exit type "${body.exitType}".` };
      exitType = body.exitType;
    }
  }

  if (body.instrument && !VALID_INSTRUMENTS.has(String(body.instrument))) {
    return { error: `Unrecognized instrument "${body.instrument}".` };
  }
  // Belt-and-braces: the manual form only ever offers these via a <select>,
  // so this should be unreachable from the UI — but the DB column is a real
  // Postgres enum (public.stage) either way, so a bad value would otherwise
  // surface as an opaque Postgres error instead of a clear one.
  if (body.stageAtEntry && !VALID_STAGES.has(String(body.stageAtEntry))) {
    return { error: `Unrecognized stage "${body.stageAtEntry}".` };
  }
  if (body.contactEmail && typeof body.contactEmail === 'string' && body.contactEmail.trim()
    && !EMAIL_RE.test(body.contactEmail.trim())) {
    return { error: `"${body.contactEmail}" doesn't look like an email address.` };
  }

  return {
    row: {
      status, company_name: companyName, website, domain,
      country: typeof body.country === 'string' && body.country.trim() ? body.country.trim() : null,
      stage_at_entry: typeof body.stageAtEntry === 'string' && body.stageAtEntry.trim() ? body.stageAtEntry.trim() : null,
      sectors: Array.isArray(body.sectors) ? body.sectors.filter((s): s is string => typeof s === 'string') : [],
      ticket_eur: ticketEur,
      instrument: body.instrument ? String(body.instrument) : null,
      invested_at: investedAt, exit_at: exitAt, exit_type: exitType,
      contact_name: typeof body.contactName === 'string' && body.contactName.trim() ? body.contactName.trim() : null,
      contact_email: typeof body.contactEmail === 'string' && body.contactEmail.trim() ? body.contactEmail.trim() : null,
    },
  };
}
