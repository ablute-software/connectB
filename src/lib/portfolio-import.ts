// Prompt 746 Phase 1 — investor Portfolio tab: CSV/Excel import.
//
// Pure functions only (no I/O), mirroring structured-import.ts's own split
// so both the API routes and the client-side upload step can share the
// exact same logic, and so this file can be unit-tested directly. Reuses
// parseCsv (RFC4180-ish, already handles quoted fields) from structured-
// import.ts and normalizeName/normalizeDomain from catalog-dedupe.ts rather
// than reimplementing either — this repo's own stated convention.
//
// Prompt 753 — the Nuno review that followed Phase 1: the parser silently
// MISREAD values instead of refusing them (a PT-formatted "350.000,00" came
// out as 350, a "1,5M" came out as 15 000 000, any status other than the
// literal word "past" silently became "current") and there was no way to
// fix a bad row except deleting it and re-typing the whole file. Every
// function below that transforms a value now follows the same rule: if the
// reading is confident, return it; if it's recognisably ambiguous, return it
// WITH a flag so the caller can warn instead of silently trusting it; if it
// cannot be read at all, return nothing and let the row-level error say so.
// Nothing is ever guessed past that line.
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
import { ALL_SECTOR_NAMES } from './sector-taxonomy';

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

// ---------- shared alias-matching helper ----------

// Case-, accent- and separator-insensitive, used by every alias table below
// (status/stage/instrument/exit_type) so there's exactly one normalization
// rule for "does this free-text value mean X", not a slightly different
// slug() per field the way Phase 1 had.
function normalizeToken(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_-]+/g, ' ').trim();
}

function buildAliasLookup<T extends string>(table: Record<T, string[]>): Map<string, T> {
  const lookup = new Map<string, T>();
  for (const key of Object.keys(table) as T[]) {
    for (const alias of table[key]) lookup.set(normalizeToken(alias), key);
  }
  return lookup;
}

// ---------- status ----------

// "Estado reconhecido, sem distinguir maiúsculas nem acentos... Qualquer
// outro valor é erro, nunca 'current' por omissão" (Prompt 753) — Phase 1's
// bug in one sentence: `status === 'past' ? 'past' : 'current'` silently
// turned "Exited", "Atual", or a typo into "current". Empty stays the one
// case that defaults, per the prompt's own instruction.
const STATUS_ALIASES: Record<PortfolioStatus, string[]> = {
  current: ['current', 'atual', 'actual', 'ativo', 'active', 'held', 'em carteira'],
  past: ['past', 'passado', 'exited', 'exit', 'saída', 'saida', 'vendido', 'realised', 'realized', 'written off'],
};
const STATUS_LOOKUP = buildAliasLookup(STATUS_ALIASES);

/** undefined input (or blank) -> 'current' (the documented default); a non-blank, unrecognized value -> undefined (error). */
export function parsePortfolioStatus(raw: string): PortfolioStatus | undefined {
  const t = raw.trim();
  if (!t) return 'current';
  return STATUS_LOOKUP.get(normalizeToken(t));
}

// ---------- stage ----------

// Reuses the public.stage enum's own full value set (pre_seed/seed/
// series_a/series_b/series_c_plus/later/other — see migration
// 20260930120000's own comment on stage_at_entry) — never a narrower list.
const STAGE_ALIASES: Record<string, string[]> = {
  pre_seed: ['pre_seed', 'pre-seed', 'pre seed', 'preseed'],
  seed: ['seed'],
  series_a: ['series a', 'série a', 'serie a', 'a'],
  series_b: ['series b', 'série b', 'serie b', 'b'],
  series_c_plus: ['series c+', 'series c plus', 'series c', 'série c', 'serie c', 'c'],
  later: ['later', 'late', 'growth'],
  other: ['other'],
};
const STAGE_LOOKUP = buildAliasLookup(STAGE_ALIASES);
// "Series D ou acima" folds into series_c_plus too — rather than hand-list
// every letter, a bare "series <letter>" (or a bare letter on its own) from
// D onward matches generically; A and B are handled by the table above
// first since the lookup is tried before this falls through.
const SERIES_LETTER_RE = /^series\s*([a-z])\+?$/;
const BARE_LETTER_RE = /^([a-z])\+?$/;

export function parsePortfolioStage(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const norm = normalizeToken(t);
  const direct = STAGE_LOOKUP.get(norm);
  if (direct) return direct;
  const m = SERIES_LETTER_RE.exec(norm) ?? BARE_LETTER_RE.exec(norm);
  if (m) {
    const letter = m[1];
    if (letter === 'a') return 'series_a';
    if (letter === 'b') return 'series_b';
    if (letter >= 'c' && letter <= 'z') return 'series_c_plus';
  }
  return undefined;
}

// ---------- instrument ----------

const INSTRUMENT_ALIASES: Record<string, string[]> = {
  equity: ['equity', 'ações', 'acoes', 'shares', 'stock'],
  safe: ['safe'],
  convertible_note: ['convertible', 'convertible note', 'nota convertível', 'nota convertivel'],
  // ASA (Advance Subscription Agreement, the UK near-equivalent of a SAFE)
  // has no dedicated enum bucket — closer in spirit to 'safe' than to
  // 'equity'/'convertible_note', but asserting it IS literally a SAFE would
  // overstate the match. Filed under 'other', the honest bucket, rather
  // than guessing a more specific one with no real backing — a judgment
  // call, flagged here rather than made silently.
  other: ['other', 'asa'],
};
const INSTRUMENT_LOOKUP = buildAliasLookup(INSTRUMENT_ALIASES);

export function parsePortfolioInstrument(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  return INSTRUMENT_LOOKUP.get(normalizeToken(t));
}

// ---------- exit type ----------

const EXIT_TYPE_ALIASES: Record<string, string[]> = {
  acquisition: ['acquisition', 'aquisição', 'aquisicao', 'm&a', 'm & a', 'venda', 'sale', 'acquired'],
  ipo: ['ipo'],
  write_off: ['write off', 'write_off', 'written off', 'falência', 'falencia', 'bankruptcy'],
  other: ['other'],
};
const EXIT_TYPE_LOOKUP = buildAliasLookup(EXIT_TYPE_ALIASES);

export function parsePortfolioExitType(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  return EXIT_TYPE_LOOKUP.get(normalizeToken(t));
}

// ---------- sectors ----------

const SECTOR_LOOKUP = new Map(ALL_SECTOR_NAMES.map((s) => [normalizeToken(s), s]));

export interface ParsedSectors { sectors: string[]; unmatched: string[] }

// "Separa por |, ;, , ou /. Confronta cada um com a taxonomia do
// SectorPicker; os que não batem ficam com aviso... não descartados"
// (Prompt 753). A token that doesn't match the taxonomy is KEPT as typed
// (never dropped) — the caller surfaces `unmatched` as a warning so the
// investor can fix the spelling or accept the free text as-is.
export function parsePortfolioSectors(raw: string): ParsedSectors {
  const tokens = raw.split(/[|;,/]/).map((s) => s.trim()).filter(Boolean);
  const sectors: string[] = [];
  const unmatched: string[] = [];
  for (const tok of tokens) {
    const canonical = SECTOR_LOOKUP.get(normalizeToken(tok));
    if (canonical) sectors.push(canonical);
    else { sectors.push(tok); unmatched.push(tok); }
  }
  return { sectors, unmatched };
}

// ---------- ticket amount ----------

export interface ParsedAmount { value: number; ambiguous: boolean }

// Resolves a single numeric token (no currency symbol, no k/M suffix — that
// part of the string is already peeled off by parseTicketAmount below) into
// a float, with `ambiguous` set whenever the reading is a best-guess rather
// than a confident one. `suffixed` is true when this number sits right
// before a k/M multiplier, which changes the reading rule: a lone "." or ","
// before a multiplier is ALWAYS a decimal point ("1.5M"/"1,5M" both mean
// 1.5 million) — never a thousands separator, since nobody writes
// "1.500M" (one thousand five hundred million) by hand.
function resolveNumericBase(s: string, suffixed: boolean): ParsedAmount | undefined {
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  // Both separators present: the LAST one is the decimal mark (Prompt 753
  // §A rule 1) — "350.000,00" -> comma is last -> decimal; "1,250.50" -> dot
  // is last -> decimal. The other separator is stripped as a thousands mark.
  if (hasDot && hasComma) {
    const decimalChar = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thousandChar = decimalChar === '.' ? ',' : '.';
    const n = Number(s.split(thousandChar).join('').replace(decimalChar, '.'));
    return Number.isFinite(n) ? { value: n, ambiguous: false } : undefined;
  }

  const sep = hasDot ? '.' : hasComma ? ',' : null;
  if (!sep) {
    const n = Number(s);
    return Number.isFinite(n) ? { value: n, ambiguous: false } : undefined;
  }

  // A k/M suffix always means what follows is a decimal fraction, regardless
  // of shape ("1.5M" and "1,5M" are both 1.5 * the multiplier).
  if (suffixed) {
    const n = Number(s.replace(sep, '.'));
    return Number.isFinite(n) ? { value: n, ambiguous: false } : undefined;
  }

  const parts = s.split(sep);
  const groups = parts.slice(1);
  // Thousands-grouping shape: every group after the first separator has
  // EXACTLY 3 digits ("350.000" -> ["350","000"]; "1.250.000" ->
  // ["1","250","000"]). This is the only shape this function will resolve
  // without a suffix — a lone "1,5" with no suffix is Prompt 753's own
  // named example of something that must be an ERROR, not a guessed decimal
  // ("1,5 sem sufixo → erro").
  const isGroupedShape = groups.length > 0 && /^\d+$/.test(parts[0]) && groups.every((g) => /^\d{3}$/.test(g));
  if (!isGroupedShape) return undefined;

  const n = Number(parts.join(''));
  if (!Number.isFinite(n)) return undefined;
  // A SINGLE group of exactly 3 digits, with only 1-2 digits before the
  // separator ("1.500"), is Prompt 753's own worked example of something
  // that stays ambiguous even after the rule resolves it: it reads just as
  // plausibly as a decimal typo (1.5) as it does 1500. A leading group of
  // 3+ digits ("350.000") or more than one group ("1.250.000") has no such
  // plausible decimal reading and stays confident.
  const ambiguous = groups.length === 1 && parts[0].length < 3;
  return { value: n, ambiguous };
}

// "Tickets com €, k e M" (the prompt's own wording), rewritten per Prompt
// 753's review: NEVER interprets an ambiguous value with silent confidence.
// `.ambiguous` lets the caller decide what "silent" means for its own UI —
// the import preview turns it into a correctable warning; the manual-add
// form (no preview step to show a warning in) treats it as a hard error.
export function parseTicketAmount(raw: string): ParsedAmount | undefined {
  const stripped = raw.trim().replace(/[€$£\s]/g, '');
  if (!stripped) return undefined;
  // ticket_eur >= 0 at the DB layer; a negative amount is never a case
  // worth guessing at — surfaces as "could not parse", same as any other
  // unreadable value.
  if (stripped.startsWith('-')) return undefined;

  const suffixMatch = /^([\d.,]+)([kKmM])$/.exec(stripped);
  if (suffixMatch) {
    const base = resolveNumericBase(suffixMatch[1], true);
    if (!base) return undefined;
    const mult = suffixMatch[2].toLowerCase() === 'k' ? 1_000 : 1_000_000;
    return { value: Math.round(base.value * mult), ambiguous: base.ambiguous };
  }

  const resolved = resolveNumericBase(stripped, false);
  if (!resolved) return undefined;
  return { value: Math.round(resolved.value), ambiguous: resolved.ambiguous };
}

/** "€350,000" — the full, uncompressed reading shown in the import preview next to the original cell text. Distinct from ticket-range.ts's formatTicketEur, which is a compact €350k/€1.2M display for elsewhere in the app. */
export function formatTicketDisplay(value: number): string {
  return `€${value.toLocaleString('en-US')}`;
}

// ---------- dates ----------

export interface ParsedDate { iso: string; ambiguous: boolean }

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, fev: 2, feb: 2, february: 2, fevereiro: 2, mar: 3, march: 3, marco: 3,
  abr: 4, apr: 4, april: 4, abril: 4, mai: 5, may: 5, maio: 5, jun: 6, june: 6, junho: 6,
  jul: 7, july: 7, julho: 7, ago: 8, aug: 8, august: 8, agosto: 8, set: 9, sep: 9, sept: 9,
  september: 9, setembro: 9, out: 10, oct: 10, october: 10, outubro: 10, nov: 11, november: 11,
  novembro: 11, dez: 12, dec: 12, december: 12, dezembro: 12, janeiro: 1,
};
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function normalizeMonthToken(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.$/, '');
}

function validateYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
}

function toIsoIfValid(year: number, month: number, day: number, ambiguous: boolean): ParsedDate | undefined {
  if (!validateYmd(year, month, day)) return undefined;
  return { iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, ambiguous };
}

// "Datas PT e ISO" (Prompt 746), extended by Prompt 753 to also read
// dd.mm.yyyy, a 2-digit year (flagged ambiguous — the century is a guess),
// "15 Mar 2022"/"15 de março de 2022", a bare year ("2019", flagged
// ambiguous), and an Excel serial date number (parsePortfolioXlsxRows now
// avoids needing this path for properly-typed date cells — see that
// function's own header — but a serial number pasted as plain text, or a
// date cell Excel didn't tag as a date, still needs it). ISO yyyy-mm-dd is
// accepted as-is; every slash/dot/dash-separated form is read DD/MM/YYYY,
// the Portuguese convention — never MM/DD, which would silently swap day
// and month for most of the month on exactly the dates a human is most
// likely to type by hand (the 1st-12th).
export function parsePortfolioDate(raw: string): ParsedDate | undefined {
  const t = raw.trim();
  if (!t) return undefined;

  // Excel serial date (days since 1899-12-30). Guarded to a plausible
  // calendar range (roughly 1954-2064) so a short, unrelated number typed
  // into a date column isn't misread as a date — a bare 4-digit number is
  // handled separately below as "year only", never reaching this branch.
  if (/^\d+$/.test(t) && t.length !== 4) {
    const serial = Number(t);
    if (serial >= 20000 && serial < 60000) {
      const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return { iso: d.toISOString().slice(0, 10), ambiguous: false };
    }
    return undefined;
  }

  // Year only — a real but imprecise answer, never silently promoted to a
  // specific day.
  if (/^\d{4}$/.test(t)) {
    const year = Number(t);
    if (year < 1900 || year > 2100) return undefined;
    return { iso: `${t}-01-01`, ambiguous: true };
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (isoMatch) {
    const [, y, mo, d] = isoMatch;
    return toIsoIfValid(Number(y), Number(mo), Number(d), false);
  }

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy — 4-digit year, confident.
  const dmy4 = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(t);
  if (dmy4) return toIsoIfValid(Number(dmy4[3]), Number(dmy4[2]), Number(dmy4[1]), false);

  // Same, but a 2-digit year — the century is a guess (00-69 -> 20xx, 70-99
  // -> 19xx), flagged ambiguous even when the guess is almost certainly right.
  const dmy2 = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2})$/.exec(t);
  if (dmy2) {
    const yy = Number(dmy2[3]);
    const year = yy <= 69 ? 2000 + yy : 1900 + yy;
    return toIsoIfValid(year, Number(dmy2[2]), Number(dmy2[1]), true);
  }

  // "15 Mar 2022" / "15 March 2022" / "15 de março de 2022" — day, a month
  // name (EN or PT, abbreviated or full, accent-insensitive), year.
  const textual = /^(\d{1,2})\s+(?:de\s+)?([A-Za-zÀ-ÿ]+)\.?\s+(?:de\s+)?(\d{4})$/.exec(t);
  if (textual) {
    const month = MONTH_NAMES[normalizeMonthToken(textual[2])];
    if (!month) return undefined;
    return toIsoIfValid(Number(textual[3]), month, Number(textual[1]), false);
  }

  return undefined;
}

/** "15 Mar 2022" — spelled out so a misread day/month swap is easy to spot at a glance, per Prompt 753 §D. */
export function formatDateDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${Number(d)} ${MONTH_SHORT[Number(mo) - 1]} ${y}`;
}

// ---------- CSV delimiter detection ----------

// "O Excel português exporta CSV com ; como separador" (Prompt 753 §C).
// Counts candidate delimiters on the file's first line only, OUTSIDE quoted
// spans (so a quoted field containing a comma doesn't skew the count), and
// picks whichever appears most. Comma remains the default when nothing else
// is found, so an empty/single-column file behaves exactly as before.
export function detectCsvDelimiter(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = withoutBom.split(/\r\n|\r|\n/)[0] ?? '';
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const c of firstLine) {
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (inQuotes) continue;
    if (c in counts) counts[c]++;
  }
  const [bestChar, bestCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return bestCount > 0 ? bestChar : ',';
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

export type IssueSeverity = 'error' | 'warning';
export interface RowIssue { field?: PortfolioImportField; message: string; severity: IssueSeverity }
/** @deprecated kept as an alias — `severity` is always present now, nothing else changed shape. */
export type RowError = RowIssue;

export interface ParsedPortfolioRow {
  /** 1-based, header row excluded — what the preview UI shows next to each error. */
  row: number;
  /** null only when the row has no usable company name at all. */
  data: PortfolioCompanyRow | null;
  /** Blocking — a row with any error can never be included, even after "Import anyway". */
  errors: RowIssue[];
  /** Non-blocking — a correctable, best-guess reading. Defaults to excluded, but "Import anyway" can opt it in (Prompt 753 §E). */
  warnings: RowIssue[];
  /** The original cell text for every MAPPED field, keyed by field — what the preview shows next to the "read as" value, and what cell-level editing starts from. */
  raw: Partial<Record<PortfolioImportField, string>>;
}

const VALID_STAGES = new Set(['pre_seed', 'seed', 'series_a', 'series_b', 'series_c_plus', 'later', 'other']);
const VALID_INSTRUMENTS = new Set(['equity', 'safe', 'convertible_note', 'other']);
const VALID_EXIT_TYPES = new Set(['acquisition', 'ipo', 'write_off', 'other']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The single per-row parser, shared by parsePortfolioRows (import, driven by
 * a column mapping over file rows) and, via the editable preview, a human
 * fixing one cell at a time — both call this with the same field->raw-text
 * shape, so "revalidam-se ao editar" (Prompt 753 §E) is just "call this
 * function again with the edited value in it," never a second copy of the
 * validation rules.
 */
export function parsePortfolioFields(fields: Partial<Record<PortfolioImportField, string>>): {
  data: PortfolioCompanyRow | null; errors: RowIssue[]; warnings: RowIssue[];
} {
  const get = (field: PortfolioImportField): string => (fields[field] ?? '').trim();
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const err = (field: PortfolioImportField, message: string) => errors.push({ field, message, severity: 'error' });
  const warn = (field: PortfolioImportField, message: string) => warnings.push({ field, message, severity: 'warning' });

  const companyName = get('company_name');
  if (!companyName) err('company_name', 'Company name is required.');

  const website = get('website') || undefined;
  const domain = normalizeDomain(website);
  const country = get('country') || undefined;

  let stageAtEntry: string | undefined;
  const stageRaw = get('stage_at_entry');
  if (stageRaw) {
    const s = parsePortfolioStage(stageRaw);
    if (s) stageAtEntry = s;
    else err('stage_at_entry', `Unrecognized stage "${stageRaw}" — expected one of ${[...VALID_STAGES].join(', ')}, or a recognized alias.`);
  }

  const sectorsRaw = get('sectors');
  let sectors: string[] = [];
  if (sectorsRaw) {
    const parsed = parsePortfolioSectors(sectorsRaw);
    sectors = parsed.sectors;
    for (const u of parsed.unmatched) warn('sectors', `Sector "${u}" doesn't match the taxonomy — kept as typed.`);
  }

  let ticketEur: number | undefined;
  const ticketRaw = get('ticket_eur');
  if (ticketRaw) {
    const parsed = parseTicketAmount(ticketRaw);
    if (parsed === undefined) err('ticket_eur', `Could not parse ticket amount "${ticketRaw}".`);
    else {
      ticketEur = parsed.value;
      if (parsed.ambiguous) warn('ticket_eur', `Read "${ticketRaw}" as ${formatTicketDisplay(parsed.value)} — check.`);
    }
  }

  let instrument: string | undefined;
  const instrumentRaw = get('instrument');
  if (instrumentRaw) {
    const s = parsePortfolioInstrument(instrumentRaw);
    if (s) instrument = s;
    else err('instrument', `Unrecognized instrument "${instrumentRaw}" — expected one of ${[...VALID_INSTRUMENTS].join(', ')}, or a recognized alias.`);
  }

  let investedAt: string | undefined;
  const investedAtRaw = get('invested_at');
  if (investedAtRaw) {
    const parsed = parsePortfolioDate(investedAtRaw);
    if (parsed === undefined) err('invested_at', `Could not parse date "${investedAtRaw}".`);
    else {
      investedAt = parsed.iso;
      if (parsed.ambiguous) warn('invested_at', `Read "${investedAtRaw}" as ${formatDateDisplay(parsed.iso)} — check.`);
    }
  }

  const status = parsePortfolioStatus(get('status'));
  if (status === undefined) {
    err('status', `Unrecognized status "${get('status')}" — expected past/current or a recognized alias.`);
  }
  const resolvedStatus: PortfolioStatus = status ?? 'current';

  let exitAt: string | undefined;
  const exitAtRaw = get('exit_at');
  if (exitAtRaw) {
    if (resolvedStatus !== 'past') {
      err('exit_at', 'Exit date only applies to a Past company — set status to "past" or clear this column.');
    } else {
      const parsed = parsePortfolioDate(exitAtRaw);
      if (parsed === undefined) err('exit_at', `Could not parse date "${exitAtRaw}".`);
      else {
        exitAt = parsed.iso;
        if (parsed.ambiguous) warn('exit_at', `Read "${exitAtRaw}" as ${formatDateDisplay(parsed.iso)} — check.`);
      }
    }
  }

  let exitType: string | undefined;
  const exitTypeRaw = get('exit_type');
  if (exitTypeRaw) {
    if (resolvedStatus !== 'past') {
      err('exit_type', 'Exit type only applies to a Past company — set status to "past" or clear this column.');
    } else {
      const s = parsePortfolioExitType(exitTypeRaw);
      if (s) exitType = s;
      else err('exit_type', `Unrecognized exit type "${exitTypeRaw}" — expected one of ${[...VALID_EXIT_TYPES].join(', ')}, or a recognized alias.`);
    }
  }

  const contactName = get('contact_name') || undefined;
  const contactEmailRaw = get('contact_email');
  const contactEmail = contactEmailRaw || undefined;
  if (contactEmailRaw && !EMAIL_RE.test(contactEmailRaw)) {
    err('contact_email', `"${contactEmailRaw}" doesn't look like an email address.`);
  }

  if (!companyName) return { data: null, errors, warnings };

  return {
    data: {
      companyName, website, domain, country, stageAtEntry, sectors, ticketEur, instrument,
      investedAt, exitAt, exitType, contactName, contactEmail, status: resolvedStatus,
    },
    errors, warnings,
  };
}

/**
 * Turns file rows (header + data, as produced by parseCsv or
 * parsePortfolioXlsxRows) into validated portfolio-company rows, per-row
 * errors/warnings, and a resolved column mapping. No DB access — duplicate
 * detection against EXISTING rows is a separate step (detectDuplicates),
 * since only the caller (an API route, under RLS) knows what already
 * exists for this firm.
 */
export function parsePortfolioRows(rows: string[][], mapping?: ColumnMapping): ParsedPortfolioRow[] {
  if (rows.length === 0) return [];
  const map = mapping ?? autoMapColumns(rows[0]);
  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
  const mappedFields = PORTFOLIO_IMPORT_FIELDS.filter((f) => map[f] != null);

  return dataRows.map((r, i) => {
    const fields: Partial<Record<PortfolioImportField, string>> = {};
    const raw: Partial<Record<PortfolioImportField, string>> = {};
    for (const field of mappedFields) {
      const idx = map[field] as number;
      const v = (r[idx] ?? '').trim();
      fields[field] = v;
      raw[field] = v;
    }
    const { data, errors, warnings } = parsePortfolioFields(fields);
    return { row: i + 1, data, errors, warnings, raw };
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

// "Se a edição passar a coincidir (nome normalizado ou domínio) com OUTRA
// linha do mesmo investidor, avisa... sem bloquear" (Prompt 753 §F) — reuses
// detectDuplicates itself (the edited row as a 1-row "batch" against every
// OTHER existing row, the row being edited excluded by id) rather than a
// second comparison rule that could drift from the import-time one.
export function detectDuplicateForEdit(
  edited: { companyName: string; domain: string | null },
  excludeId: string,
  existing: { id: string; companyName: string; domain: string | null }[],
): DuplicateMatch | null {
  const others = existing.filter((e) => e.id !== excludeId);
  const dupMap = detectDuplicates([{ row: 1, companyName: edited.companyName, domain: edited.domain }], others);
  return dupMap.get(1) ?? null;
}

// ---------- full plan (parse + dedupe + default include) ----------

export interface PortfolioImportPlanItem {
  row: number;
  data: PortfolioCompanyRow | null;
  errors: RowIssue[];
  warnings: RowIssue[];
  raw: Partial<Record<PortfolioImportField, string>>;
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
      row: p.row, data: p.data, errors: p.errors, warnings: p.warnings, raw: p.raw, duplicate,
      // A warning (ambiguous reading, unmatched sector, …) opts a row OUT
      // by default too, same as a duplicate — "Import anyway" (Prompt 753
      // §E) is what opts it back in; only an ERROR can never be opted in.
      include: p.data !== null && p.errors.length === 0 && p.warnings.length === 0 && duplicate === null,
    };
  });
  return { mapping: map, items };
}

// ---------- XLSX ----------

function xlsxCellToString(c: unknown): string {
  if (c == null) return '';
  if (c instanceof Date) {
    // cellDates:true (see parsePortfolioXlsxRows) anchors a date-formatted
    // cell's Date object at UTC midnight for the stored calendar date —
    // read the UTC fields, never local ones, or a negative-UTC-offset
    // environment shifts the day by one. Formatted straight to ISO, never
    // through a locale-dependent toLocaleDateString, so no text-parsing
    // ambiguity is even possible for a cell Excel itself already typed as a
    // date (Prompt 753 §C's real fix — see this function's own header).
    const y = c.getUTCFullYear(), m = c.getUTCMonth() + 1, d = c.getUTCDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return String(c);
}

/**
 * Reads a workbook's first sheet into the same string[][] shape parseCsv
 * produces. Prompt 753 §C — `raw: false` (Phase 1's own setting) asks
 * SheetJS to TEXT-FORMAT every cell, and its date formatting does not
 * reliably follow the cell's own custom number-format string (confirmed:
 * a cell explicitly formatted dd/mm/yyyy still came back month-first).
 * `cellDates: true` + `raw: true` instead hands back a real JS Date object
 * for any cell Excel itself typed as a date, and a plain number for a
 * money cell — both converted here with no text-parsing step in between,
 * so there is nothing left for a locale mismatch to get wrong. A date cell
 * Excel did NOT tag as a date (a bare serial number pasted in) still comes
 * through as a plain numeric string, which parsePortfolioDate's own Excel-
 * serial fallback (see that function) catches on the way in.
 */
export function parsePortfolioXlsxRows(data: ArrayBuffer): string[][] {
  const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
  return rows.map((r) => r.map(xlsxCellToString));
}

/** Detects , / ; / tab (Prompt 753 §C — a PT Excel export uses ;) before parsing. The founder-side importer's own parseCsv(text) call is untouched — it never passes a delimiter, so its default (',') is unchanged. */
export function parsePortfolioCsvRows(text: string): string[][] {
  return parseCsv(text, detectCsvDelimiter(text));
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
//
// Unlike the import preview, this form has no row to show a correctable
// warning in — an ambiguous ticket/date reading here is simply rejected
// with a message asking for an unambiguous value, rather than silently
// guessed (same "never guess in silence" rule, just with no soft landing).
export function validateManualPortfolioInput(body: Record<string, unknown>): { error: string } | { row: ManualPortfolioInputRow } {
  const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
  if (!companyName) return { error: 'Company name is required.' };
  const status: PortfolioStatus = body.status === 'past' ? 'past' : 'current';

  const website = typeof body.website === 'string' && body.website.trim() ? body.website.trim() : null;
  const domain = normalizeDomain(website);

  let ticketEur: number | null = null;
  if (body.ticketEur !== undefined && body.ticketEur !== null && body.ticketEur !== '') {
    const parsed = typeof body.ticketEur === 'number'
      ? { value: body.ticketEur, ambiguous: false }
      : parseTicketAmount(String(body.ticketEur));
    if (parsed === undefined) return { error: `Could not parse ticket amount "${body.ticketEur}".` };
    if (parsed.ambiguous) return { error: `"${body.ticketEur}" is ambiguous — type an exact amount (e.g. 350000 or 350,000.00) instead.` };
    ticketEur = parsed.value;
  }

  let investedAt: string | null = null;
  if (typeof body.investedAt === 'string' && body.investedAt.trim()) {
    // Manual-form dates come from an <input type="date"> (always ISO) — but
    // the same parser as the import path is reused anyway, once, rather
    // than assuming that and silently accepting a differently-shaped date
    // if the form ever changes.
    const parsed = parsePortfolioDate(body.investedAt.trim());
    if (parsed === undefined) return { error: `Could not parse invested date "${body.investedAt}".` };
    investedAt = parsed.iso;
  }

  let exitAt: string | null = null;
  let exitType: string | null = null;
  if (status === 'past') {
    if (typeof body.exitAt === 'string' && body.exitAt.trim()) {
      const parsed = parsePortfolioDate(body.exitAt.trim());
      if (parsed === undefined) return { error: `Could not parse exit date "${body.exitAt}".` };
      exitAt = parsed.iso;
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
