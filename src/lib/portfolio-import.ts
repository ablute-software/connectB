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
import type { PortfolioCompany } from './portfolio-table';

export type PortfolioStatus = 'current' | 'past';

// ---------- canonical columns + column mapping ----------

export const PORTFOLIO_IMPORT_FIELDS = [
  'company_name', 'website', 'country', 'stage_at_entry', 'sectors', 'ticket_eur',
  'instrument', 'invested_at', 'status', 'exit_at', 'exit_type', 'contact_name', 'contact_email', 'contact_phone',
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
//
// Prompt AL757 — the aliases below are PT+EN now, not EN-only: Nuno's own
// three test files used "Mail"/"Tel." (missing from contact_email/no field
// at all) and, in Portuguese, "Nome"/"Valor investimento"/"Localização"/
// "Quando" — none of which matched anything, so autoMapColumns found
// NOTHING and the whole preview showed every field as unmapped even though
// the file had a perfectly good header. normalizeHeader (below) now also
// strips accents and punctuation, so "Tel." and "tel" — or "Localização"
// and "localizacao" — are the same alias lookup.
const HEADER_ALIASES: Record<PortfolioImportField, string[]> = {
  company_name: ['company_name', 'company', 'name', 'startup', 'portfolio company', 'nome', 'empresa', 'nome da empresa', 'companhia', 'participada'],
  website: ['website', 'url', 'site', 'página', 'pagina', 'web'],
  country: ['country', 'hq_country', 'location', 'geography', 'país', 'pais', 'localização', 'localizacao', 'local', 'geografia'],
  stage_at_entry: ['stage_at_entry', 'stage', 'stage at entry', 'round', 'fase', 'ronda', 'estágio', 'estagio'],
  sectors: ['sectors', 'sector', 'industry', 'industries', 'vertical', 'setor', 'área', 'area', 'indústria', 'industria', 'mercado'],
  ticket_eur: ['ticket_eur', 'ticket', 'amount', 'amount_eur', 'investment', 'invested amount', 'check size', 'valor', 'valor investimento', 'valor investido', 'montante', 'investimento', 'cheque'],
  instrument: ['instrument', 'security', 'instrument_type', 'round type', 'instrumento', 'tipo de investimento'],
  invested_at: ['invested_at', 'investment_date', 'date', 'date invested', 'investment date', 'quando', 'data', 'data investimento', 'data de investimento', 'ano'],
  status: ['status', 'estado', 'situação', 'situacao'],
  exit_at: ['exit_at', 'exit date', 'exit_date', 'data de saída', 'data de saida', 'data saída', 'data saida'],
  exit_type: ['exit_type', 'exit', 'exit type', 'tipo de saída', 'tipo de saida'],
  contact_name: ['contact_name', 'contact', 'founder', 'founder_name', 'founder name', 'contacto', 'nome do contacto', 'fundador'],
  contact_email: ['contact_email', 'email', 'founder_email', 'founder email', 'mail', 'e-mail', 'correio eletrónico', 'correio eletronico'],
  contact_phone: ['contact_phone', 'phone', 'telephone', 'tel', 'tel.', 'telefone', 'phone number', 'contact phone', 'telemóvel', 'telemovel'],
};

// Accent- and punctuation-insensitive, same spirit as normalizeToken (used
// by every alias table below) but kept separate since a header can carry
// punctuation none of those tables need to worry about ("Tel." -> "tel").
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?'"()]/g, '')
    .replace(/[_\s-]+/g, ' ')
    .trim();
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

// ---------- AL757: strip blank rows/columns, find the header, guess the rest ----------

export interface StrippedGrid {
  /** Blank rows and blank columns removed, in both directions, anywhere in the grid. */
  rows: string[][];
  /** Same length as `rows` — the 1-based line number EACH kept row had in the ORIGINAL file, so a row number shown to the investor still points at the right line in their own spreadsheet. */
  originalRowNumbers: number[];
}

// "Ignora linhas totalmente vazias e colunas totalmente vazias (à esquerda,
// à direita e no meio)... antes de qualquer mapeamento" (Prompt AL757 §A) —
// what a spreadsheet exports when its real table doesn't start at A1 (a
// title row above it, a spacer column to its left). Position-agnostic by
// design: a column is dropped only if EVERY row leaves it blank, regardless
// of where it sits, so a genuinely blank column in the middle of real data
// is removed exactly like a leading one.
export function stripEmptyRowsAndColumns(rawRows: string[][]): StrippedGrid {
  const nonEmptyRowIdx: number[] = [];
  rawRows.forEach((r, i) => { if (r.some((c) => c.trim() !== '')) nonEmptyRowIdx.push(i); });

  const maxCols = rawRows.reduce((m, r) => Math.max(m, r.length), 0);
  const nonEmptyColIdx: number[] = [];
  for (let c = 0; c < maxCols; c++) {
    if (nonEmptyRowIdx.some((ri) => (rawRows[ri][c] ?? '').trim() !== '')) nonEmptyColIdx.push(c);
  }

  const rows = nonEmptyRowIdx.map((ri) => nonEmptyColIdx.map((ci) => rawRows[ri][ci] ?? ''));
  const originalRowNumbers = nonEmptyRowIdx.map((ri) => ri + 1);
  return { rows, originalRowNumbers };
}

// Content-detection fields — "só para colunas que ficarem por mapear"
// (Prompt AL757 §B). company_name is deliberately NOT one of these: there
// is no reliable text pattern for "this looks like a company name" the way
// there is for an email or a URL, so it is only ever assigned by a
// recognized header alias, never guessed from values — which is also what
// keeps this list from ever double-guessing company_name when a
// nome/name header column was already found.
const CONTENT_FIELD_ORDER = ['contact_email', 'website', 'ticket_eur', 'invested_at', 'country'] as const;
type ContentField = typeof CONTENT_FIELD_ORDER[number];

function cellLooksLikeEmail(s: string): boolean {
  return EMAIL_RE.test(s);
}
function cellLooksLikeWebsite(s: string): boolean {
  if (/^https?:\/\//i.test(s)) return true;
  // A purely-numeric dotted string ("120.000", a thousands-grouped
  // amount) otherwise satisfies the bare-domain shape below just as
  // happily as a real hostname does — require at least one letter so a
  // money- or date-shaped cell is never mistaken for a schemeless domain.
  if (!/[a-z]/i.test(s)) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(s);
}
// "Valores com k/M/€/milhares" — a currency symbol, a k/M suffix, or a
// thousands-grouped number (350.000-shaped). A bare small integer ("5") is
// deliberately NOT money-shaped — plenty of other columns (a count, a bare
// year) look exactly like that, and parseTicketAmount would happily parse
// any of them.
function cellLooksLikeMoney(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/[€$£]/.test(t)) return parseTicketAmount(t) !== undefined;
  if (/^[\d.,]+[kKmM]$/.test(t)) return parseTicketAmount(t) !== undefined;
  if (!/[.,]/.test(t)) return false;
  const parsed = parseTicketAmount(t);
  return parsed !== undefined && parsed.value >= 1000;
}
// "Datas ou anos de 4 dígitos" — parsePortfolioDate already accepts both
// (plus the Excel-serial-as-text fallback), so this is just a thin alias
// rather than a second date-shape check that could drift from the real one.
function cellLooksLikeDate(s: string): boolean {
  return parsePortfolioDate(s) !== undefined;
}
// Heuristic only, for "does this column look like a country column" — NOT
// a normalization map (confirmed in Prompt 753's own review: no PT->EN
// country map exists anywhere in this repo, and country is stored exactly
// as the investor typed it). EN + PT spellings for the countries this
// product's own investors/startups are overwhelmingly based in, plus the
// other large markets an EU-based firm's portfolio commonly spans.
const CONTENT_COUNTRY_NAMES = [
  'portugal', 'spain', 'espanha', 'france', 'frança', 'franca', 'germany', 'alemanha', 'italy', 'italia', 'itália',
  'netherlands', 'holanda', 'países baixos', 'paises baixos', 'belgium', 'bélgica', 'belgica', 'ireland', 'irlanda',
  'united kingdom', 'uk', 'reino unido', 'england', 'inglaterra', 'united states', 'usa', 'us', 'estados unidos',
  'brazil', 'brasil', 'switzerland', 'suíça', 'suica', 'sweden', 'suécia', 'suecia', 'denmark', 'dinamarca',
  'norway', 'noruega', 'finland', 'finlândia', 'finlandia', 'poland', 'polónia', 'polonia', 'austria', 'áustria',
  'luxembourg', 'luxemburgo', 'greece', 'grécia', 'grecia', 'canada', 'canadá', 'mexico', 'méxico', 'india',
  'china', 'japan', 'japão', 'japao', 'singapore', 'singapura', 'israel', 'estonia', 'estónia', 'angola',
  'mozambique', 'moçambique', 'mocambique', 'cape verde', 'cabo verde',
].map(normalizeToken);
const CONTENT_COUNTRY_SET = new Set(CONTENT_COUNTRY_NAMES);
function cellLooksLikeCountry(s: string): boolean {
  return CONTENT_COUNTRY_SET.has(normalizeToken(s));
}

const CONTENT_TESTERS: Record<ContentField, (s: string) => boolean> = {
  contact_email: cellLooksLikeEmail, website: cellLooksLikeWebsite, ticket_eur: cellLooksLikeMoney,
  invested_at: cellLooksLikeDate, country: cellLooksLikeCountry,
};

// ≥80% of a column's non-blank values matching one pattern — "só quando ≥80%
// das células não vazias batem". Tried in a fixed priority order so a value
// that could plausibly match two testers (rare, but a dd/mm/yyyy-shaped
// string with dots is never money-shaped and an email is never website-
// shaped either, by construction) resolves the same way every time.
function guessFieldFromContent(values: string[]): ContentField | undefined {
  if (values.length === 0) return undefined;
  for (const field of CONTENT_FIELD_ORDER) {
    const tester = CONTENT_TESTERS[field];
    const matches = values.filter(tester).length;
    if (matches / values.length >= 0.8) return field;
  }
  return undefined;
}

export interface HeaderDetection {
  /** Index within the STRIPPED grid (StrippedGrid.rows) of the row treated as the header. */
  headerRowIndex: number;
  mapping: ColumnMapping;
  /** Fields resolved by guessing from the DATA, not from a recognized header alias — the mapping-step UI marks these "guessed from the values" for the investor to confirm. */
  guessedFields: PortfolioImportField[];
  /** Columns (by index into the header row, plus whatever header text they had) that matched no field at all, header or content. */
  unmappedColumns: { index: number; header: string }[];
}

// "O cabeçalho é a primeira das primeiras 10 linhas não vazias com pelo
// menos 2 células que batem num alias de campo. Se nenhuma bater, usa a
// primeira linha não vazia e passa à detecção por conteúdo" (Prompt AL757
// §A/§B) — runs on an ALREADY-stripped grid (stripEmptyRowsAndColumns), so
// "first 10 non-empty rows" is just "first 10 rows" here; a title/junk row
// above the real header (non-blank, so stripping doesn't remove it) simply
// fails the ≥2-alias test and the loop moves on to the next row, same as a
// genuinely blank row would have — this is also exactly the "no header
// found, treat the first line as one anyway" fallback Nuno's own three
// files never had to exercise, kept for a file that truly has no header row
// to recognize (every remaining field falls to content-detection, or stays
// unmapped for a human to pick manually).
export function detectHeaderAndMapping(strippedRows: string[][]): HeaderDetection {
  const candidateCount = Math.min(10, strippedRows.length);
  let headerRowIndex = 0;
  let mapping: ColumnMapping = {};
  for (let i = 0; i < candidateCount; i++) {
    const m = autoMapColumns(strippedRows[i]);
    if (Object.keys(m).length >= 2) { headerRowIndex = i; mapping = { ...m }; break; }
  }

  const headerRow = strippedRows[headerRowIndex] ?? [];
  const dataRows = strippedRows.slice(headerRowIndex + 1);
  const mappedCols = new Set(Object.values(mapping));
  const guessedFields: PortfolioImportField[] = [];

  for (let c = 0; c < headerRow.length; c++) {
    if (mappedCols.has(c)) continue;
    const values = dataRows.map((r) => (r[c] ?? '').trim()).filter(Boolean);
    const field = guessFieldFromContent(values);
    if (field) {
      mapping[field] = c;
      mappedCols.add(c);
      guessedFields.push(field);
    }
  }

  const unmappedColumns = headerRow
    .map((h, i) => ({ index: i, header: h }))
    .filter(({ index }) => !mappedCols.has(index));

  return { headerRowIndex, mapping, guessedFields, unmappedColumns };
}

// Prompt AL758 §C — one template per tab. Neither has a `status` column: the
// tab the investor imports FROM is the status (AL757 §D's default), so a
// column for it would only invite a contradiction. Current has no exit
// columns at all; Past adds exit_at and exit_type right after invested_at,
// the same order as its table. The headers are the snake_case names the
// AL757 auto-mapping recognizes with no effort (each is the first alias of
// its field).
export type PortfolioTemplateTab = 'current' | 'past';

const CURRENT_TEMPLATE_FIELDS: PortfolioImportField[] = [
  'company_name', 'website', 'country', 'stage_at_entry', 'sectors', 'ticket_eur', 'instrument', 'invested_at',
  'contact_name', 'contact_email', 'contact_phone',
];
const PAST_TEMPLATE_FIELDS: PortfolioImportField[] = [
  'company_name', 'website', 'country', 'stage_at_entry', 'sectors', 'ticket_eur', 'instrument', 'invested_at',
  'exit_at', 'exit_type', 'contact_name', 'contact_email', 'contact_phone',
];

// Real taxonomy sector names, so a freshly downloaded template imports with
// no warnings at all — not even the "doesn't match the taxonomy" kind.
const TEMPLATE_EXAMPLES: Record<PortfolioTemplateTab, Partial<Record<PortfolioImportField, string>>[]> = {
  current: [
    {
      company_name: 'Acme Health', website: 'https://acmehealth.com', country: 'Portugal', stage_at_entry: 'seed',
      sectors: 'Digital Health|Diagnostics', ticket_eur: '350000', instrument: 'safe', invested_at: '15/03/2022',
      contact_name: 'Jane Doe', contact_email: 'jane@acmehealth.com', contact_phone: '+351 912345678',
    },
    {
      company_name: 'Beta Robotics', website: 'https://betarobotics.example', country: 'Spain', stage_at_entry: 'pre_seed',
      sectors: 'Robotics & Automation', ticket_eur: '120k', instrument: 'equity', invested_at: '2024-06-01',
      contact_name: 'John Roe', contact_email: 'john@betarobotics.example', contact_phone: '',
    },
  ],
  past: [
    {
      company_name: 'Old Robotics', website: 'https://oldrobotics.example', country: 'Spain', stage_at_entry: 'pre_seed',
      sectors: 'Robotics & Automation', ticket_eur: '120000', instrument: 'convertible_note', invested_at: '2019-06-01',
      exit_at: '2023-09-01', exit_type: 'acquisition',
      contact_name: 'John Roe', contact_email: 'john@oldrobotics.example', contact_phone: '+34 600 000 000',
    },
    {
      company_name: 'Legacy Health', website: 'https://legacyhealth.example', country: 'Portugal', stage_at_entry: 'series_a',
      sectors: 'MedTech & Medical Devices', ticket_eur: '1.5M', instrument: 'equity', invested_at: '12/04/2017',
      exit_at: '30/11/2022', exit_type: 'ipo',
      contact_name: '', contact_email: '', contact_phone: '',
    },
  ],
};

export function portfolioTemplateFields(tab: PortfolioTemplateTab): PortfolioImportField[] {
  return tab === 'past' ? PAST_TEMPLATE_FIELDS : CURRENT_TEMPLATE_FIELDS;
}

export function portfolioTemplateFilename(tab: PortfolioTemplateTab): string {
  return `portfolio-${tab}-template.csv`;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function portfolioImportTemplateCsv(tab: PortfolioTemplateTab = 'current'): string {
  const fields = portfolioTemplateFields(tab);
  const lines = [fields.join(',')];
  for (const ex of TEMPLATE_EXAMPLES[tab]) lines.push(fields.map((f) => csvCell(ex[f] ?? '')).join(','));
  return `${lines.join('\n')}\n`;
}

/**
 * "Accepted instrument values: …" — shown as small text under the download
 * button, NOT as a comment line inside the CSV (a second header-ish row
 * would break the import). Built from the same sets the validators use, so
 * the help can never list a value the import would reject.
 */
export function acceptedValuesHelp(tab: PortfolioTemplateTab): { label: string; values: string }[] {
  const help = [
    { label: 'Stage at entry', values: [...VALID_STAGES].join(' | ') },
    { label: 'Instrument', values: [...VALID_INSTRUMENTS].join(' | ') },
  ];
  if (tab === 'past') help.push({ label: 'Exit type', values: [...VALID_EXIT_TYPES].join(' | ') });
  return help;
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

// Prompt AL757 §F — short industry nicknames investors actually type
// ("MedTech", "healthtech", "fintech"...) that don't literally appear
// inside the taxonomy's own longer names. Values below are copied verbatim
// from sector-taxonomy.ts — confirmed there, not invented — so a lookup
// miss here is a real taxonomy gap, never a typo in this table.
const SECTOR_SHORT_ALIASES: Record<string, string> = {
  medtech: 'MedTech & Medical Devices', healthtech: 'Digital Health', fintech: 'FinTech & InsurTech',
  insurtech: 'FinTech & InsurTech', edtech: 'EdTech', agritech: 'AgriTech & FoodTech', foodtech: 'AgriTech & FoodTech',
  cleantech: 'ClimateTech & CleanTech', climatetech: 'ClimateTech & CleanTech', proptech: 'PropTech',
  legaltech: 'LegalTech & RegTech', regtech: 'LegalTech & RegTech', govtech: 'GovTech',
  hrtech: 'HRTech & Future of Work', traveltech: 'TravelTech & Hospitality', agetech: 'Longevity, AgeTech & Wellness',
  pettech: 'PetTech', watertech: 'WaterTech', bluetech: 'BlueTech & OceanTech', oceantech: 'BlueTech & OceanTech',
  deeptech: 'DeepTech', spacetech: 'Aerospace & SpaceTech', femhealth: 'FemHealth',
  biotech: 'Biotechnology & Life Sciences',
};
const SECTOR_SHORT_LOOKUP = new Map(Object.entries(SECTOR_SHORT_ALIASES).map(([k, v]) => [normalizeToken(k), v]));

// A taxonomy name split into its own words/segments ("FinTech & InsurTech"
// -> ["fintech", "insurtech"]) — what a short token is actually compared
// against below, rather than the whole multi-word name at once (comparing
// "MedTec" to the WHOLE string "medtech medical devices" would never read
// as a close match by edit distance, even though it obviously should).
function sectorSegments(name: string): string[] {
  return name.split(/[\s,&]+/).map(normalizeToken).filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// "Se mesmo assim não bater, aviso com a sugestão mais próxima" (Prompt
// AL757 §F) — the closest taxonomy name by edit distance against any one
// of its own segments, within a threshold scaled to the token's own
// length (a short token needs a tight threshold or everything looks
// "close"; "medtec" (6 chars) vs. "medtech" (distance 1) comfortably
// clears it). Returns undefined rather than a far-fetched guess when
// nothing is actually close.
export function suggestSector(token: string): string | undefined {
  const norm = normalizeToken(token);
  if (!norm) return undefined;
  let best: { name: string; dist: number } | undefined;
  for (const name of ALL_SECTOR_NAMES) {
    for (const seg of sectorSegments(name)) {
      const dist = levenshtein(norm, seg);
      if (!best || dist < best.dist) best = { name, dist };
    }
  }
  if (!best) return undefined;
  const threshold = Math.max(1, Math.ceil(norm.length * 0.34));
  return best.dist <= threshold ? best.name : undefined;
}

// A token that's a substring of, or has as a substring, exactly ONE
// taxonomy name — "início ou palavra contida quando só há um candidato".
// Deliberately skipped for very short tokens (<3 chars) where almost
// everything is "contained" in something and the match would be noise.
// Compared against each taxonomy name's own SEGMENTS (same split
// suggestSector uses), not the whole multi-word name — "software" should
// match "Enterprise Software & SaaS" by its own word, not by accident
// through an unrelated one. A margin of 2+ characters between the token
// and the segment it's a prefix/suffix of is required: "roboti" (6) is a
// confident abbreviation of "robotics" (8, margin 2), but "medtec" (6) is
// NOT confidently an abbreviation of "medtech" (7, margin 1) — that is a
// one-letter-short TYPO of a recognized short alias, which this repo's own
// Prompt AL757 explicitly wants routed to the suggestion-and-confirm flow
// (suggestSector) instead of a silent auto-match.
function uniqueContainsMatch(token: string): string | undefined {
  const norm = normalizeToken(token);
  if (norm.length < 3) return undefined;
  const candidates = ALL_SECTOR_NAMES.filter((name) => sectorSegments(name).some((seg) => {
    const longer = seg.length >= norm.length ? seg : norm;
    const shorter = seg.length >= norm.length ? norm : seg;
    return longer.startsWith(shorter) && longer.length - shorter.length >= 2;
  }));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export interface ParsedSectors { sectors: string[]; unmatched: string[] }

// "Separa por |, ;, , ou /. Confronta cada um com a taxonomia do
// SectorPicker; os que não batem ficam com aviso... não descartados"
// (Prompt 753). A token that doesn't match the taxonomy is KEPT as typed
// (never dropped) — the caller surfaces `unmatched` as a warning so the
// investor can fix the spelling or accept the free text as-is.
//
// Prompt AL757 §F — before giving up on a token, tries (1) an exact match
// ignoring accents/case (unchanged, above), (2) a short industry nickname
// ("medtech" -> "MedTech & Medical Devices"), (3) a unique substring match.
// Only once all three miss does it fall through to `unmatched`, where the
// caller (parsePortfolioFields) attaches suggestSector's own closest-match
// guess to the warning.
export function parsePortfolioSectors(raw: string): ParsedSectors {
  const tokens = raw.split(/[|;,/]/).map((s) => s.trim()).filter(Boolean);
  const sectors: string[] = [];
  const unmatched: string[] = [];
  for (const tok of tokens) {
    const norm = normalizeToken(tok);
    const canonical = SECTOR_LOOKUP.get(norm) ?? SECTOR_SHORT_LOOKUP.get(norm) ?? uniqueContainsMatch(tok);
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
  contactPhone?: string;
  status: PortfolioStatus;
}

export type IssueSeverity = 'error' | 'warning';
export interface RowIssue {
  field?: PortfolioImportField;
  message: string;
  severity: IssueSeverity;
  /** Only set on a sectors "doesn't match the taxonomy" warning that has a close-enough suggestion — the UI's one-click "Use «X»" accept button. */
  suggestion?: { token: string; canonical: string };
}
/** @deprecated kept as an alias — `severity` is always present now, nothing else changed shape. */
export type RowError = RowIssue;

export interface ParsedPortfolioRow {
  /**
   * 1-based line number in the ORIGINAL uploaded file (Prompt AL757 §A) —
   * not a sequential count of data rows. A blank line, a title row above
   * the real header, or a stripped blank column never shift this number,
   * so it always points at the same line the investor would find by
   * opening the file themselves.
   */
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
    for (const u of parsed.unmatched) {
      const suggestion = suggestSector(u);
      warnings.push({
        field: 'sectors', severity: 'warning',
        message: suggestion
          ? `Sector "${u}" doesn't match the taxonomy — did you mean "${suggestion}"?`
          : `Sector "${u}" doesn't match the taxonomy — kept as typed.`,
        suggestion: suggestion ? { token: u, canonical: suggestion } : undefined,
      });
    }
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
      err('exit_at', 'Exit date only applies to Past companies — import it from the Past tab (or set status to "past").');
    } else {
      const parsed = parsePortfolioDate(exitAtRaw);
      if (parsed === undefined) err('exit_at', `Could not parse date "${exitAtRaw}".`);
      else {
        exitAt = parsed.iso;
        if (parsed.ambiguous) warn('exit_at', `Read "${exitAtRaw}" as ${formatDateDisplay(parsed.iso)} — check.`);
      }
    }
  } else if (resolvedStatus === 'past') {
    // Prompt AL757 §D — a Past company with no exit date on file is a real,
    // valid state (not every exit is dated, or known yet) — allowed through,
    // same as before, but now flagged rather than silently unremarkable:
    // "deixa passar com aviso ('no exit date')".
    warn('exit_at', 'No exit date on file for this past company.');
  }

  let exitType: string | undefined;
  const exitTypeRaw = get('exit_type');
  if (exitTypeRaw) {
    if (resolvedStatus !== 'past') {
      err('exit_type', 'Exit type only applies to Past companies — import it from the Past tab (or set status to "past").');
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
  // Not validated — "Tel." in Nuno's own file carried an international
  // number with a leading "+"; phone formats vary too much (country code,
  // extensions, local conventions) to validate meaningfully here, same
  // reasoning the prompt itself gave. Only trimmed, same as contact_name.
  const contactPhone = get('contact_phone') || undefined;

  if (!companyName) return { data: null, errors, warnings };

  return {
    data: {
      companyName, website, domain, country, stageAtEntry, sectors, ticketEur, instrument,
      investedAt, exitAt, exitType, contactName, contactEmail, contactPhone, status: resolvedStatus,
    },
    errors, warnings,
  };
}

// Shared by parsePortfolioRows and buildPortfolioImportPlan so there is
// exactly one place that strips blank rows/columns and finds the header —
// never two copies that could disagree on which row is the header.
function resolveHeaderAndMapping(rawRows: string[][], mapping?: ColumnMapping): {
  stripped: string[][]; originalRowNumbers: number[]; headerRowIndex: number; mapping: ColumnMapping;
} {
  const { rows: stripped, originalRowNumbers } = stripEmptyRowsAndColumns(rawRows);
  if (stripped.length === 0) return { stripped: [], originalRowNumbers: [], headerRowIndex: 0, mapping: mapping ?? {} };
  const detection = detectHeaderAndMapping(stripped);
  return { stripped, originalRowNumbers, headerRowIndex: detection.headerRowIndex, mapping: mapping ?? detection.mapping };
}

/**
 * Turns file rows (as produced by parseCsv or parsePortfolioXlsxRows) into
 * validated portfolio-company rows, per-row errors/warnings, and a resolved
 * column mapping. No DB access — duplicate detection against EXISTING rows
 * is a separate step (detectDuplicates), since only the caller (an API
 * route, under RLS) knows what already exists for this firm.
 *
 * Prompt AL757 — `rawRows` no longer has to have its header on row 0: blank
 * rows/columns are stripped first (stripEmptyRowsAndColumns) and the real
 * header is found among the first 10 non-blank rows (detectHeaderAndMapping)
 * whenever `mapping` isn't given explicitly. `opts.defaultStatus` is what a
 * file with NO status column at all falls back to (Prompt AL757 §D — "o
 * separador ativo", wired in by the caller) rather than always 'current';
 * a file that DOES map a status column keeps today's per-cell-blank rule
 * (parsePortfolioStatus's own empty-string -> 'current') untouched.
 */
export function parsePortfolioRows(
  rawRows: string[][],
  mapping?: ColumnMapping,
  opts?: { defaultStatus?: PortfolioStatus },
): ParsedPortfolioRow[] {
  const { stripped, originalRowNumbers, headerRowIndex, mapping: map } = resolveHeaderAndMapping(rawRows, mapping);
  if (stripped.length === 0) return [];

  const dataRows = stripped.slice(headerRowIndex + 1);
  const dataRowNumbers = originalRowNumbers.slice(headerRowIndex + 1);
  const mappedFields = PORTFOLIO_IMPORT_FIELDS.filter((f) => map[f] != null);
  const statusMapped = map.status != null;

  return dataRows.map((r, i) => {
    const fields: Partial<Record<PortfolioImportField, string>> = {};
    const raw: Partial<Record<PortfolioImportField, string>> = {};
    for (const field of mappedFields) {
      const idx = map[field] as number;
      const v = (r[idx] ?? '').trim();
      fields[field] = v;
      raw[field] = v;
    }
    // Synthesized, not shown in `raw` — there is no real cell behind it, so
    // the preview's "original vs. read" display has nothing to show for
    // status on this row, same as any other field the file never had.
    if (!statusMapped && opts?.defaultStatus) fields.status = opts.defaultStatus;
    const { data, errors, warnings } = parsePortfolioFields(fields);
    return { row: dataRowNumbers[i] ?? i + 1, data, errors, warnings, raw };
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
  opts?: { defaultStatus?: PortfolioStatus },
): PortfolioImportPlan {
  const { mapping: map } = resolveHeaderAndMapping(rows, mapping);
  const parsed = parsePortfolioRows(rows, map, opts);
  const dupInput = parsed
    .filter((p): p is ParsedPortfolioRow & { data: PortfolioCompanyRow } => p.data !== null)
    .map((p) => ({ row: p.row, companyName: p.data.companyName, domain: p.data.domain }));
  const dups = detectDuplicates(dupInput, existing);

  const items: PortfolioImportPlanItem[] = parsed.map((p) => {
    const duplicate = dups.get(p.row) ?? null;
    return {
      row: p.row, data: p.data, errors: p.errors, warnings: p.warnings, raw: p.raw, duplicate,
      // Prompt AL757 §E — a WARNING (ambiguous reading, unmatched sector,
      // no exit date, …) no longer opts a row out by default: only an
      // error or a duplicate does. "Import anyway" (Prompt 753 §E) used to
      // exist for both; now that warnings are pre-included, the only case
      // left where it makes a difference is an un-opted duplicate — see
      // this same rule mirrored in PortfolioPanel.tsx's own button.
      include: p.data !== null && p.errors.length === 0 && duplicate === null,
    };
  });
  return { mapping: map, items };
}

// "A faixa diz porquê, linha a linha" (Prompt AL757 §C) — one human reason
// per skipped row.
export function duplicateReasonText(d: DuplicateMatch): string {
  const what = d.reason === 'domain' ? 'same website' : 'same name';
  const where = d.against === 'existing' ? 'as a company already in your portfolio' : 'as another row in this file';
  return `duplicate (${what} ${where})`;
}

export interface ImportCommitBucket {
  candidates: { row: number; data: PortfolioCompanyRow }[];
  skipped: { row: number; reason: string }[];
}

/**
 * The commit route's own bucketing rule, pulled out so it's unit-testable
 * without a live database: every plan item ends up either a candidate for
 * insert or `skipped` with a reason, never silently dropped. An item with
 * an error is excluded regardless of `include` — the checkbox only ever
 * opts a CLEAN row out, never opts a broken one in. `it.duplicate` here is
 * the CLIENT's own (possibly stale) snapshot, used only to word the reason
 * for a row that was never a candidate in the first place; the caller
 * (the commit route) re-checks duplicates against the current database
 * state for the rows THIS function returns as candidates, and must add any
 * newly-detected duplicate to `skipped` itself.
 */
export function bucketImportItems(
  items: { row: number; data: PortfolioCompanyRow | null; errors: RowIssue[]; include: boolean; duplicate: DuplicateMatch | null }[],
): ImportCommitBucket {
  const skipped: { row: number; reason: string }[] = [];
  const candidates: { row: number; data: PortfolioCompanyRow }[] = [];
  for (const it of items) {
    if (it.data === null) { skipped.push({ row: it.row, reason: it.errors[0]?.message ?? 'company name missing' }); continue; }
    if (it.errors.length > 0) { skipped.push({ row: it.row, reason: it.errors[0].message }); continue; }
    if (!it.include) {
      skipped.push({ row: it.row, reason: it.duplicate ? duplicateReasonText(it.duplicate) : 'not selected' });
      continue;
    }
    candidates.push({ row: it.row, data: it.data });
  }
  return { candidates, skipped };
}

// "O separador muda para onde as linhas ficaram" (Prompt AL757 §C/§D) — the
// status most of the rows actually being imported resolved to (a file can
// mix current/past when it HAS a status column; a tie favors current,
// matching this file's own documented default elsewhere).
export function pickImportTargetStatus(items: { include: boolean; data: PortfolioCompanyRow | null }[]): PortfolioStatus {
  let current = 0;
  let past = 0;
  for (const it of items) {
    if (!it.include || !it.data) continue;
    if (it.data.status === 'past') past++; else current++;
  }
  return past > current ? 'past' : 'current';
}

// ---------- XLSX ----------

// Excel's epoch: day 0 is 1899-12-30 (the famous off-by-two "1900 leap year
// bug" baked into the format itself — not ours to fix, just to match).
const XLSX_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

// Prompt AL756 (review of Prompt 753) — this file used to read date cells
// via `cellDates: true`, on the strength of a comment claiming the
// resulting Date was "anchored at UTC midnight". It is not: SheetJS 0.18.5
// builds that Date using the LOCAL time zone of whoever is running the
// parsing code — which, for this feature, is the INVESTOR'S OWN BROWSER
// (PortfolioPanel.tsx calls this client-side). Confirmed two ways before
// writing this fix, not assumed from the bug report alone: (1) the fixture
// committed under Prompt 753 stores the serial as `44634.99947916667` (one
// day MINUS 45 seconds), not a clean integer — itself a symptom of this
// same local-time dependency, at the WRITE side, in the script that
// generated it; (2) reading that fixture with `TZ=UTC` reproduces exactly
// the Nuno-visible bug: `2022-03-15` comes back as `2022-03-14`, which
// means CI (UTC) would have failed every run from here on.
//
// The fix removes `Date` construction from the serial→calendar-date path
// entirely. `cellNF: true` (instead of `cellDates`) asks SheetJS to keep
// each numeric cell's own format string on `cell.z`; `XLSX.SSF.is_date`
// (the same date-format detector SheetJS itself uses internally) decides
// whether that format means "this number is a date". A date cell converts
// by pure day-count arithmetic — `Math.floor` first, since a date-only
// field never needs the sub-day fraction a cell can carry (typically
// floating-point noise from how it was written, as in the Prompt 753
// fixture above) — then a single `Date.UTC(...)` call, whose result is an
// absolute instant independent of the host's time zone by construction;
// `.toISOString()` always reads it back as UTC. No step anywhere in this
// path depends on which time zone is running the code. Verified directly
// against `TZ=UTC`, `Europe/Paris`, `Asia/Tokyo`, `America/Los_Angeles`
// (and the committed CI matrix in portfolio-import.test.ts) before relying
// on it.
//
// A numeric cell whose format is NOT a date (money, a bare year, …) is
// read as a plain number, same as before — `parseTicketAmount`/
// `parsePortfolioDate` handle the string form of either shape already. A
// text cell is read as-is; a date Excel did NOT tag as a date (a bare
// serial pasted in as plain text) still falls through to
// parsePortfolioDate's own Excel-serial fallback on the way in.
function xlsxCellToString(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null) return '';
  if (cell.t === 'n' && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) {
    const days = Math.floor(cell.v as number);
    return new Date(XLSX_EPOCH_UTC_MS + days * 86400000).toISOString().slice(0, 10);
  }
  return String(cell.v);
}

/**
 * Reads a workbook's first sheet into the same string[][] shape parseCsv
 * produces. Prompt 753 §C — `raw: false` (Phase 1's own setting) asks
 * SheetJS to TEXT-FORMAT every cell, and its date formatting does not
 * reliably follow the cell's own custom number-format string (confirmed:
 * a cell explicitly formatted dd/mm/yyyy still came back month-first).
 * Prompt AL756 — `cellDates: true` (Prompt 753's own fix for that) turned
 * out to have the SAME class of problem one level deeper: see
 * xlsxCellToString's own header for the full account. `cellNF: true` plus
 * manual cell-by-cell arithmetic (this function walks `!ref`'s range
 * directly rather than `sheet_to_json`, which under `cellNF` would hand
 * back formatted display text, not the raw value this needs) replaces it.
 */
export function parsePortfolioXlsxRows(data: ArrayBuffer): string[][] {
  const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellNF: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const ref = sheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      row.push(xlsxCellToString(sheet[XLSX.utils.encode_cell({ r, c })]));
    }
    rows.push(row);
  }
  return rows;
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
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
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
  // Prompt AL756 — this used to be `body.status === 'past' ? 'past' :
  // 'current'`: harmless for the UI's own <select> (only ever sends one of
  // the two literal values), but a real gap for the PATCH route, which any
  // client can call directly — a typo'd or malicious status silently
  // became 'current' with no error at all, the exact failure class Prompt
  // 753 was built to close everywhere else. Missing entirely still
  // defaults to 'current' (same as before); PRESENT and not one of the two
  // real values is now a 400, never a silent substitution.
  if (body.status !== undefined && body.status !== 'current' && body.status !== 'past') {
    return { error: `Unrecognized status "${body.status}" — expected "current" or "past".` };
  }
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
      contact_phone: typeof body.contactPhone === 'string' && body.contactPhone.trim() ? body.contactPhone.trim() : null,
    },
  };
}

// ============================================================================
// Prompt AL759 — the import screen should not read like a 14-field form, and
// the preview should not make an investor read 50 lines. Pure helpers; the
// components (PortfolioPanel's ImportFlow, ImportPreview) just draw them.
// ============================================================================

// ---------- §A: only the mapping fields that make sense for the destination ----------

export type ImportDestination = PortfolioStatus;
const EXIT_FIELDS = ['exit_at', 'exit_type'] as const;

/**
 * Which mapping dropdowns to show. A file WITH a status column mapped can mix
 * Current and Past, so everything shows. Without one, the destination is the
 * status: Past shows the exit fields; Current hides exit_at, exit_type and
 * status (nothing to map status to — the tab IS the status).
 */
export function visibleMappingFields(mapping: ColumnMapping, destination: ImportDestination): PortfolioImportField[] {
  if (mapping.status != null || destination === 'past') return [...PORTFOLIO_IMPORT_FIELDS];
  return PORTFOLIO_IMPORT_FIELDS.filter((f) => f !== 'status' && f !== 'exit_at' && f !== 'exit_type');
}

/**
 * The mapping the plan is actually built from. Importing into Current with no
 * status column drops exit_at/exit_type — and says so (droppedExitNotice) —
 * instead of turning every row into an error: the investor chose the
 * destination, the file's exit columns simply don't apply to it.
 */
export function effectiveMappingForDestination(mapping: ColumnMapping, destination: ImportDestination): {
  mapping: ColumnMapping; droppedExitFields: (typeof EXIT_FIELDS[number])[];
} {
  if (mapping.status != null || destination === 'past') return { mapping, droppedExitFields: [] };
  const next: ColumnMapping = { ...mapping };
  const dropped: (typeof EXIT_FIELDS[number])[] = [];
  for (const f of EXIT_FIELDS) if (next[f] != null) { dropped.push(f); delete next[f]; }
  return { mapping: next, droppedExitFields: dropped };
}

export function droppedExitNotice(dropped: (typeof EXIT_FIELDS[number])[]): string | null {
  if (dropped.length === 0) return null;
  const names = dropped.map((f) => (f === 'exit_at' ? 'Exit date' : 'Exit type')).join(' / ');
  return `${names} found in the file but not imported: these apply to Past companies only. Import into Past, or move them later.`;
}

/** Collapsed by default when there is nothing to decide: the company name was found and nothing was guessed. */
export function shouldCollapseMapping(mapping: ColumnMapping, guessedFields: PortfolioImportField[]): boolean {
  return mapping.company_name != null && guessedFields.length === 0;
}

/** "7 columns matched · 2 not imported: Notes, Owner" — a column left out (including a dropped exit column) is named, never silent. */
export function mappingSummary(headerRow: string[], effectiveMapping: ColumnMapping): { matched: number; notImported: string[]; text: string } {
  const mapped = new Set(Object.values(effectiveMapping));
  const notImported = headerRow
    .map((h, i) => ({ i, label: h.trim() || `column ${i + 1}` }))
    .filter(({ i }) => !mapped.has(i))
    .map(({ label }) => label);
  const matched = mapped.size;
  let text = `${matched} column${matched === 1 ? '' : 's'} matched`;
  if (notImported.length > 0) text += ` · ${notImported.length} not imported: ${notImported.join(', ')}`;
  return { matched, notImported, text };
}

// ---------- §B: preview that scales ----------

export type RowClass = 'ready' | 'warning' | 'duplicate' | 'error';

/** One class per row, worst first: an error beats a duplicate beats a warning. */
export function classifyItem(it: { data: PortfolioCompanyRow | null; errors: RowIssue[]; warnings: RowIssue[]; duplicate: DuplicateMatch | null }): RowClass {
  if (it.data === null || it.errors.length > 0) return 'error';
  if (it.duplicate) return 'duplicate';
  if (it.warnings.length > 0) return 'warning';
  return 'ready';
}

export interface PlanSummary { ready: number; withWarnings: number; duplicates: number; errors: number; total: number; included: number }

export function summarizePlan(items: PortfolioImportPlanItem[]): PlanSummary {
  const s: PlanSummary = { ready: 0, withWarnings: 0, duplicates: 0, errors: 0, total: items.length, included: 0 };
  for (const it of items) {
    const c = classifyItem(it);
    if (c === 'ready') s.ready++; else if (c === 'warning') s.withWarnings++; else if (c === 'duplicate') s.duplicates++; else s.errors++;
    if (it.include) s.included++;
  }
  return s;
}

/** "48 ready · 2 with warnings · 1 duplicate · 1 error" — zero parts are left out. */
export function planSummaryText(s: PlanSummary): string {
  const parts = [`${s.ready} ready`];
  if (s.withWarnings) parts.push(`${s.withWarnings} with ${s.withWarnings === 1 ? 'warning' : 'warnings'}`);
  if (s.duplicates) parts.push(`${s.duplicates} ${s.duplicates === 1 ? 'duplicate' : 'duplicates'}`);
  if (s.errors) parts.push(`${s.errors} ${s.errors === 1 ? 'error' : 'errors'}`);
  return parts.join(' · ');
}

export const ATTENTION_PREVIEW_LIMIT = 10;
export const SAMPLE_SIZE = 5;

/** The rows that get an individual card: anything that is not plainly ready. */
export function attentionItems(items: PortfolioImportPlanItem[]): PortfolioImportPlanItem[] {
  return items.filter((it) => classifyItem(it) !== 'ready');
}

/** The first N rows with usable data, as they will be saved — what the compact sample table shows. */
export function sampleItems(items: PortfolioImportPlanItem[], n: number = SAMPLE_SIZE): PortfolioImportPlanItem[] {
  return items.filter((it) => it.data !== null && it.errors.length === 0).slice(0, n);
}

/** Bulk include/exclude for one class of row; errors are never touched (they can never be included). */
export function setIncludeForClass(items: PortfolioImportPlanItem[], cls: 'duplicate' | 'warning', include: boolean): PortfolioImportPlanItem[] {
  return items.map((it) => (classifyItem(it) === cls && it.data !== null && it.errors.length === 0 ? { ...it, include } : it));
}

/**
 * A date read from a day <= 12 text that is not ISO could just as well have
 * been month-first to a human, even though this parser never reads it that
 * way — those are the rows that keep a "read as" line (Prompt AL756/AL759).
 */
export function isAmbiguousDayDate(raw: string | undefined, iso: string | undefined): boolean {
  if (!raw || !iso) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return false;
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return day <= 12 && day !== month;
}

/** Whether a row still gets its "read as" line: it has a warning, or a human-ambiguous date. */
export function needsReadAs(it: PortfolioImportPlanItem): boolean {
  return it.warnings.length > 0
    || isAmbiguousDayDate(it.raw.invested_at, it.data?.investedAt)
    || isAmbiguousDayDate(it.raw.exit_at, it.data?.exitAt);
}

/**
 * "Download rows with errors" — the original rows from the file (not the
 * parsed ones) plus an `error` column, so the investor can fix them in Excel
 * and re-import without hunting for the lines. Row numbers on a plan item are
 * the original file line numbers, which is what indexes `fileRows`.
 */
export function errorRowsCsv(args: {
  fileRows: string[][]; headerRowNumber: number;
  items: { row: number; data: PortfolioCompanyRow | null; errors: RowIssue[] }[];
}): string {
  const { fileRows, headerRowNumber, items } = args;
  const header = fileRows[headerRowNumber - 1] ?? [];
  const lines = [[...header, 'error'].map(csvCell).join(',')];
  for (const it of items) {
    if (it.data !== null && it.errors.length === 0) continue;
    const original = fileRows[it.row - 1] ?? [];
    const message = it.errors.map((e) => e.message).join(' | ');
    lines.push([...original, message].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** An import row shaped like a saved company, so the compact sample can draw it with the real table's cell formatting. */
export function rowToDisplayCompany(data: PortfolioCompanyRow, id: string): PortfolioCompany {
  return {
    id, status: data.status, company_name: data.companyName, website: data.website ?? null, domain: data.domain,
    country: data.country ?? null, stage_at_entry: data.stageAtEntry ?? null, sectors: data.sectors,
    ticket_eur: data.ticketEur ?? null, instrument: data.instrument ?? null, invested_at: data.investedAt ?? null,
    exit_at: data.exitAt ?? null, exit_type: data.exitType ?? null, contact_name: data.contactName ?? null,
    contact_email: data.contactEmail ?? null, contact_phone: data.contactPhone ?? null, source: 'import', created_at: '',
  };
}
