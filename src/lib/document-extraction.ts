// Prompt 313 §A — the closed list of what gets extracted from a Vault PDF,
// and the pure mapping from Claude's tool-forced output into it. Deliberately
// narrow, per the prompt's own instruction: short, verifiable facts with a
// page reference each — never a free-form summary. Pure and mechanical on
// purpose, same discipline as company-claims.ts: the SHAPE of what's kept is
// fixed here, not decided ad hoc by whatever the model happens to return.
import { truncateAtWord } from './text-truncate';
import { INTRO_PITCH_MAX } from './investor-interest-level';

export type NamedEntityKind = 'person' | 'company' | 'organization';

export interface ExtractedNamedEntity { name: string; kind: NamedEntityKind; page: number | null }
export interface ExtractedProgram { name: string; page: number | null }
export interface ExtractedDate { label: string; date: string; page: number | null }
export interface ExtractedAmount { amount: number; currency: string; label: string | null; page: number | null }

// Prompt 541 §A — the round facts, when (and only when) the document is the
// company's own fundraising material. One object rather than nine flat
// fields: "this document said nothing about the round" is then a single
// null, not nine independent absences to reason about at every call site.
// Every field carries its own page reference, same as the closed facts
// above — a founder deciding whether to trust a number needs to be able to
// go and look at it.
export interface ExtractedRoundValue<T> { value: T; page: number | null }

export interface ExtractedRoundFacts {
  targetEur?: ExtractedRoundValue<number>;
  // Already mapped onto the app's own round_instruments enum values by
  // roundInstrumentValue below — never the model's free text.
  instruments?: ExtractedRoundValue<string[]>;
  valuationEur?: ExtractedRoundValue<number>;
  valuationBasis?: ExtractedRoundValue<'pre_money' | 'post_money'>;
  runwayMonths?: ExtractedRoundValue<number>;
  runwayPostMonths?: ExtractedRoundValue<number>;
  targetCloseDate?: ExtractedRoundValue<string>;
  useOfFunds?: ExtractedRoundValue<string>;
  minTicketEur?: ExtractedRoundValue<number>;
}

// Prompt 542 §3 — a FUTURE target the document states, as distinct from
// every other field in this file, which records something already true.
// The three parts are all required: a metric with no number, or a number
// with no date, is not a projection anyone can put on a roadmap — it is a
// sentence. Dropping it is correct; guessing the missing part is exactly
// the failure this whole module is written against.
//
// `targetValue` stays a STRING, deliberately, and this is the one place it
// is worth arguing for: documents say "1,000 users", "EUR 50K MRR",
// "break-even". Parsing that into a number here would mean inventing a
// unit, a currency, or a scale the document did not state, and the value's
// only consumer today is the text of a proposed roadmap milestone. The
// deferred "did they hit it?" feature (which the prompt explicitly leaves
// for later) is what will need a number, and it should parse it then, with
// the founder able to correct it — not have this step guess now.
export interface ExtractedProjection {
  metric: string;
  targetValue: string;
  targetDate: string; // ISO YYYY-MM-DD
  // Roadmap's own vocabulary (roadmap_events.date_precision), so a
  // projection can become an event without a second translation step.
  datePrecision: 'exact' | 'approx' | 'quarter';
  page: number | null;
}

export interface DocumentExtractionData {
  documentType: string | null;
  namedEntities: ExtractedNamedEntity[];
  programs: ExtractedProgram[];
  dates: ExtractedDate[];
  amounts: ExtractedAmount[];
  documentReference: string | null;
  isSigned: boolean | null;
  // Prompt 459 §B — ONLY set when this document is the company's own pitch
  // material and states its problem/solution in its own words; null for
  // every other document type (grant agreements, certificates, ...), never
  // inferred from context.
  pitchProblem: string | null;
  pitchSolution: string | null;
  // Prompt 541 §A — null for every document that isn't fundraising material,
  // and for fundraising material that simply doesn't state any of it.
  round: ExtractedRoundFacts | null;
  // Prompt 542 §3 — empty for every document that states no explicit
  // forward-looking target, which is most of them.
  projections: ExtractedProjection[];
  // How much of the source PDF this extraction actually saw — set from the
  // truncation step (pdf-truncate.ts), never from the model's own say-so.
  pagesRead: number;
  totalPages: number;
  partial: boolean;
}

// The API accepts far more (up to ~100 pages for a 200k-context model per
// Anthropic's docs, not enforced or even checked anywhere in this codebase
// today), but a grant/contract's essentials live in the preamble — the real
// case this prompt exists for (a 125-page Grant Agreement) only needs its
// first pages read to answer "is this signed, who's named, what program".
export const MAX_EXTRACTION_PAGES = 30;

// Prompt 313, hardened after adversarial review: gap-assist/route.ts's own
// MAX_PDF_BYTES (8MB) is sized for CVs specifically; a real legal/grant PDF
// (the motivating case here is 125 pages) can reasonably be larger, but
// nothing bounded this path at all before — an oversized "clean" file would
// still pay for a full pdf-lib parse and an oversized Anthropic request.
// Checked on the RAW download, before truncation: truncation only bounds
// PAGE COUNT, not bytes (an image-heavy page stays large), so it can't be
// relied on to keep the request under Anthropic's own ~32MB base64 ceiling.
//
// Prompt 462 — moved here (from document-extraction-pipeline.ts) so
// document-link-snapshot.ts can import the same cap without creating a
// circular dependency: the pipeline calls INTO document-link-snapshot.ts
// (prepareDocumentForAi -> ensureLinkSnapshot), so document-link-snapshot.ts
// can never import back from the pipeline file. This module is the shared,
// dependency-free home both sides can pull from.
export const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;

// Anthropic tool_use input_schema — plain JSON Schema, no nullable-type
// unions (no precedent for that in this codebase's other tool schemas).
// Optional fields are simply left out of `required`; rawExtractionToData
// below treats their absence as null/empty rather than trusting the model
// to have included every key.
export const EXTRACTION_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    document_type: {
      type: 'string',
      description: 'A short label for what kind of document this is (e.g. "grant agreement", "invoice", "certificate", "term sheet").',
    },
    named_entities: {
      type: 'array',
      description: 'People, companies, or organizations explicitly named in the document.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['person', 'company', 'organization'] },
          page: { type: 'integer', description: 'Page number where this name appears, if known.' },
        },
        required: ['name', 'kind'],
      },
    },
    programs: {
      type: 'array',
      description: 'Named awards, prizes, grant programs, or certifications this document is about or references (e.g. "WomenTechEU", "ANI seal").',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, page: { type: 'integer' } },
        required: ['name'],
      },
    },
    dates: {
      type: 'array',
      description: 'Relevant dates in the document (signing date, deadline, period covered).',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, date: { type: 'string' }, page: { type: 'integer' } },
        required: ['label', 'date'],
      },
    },
    amounts: {
      type: 'array',
      description: 'Monetary amounts mentioned, with currency.',
      items: {
        type: 'object',
        properties: {
          amount: { type: 'number' }, currency: { type: 'string' },
          label: { type: 'string', description: 'What this amount is for.' },
          page: { type: 'integer' },
        },
        required: ['amount', 'currency'],
      },
    },
    document_reference: { type: 'string', description: 'The document\'s own number/reference/project code, if it has one.' },
    is_signed: { type: 'boolean', description: 'Whether the document appears to be signed (a signature, stamp, or signature block filled in).' },
    // Prompt 459 §B — optional, never in `required`: most documents this
    // pipeline reads (grants, certificates, contracts) aren't pitch
    // material and have no problem/solution statement to report at all.
    pitch_problem: {
      type: 'string',
      description: 'ONLY if this document is the company\'s own pitch material (deck, one-pager, executive summary) and it states, in the company\'s own words, what problem it solves — a short direct statement, under ~240 characters. Omit entirely if this is not pitch material, or if the problem is not clearly and explicitly stated. Never infer or invent it.',
    },
    pitch_solution: {
      type: 'string',
      description: 'ONLY if this document is the company\'s own pitch material and it states what the company\'s solution/product is, in its own words — under ~240 characters. Same rule as pitch_problem: omit if not clearly stated, never infer.',
    },
    // Prompt 541 §A — the round terms, when this document actually states
    // them. Optional and never in `required`, same as pitch_problem above:
    // most documents this pipeline reads have nothing to say here. The
    // "only if" wording is doing real work — it is what stops the model
    // pattern-completing a plausible round out of an unrelated PDF (the
    // exact failure the Faber linkedin_url incident taught us to design
    // against), and rawExtractionToData below still drops the whole block
    // if the document type turns out to be incompatible.
    round: {
      type: 'object',
      description: 'ONLY if this document is the company\'s own fundraising material (pitch deck, term sheet, one-pager, investment/round summary, investor teaser) AND it explicitly states the terms below. Include only the sub-fields the document actually states — omit the rest, and omit this object entirely for any other kind of document. Never infer, never carry a number over from an example or a comparable company.',
      properties: {
        target_eur: {
          type: 'object', required: ['value'],
          properties: { value: { type: 'number', description: 'Amount being raised, in EUR. Convert only if the document itself states the EUR figure.' }, page: { type: 'integer' } },
        },
        instruments: {
          type: 'object', required: ['value'],
          properties: {
            value: { type: 'array', items: { type: 'string' }, description: 'The instrument(s) named: equity, SAFE, convertible note, venture debt, grant, revenue-based, or other.' },
            page: { type: 'integer' },
          },
        },
        valuation_eur: {
          type: 'object', required: ['value'],
          properties: { value: { type: 'number', description: 'Valuation or cap in EUR.' }, page: { type: 'integer' } },
        },
        valuation_basis: {
          type: 'object', required: ['value'],
          properties: { value: { type: 'string', enum: ['pre_money', 'post_money'], description: 'Only if the document says which basis the valuation is on.' }, page: { type: 'integer' } },
        },
        runway_months: {
          type: 'object', required: ['value'],
          properties: { value: { type: 'number', description: 'Current runway in months.' }, page: { type: 'integer' } },
        },
        runway_post_months: {
          type: 'object', required: ['value'],
          properties: { value: { type: 'number', description: 'Runway in months AFTER the round closes.' }, page: { type: 'integer' } },
        },
        target_close_date: {
          type: 'object', required: ['value'],
          properties: { value: { type: 'string', description: 'Target closing date, as YYYY-MM-DD.' }, page: { type: 'integer' } },
        },
        use_of_funds: {
          type: 'object', required: ['value'],
          properties: { value: { type: 'string', description: 'What the money is for, in the document\'s own words, under ~600 characters.' }, page: { type: 'integer' } },
        },
        min_ticket_eur: {
          type: 'object', required: ['value'],
          properties: { value: { type: 'number', description: 'Minimum ticket / minimum investment per investor, in EUR.' }, page: { type: 'integer' } },
        },
      },
    },
    // Prompt 542 §3 — forward-looking targets the document actually states.
    // Optional, never in `required`. The wording carries the whole
    // guardrail: all three parts must come from the document, and a
    // document with no explicit projection returns an empty list rather
    // than a plausible-looking one.
    projections: {
      type: 'array',
      description: 'Explicit FUTURE targets the document states — projected growth, planned milestones, forecast figures (e.g. "1,000 users by Q2 2027", "EUR 50K MRR by end of 2026"). Only include one when the document states ALL THREE of: what is being measured, the target value, and the date it is targeted for. Omit anything the document merely mentions without a target or without a date. Never infer a projection from a trend, never extrapolate, never carry a figure over from a comparable company or an illustrative example. An empty list is the right answer for most documents.',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string', description: 'What is being projected, in the document\'s own words — e.g. "new users", "MRR", "paying customers", "pilot hospitals".' },
          target_value: { type: 'string', description: 'The target figure exactly as the document states it, including any unit or currency — e.g. "1,000", "EUR 50K", "12".' },
          target_date: { type: 'string', description: 'The date it is targeted for, as YYYY-MM-DD. For a quarter, use the first day of that quarter; for a year alone, use January 1st.' },
          date_precision: { type: 'string', enum: ['exact', 'approx', 'quarter'], description: '"exact" if the document gives a specific date, "quarter" if it gives a quarter, "approx" if only a year.' },
          page: { type: 'integer' },
        },
        required: ['metric', 'target_value', 'target_date'],
      },
    },
    // Prompt 355 §C — same pass, a second output: a plain-language summary
    // for whoever is EVALUATING this document (an investor), not the
    // structured facts above. Kept in the SAME tool call (one download/
    // truncate/Claude call, two outputs) rather than a second request —
    // parsed separately (rawExtractionToSummary below) and written to its
    // own table (document_summaries), never mixed into DocumentExtractionData
    // itself, which stays deliberately narrow (see this file's own header).
    summary: {
      type: 'string',
      description: 'An honest, plain-language summary of what this document actually says, in about 6 sentences — never inventing anything not in the text.',
    },
    highlights: {
      type: 'array', items: { type: 'string' },
      description: '2-3 short highlight bullets — the most notable concrete facts from the document.',
    },
  },
  required: ['document_type', 'named_entities', 'programs', 'dates', 'amounts', 'summary', 'highlights'],
};

interface RawNamedEntity { name?: unknown; kind?: unknown; page?: unknown }
interface RawProgram { name?: unknown; page?: unknown }
interface RawDate { label?: unknown; date?: unknown; page?: unknown }
interface RawAmount { amount?: unknown; currency?: unknown; label?: unknown; page?: unknown }
interface RawExtraction {
  document_type?: unknown;
  named_entities?: unknown;
  programs?: unknown;
  dates?: unknown;
  amounts?: unknown;
  document_reference?: unknown;
  is_signed?: unknown;
  pitch_problem?: unknown;
  pitch_solution?: unknown;
  round?: unknown;
  projections?: unknown;
}

function pageOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Prompt 459 §B — a non-empty string is trusted (the tool schema's own
// description already tells the model when to omit it); truncated the same
// way a founder-facing suggestion built from it will be, so what's stored
// is never longer than what could ever actually be shown.
function pitchField(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed ? (truncateAtWord(trimmed, INTRO_PITCH_MAX) ?? null) : null;
}

// Prompt 541 §A — the deterministic half of "only from fundraising
// material". The tool-schema description above is the first gate (it tells
// the model when to omit the block); this is the second, and it is the one
// that can be tested. Deliberately an ALLOW-list, not a block-list: a grant
// agreement or an invoice can easily contain a big EUR figure and a date,
// and the cost asymmetry is stark — a dropped suggestion is a founder
// typing a number they already knew, while a wrong one is a wrong number
// offered for their round with a document's authority behind it.
//
// The trade-off this accepts, stated rather than hidden: a genuinely
// fundraising document whose model-assigned `document_type` uses none of
// these words loses its round facts silently. That is why the list covers
// the labels the schema itself suggests to the model ("term sheet",
// "pitch deck", …) plus the obvious near-misses, and why a null/absent
// document_type is allowed through — unknown is not the same as wrong.
const ROUND_COMPATIBLE_TYPE_WORDS = [
  'pitch', 'deck', 'term sheet', 'termsheet', 'one-pager', 'one pager', 'onepager',
  'round', 'fundrais', 'investment summary', 'investor', 'executive summary', 'teaser',
  'safe', 'convertible note', 'subscription agreement', 'shareholders agreement',
  'investment memorandum', 'information memorandum', 'memorandum',
];

export function isRoundCompatibleDocumentType(documentType: string | null): boolean {
  if (documentType == null) return true;
  const t = documentType.toLowerCase();
  if (!t.trim()) return true;
  return ROUND_COMPATIBLE_TYPE_WORDS.some((w) => t.includes(w));
}

// The app's own round_instruments enum (RoundCard's INSTRUMENTS list). The
// model is asked for names, not codes, so this is where free text becomes a
// value the UI can actually check a box for — anything unrecognised maps to
// 'other' rather than being dropped, since "the document names an
// instrument we don't model" is still information worth carrying.
const INSTRUMENT_ALIASES: [RegExp, string][] = [
  [/\bsafe\b|simple agreement for future equity/i, 'safe'],
  [/convertible/i, 'convertible_note'],
  [/venture debt|\bdebt\b|\bloan\b/i, 'venture_debt'],
  [/grant|subsid/i, 'grant'],
  [/revenue[- ]based|\brbf\b/i, 'revenue_based'],
  [/equity|\bshares?\b|ordinary|preferred/i, 'equity'],
];

export function roundInstrumentValue(raw: string): string {
  for (const [re, value] of INSTRUMENT_ALIASES) if (re.test(raw)) return value;
  return 'other';
}

const USE_OF_FUNDS_MAX = 600;

// Shared by the round close date and the projection target date: both are
// written into real `date` columns, so anything that is not a plain ISO
// date is dropped here rather than handed to Postgres to reject on save.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RawRoundValue { value?: unknown; page?: unknown }

function roundNumber(v: unknown): ExtractedRoundValue<number> | undefined {
  const r = (v && typeof v === 'object' ? v : {}) as RawRoundValue;
  // Rejects 0 and negatives as well as non-numbers: a round target of zero
  // is never a real extracted fact, it is a model filling in a blank.
  if (typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value <= 0) return undefined;
  return { value: r.value, page: pageOf(r.page) };
}

function roundString(v: unknown, max: number): ExtractedRoundValue<string> | undefined {
  const r = (v && typeof v === 'object' ? v : {}) as RawRoundValue;
  if (typeof r.value !== 'string' || !r.value.trim()) return undefined;
  return { value: r.value.trim().slice(0, max), page: pageOf(r.page) };
}

function roundDate(v: unknown): ExtractedRoundValue<string> | undefined {
  const r = (v && typeof v === 'object' ? v : {}) as RawRoundValue;
  if (typeof r.value !== 'string') return undefined;
  // The column is a date; anything that isn't an ISO date is dropped rather
  // than handed to Postgres to reject at save time.
  if (!ISO_DATE_RE.test(r.value.trim())) return undefined;
  return { value: r.value.trim(), page: pageOf(r.page) };
}

const PROJECTION_METRIC_MAX = 120;
const PROJECTION_VALUE_MAX = 60;

interface RawProjection { metric?: unknown; target_value?: unknown; target_date?: unknown; date_precision?: unknown; page?: unknown }

// All three parts or nothing — see ExtractedProjection's own comment. Also
// bounded: 12 projections is already more than any real deck states, and an
// unbounded list from a malformed response has no business reaching the
// roadmap suggestion prompt.
const MAX_PROJECTIONS = 12;

export function rawExtractionToProjections(raw: unknown): ExtractedProjection[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedProjection[] = [];
  for (const item of raw as RawProjection[]) {
    if (!item || typeof item !== 'object') continue;
    const metric = typeof item.metric === 'string' ? item.metric.trim() : '';
    const targetValue = typeof item.target_value === 'string' ? item.target_value.trim() : '';
    const targetDate = typeof item.target_date === 'string' ? item.target_date.trim() : '';
    if (!metric || !targetValue) continue;
    if (!ISO_DATE_RE.test(targetDate)) continue;
    const precision = item.date_precision;
    out.push({
      metric: metric.slice(0, PROJECTION_METRIC_MAX),
      targetValue: targetValue.slice(0, PROJECTION_VALUE_MAX),
      targetDate,
      datePrecision: precision === 'exact' || precision === 'quarter' ? precision : 'approx',
      page: pageOf(item.page),
    });
    if (out.length >= MAX_PROJECTIONS) break;
  }
  return out;
}

export function rawExtractionToRound(raw: unknown, documentType: string | null): ExtractedRoundFacts | null {
  if (!isRoundCompatibleDocumentType(documentType)) return null;
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!r) return null;

  const facts: ExtractedRoundFacts = {};
  const targetEur = roundNumber(r.target_eur);
  if (targetEur) facts.targetEur = targetEur;
  const valuationEur = roundNumber(r.valuation_eur);
  if (valuationEur) facts.valuationEur = valuationEur;
  const runwayMonths = roundNumber(r.runway_months);
  if (runwayMonths) facts.runwayMonths = runwayMonths;
  const runwayPostMonths = roundNumber(r.runway_post_months);
  if (runwayPostMonths) facts.runwayPostMonths = runwayPostMonths;
  const minTicketEur = roundNumber(r.min_ticket_eur);
  if (minTicketEur) facts.minTicketEur = minTicketEur;

  const targetCloseDate = roundDate(r.target_close_date);
  if (targetCloseDate) facts.targetCloseDate = targetCloseDate;
  const useOfFunds = roundString(r.use_of_funds, USE_OF_FUNDS_MAX);
  if (useOfFunds) facts.useOfFunds = useOfFunds;

  const basis = (r.valuation_basis && typeof r.valuation_basis === 'object' ? r.valuation_basis : {}) as RawRoundValue;
  if (basis.value === 'pre_money' || basis.value === 'post_money') {
    facts.valuationBasis = { value: basis.value, page: pageOf(basis.page) };
  }

  const instr = (r.instruments && typeof r.instruments === 'object' ? r.instruments : {}) as RawRoundValue;
  if (Array.isArray(instr.value)) {
    const mapped = Array.from(new Set(
      (instr.value as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()).map(roundInstrumentValue),
    ));
    if (mapped.length) facts.instruments = { value: mapped, page: pageOf(instr.page) };
  }

  return Object.keys(facts).length ? facts : null;
}

// Never trusts the model to have honored the schema exactly — same defensive
// posture as providerErrorMessage's own JSON.parse fallback elsewhere in
// this codebase. tool_choice forcing the shape reduces but doesn't
// eliminate the chance of a missing/malformed field.
export function rawExtractionToData(raw: unknown, pagesRead: number, totalPages: number): DocumentExtractionData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as RawExtraction;

  const namedEntities: ExtractedNamedEntity[] = Array.isArray(r.named_entities)
    ? (r.named_entities as RawNamedEntity[])
      .filter((e) => e && typeof e.name === 'string' && (e.kind === 'person' || e.kind === 'company' || e.kind === 'organization'))
      .map((e) => ({ name: e.name as string, kind: e.kind as NamedEntityKind, page: pageOf(e.page) }))
    : [];

  const programs: ExtractedProgram[] = Array.isArray(r.programs)
    ? (r.programs as RawProgram[])
      .filter((p) => p && typeof p.name === 'string')
      .map((p) => ({ name: p.name as string, page: pageOf(p.page) }))
    : [];

  const dates: ExtractedDate[] = Array.isArray(r.dates)
    ? (r.dates as RawDate[])
      .filter((d) => d && typeof d.label === 'string' && typeof d.date === 'string')
      .map((d) => ({ label: d.label as string, date: d.date as string, page: pageOf(d.page) }))
    : [];

  const amounts: ExtractedAmount[] = Array.isArray(r.amounts)
    ? (r.amounts as RawAmount[])
      .filter((a) => a && typeof a.amount === 'number' && typeof a.currency === 'string')
      .map((a) => ({ amount: a.amount as number, currency: a.currency as string, label: typeof a.label === 'string' ? a.label : null, page: pageOf(a.page) }))
    : [];

  const documentType = typeof r.document_type === 'string' ? r.document_type : null;

  return {
    documentType,
    namedEntities, programs, dates, amounts,
    documentReference: typeof r.document_reference === 'string' ? r.document_reference : null,
    isSigned: typeof r.is_signed === 'boolean' ? r.is_signed : null,
    pitchProblem: pitchField(r.pitch_problem),
    pitchSolution: pitchField(r.pitch_solution),
    round: rawExtractionToRound(r.round, documentType),
    projections: rawExtractionToProjections(r.projections),
    pagesRead, totalPages, partial: pagesRead < totalPages,
  };
}

// Prompt 355 §B/C — the summary half of the SAME raw tool-call response
// rawExtractionToData parses above. Kept as its own pure function (never
// folded into DocumentExtractionData) so the founder-only extraction record
// and the investor-facing summary stay two genuinely separate values from
// the moment the response is parsed, not just two separate tables fed from
// one blob. Caps mirror company-media.ts's own caption cap discipline —
// generous, not unbounded.
export interface ExtractedSummary { summary: string | null; highlights: string[] }

// Prompt 355 §C — a LIGHTER tool schema for the summary-only call path
// (a document that already has a claims extraction for this exact content,
// just never got a summary): only ever needs summary+highlights, never
// re-pays for or re-derives the full claims-extraction shape above.
export const SUMMARY_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'An honest, plain-language summary of what this document actually says, in about 6 sentences — never inventing anything not in the text.',
    },
    highlights: {
      type: 'array', items: { type: 'string' },
      description: '2-3 short highlight bullets — the most notable concrete facts from the document.',
    },
  },
  required: ['summary', 'highlights'],
};
const SUMMARY_MAX_LEN = 2000;
const HIGHLIGHT_MAX_LEN = 300;
const MAX_HIGHLIGHTS = 3;

export function rawExtractionToSummary(raw: unknown): ExtractedSummary {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { summary?: unknown; highlights?: unknown };
  const summary = typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim().slice(0, SUMMARY_MAX_LEN) : null;
  const highlights = Array.isArray(r.highlights)
    ? r.highlights.filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
      .slice(0, MAX_HIGHLIGHTS).map((h) => h.trim().slice(0, HIGHLIGHT_MAX_LEN))
    : [];
  return { summary, highlights };
}

// The comparison pool company-claims.ts's findDocumentLinkCandidate and
// proposeClaimFromDocumentFact both match against — programs AND named
// entities, since a real award statement usually names either the program
// ("WomenTechEU") or the person ("Carla Dias"), or both, and either can be
// the side that matches a claim's own extracted name.
export interface DocumentFact { documentId: string; documentName: string; page: number | null; label: string }

export function extractionToFacts(extraction: DocumentExtractionData, documentId: string, documentName: string): DocumentFact[] {
  return [
    ...extraction.programs.map((p) => ({ documentId, documentName, page: p.page, label: p.name })),
    ...extraction.namedEntities.map((e) => ({ documentId, documentName, page: e.page, label: e.name })),
  ];
}

// Only `programs` are decoration-type facts eligible to become a brand new
// proposed claim (Prompt 313's own "não fazer" guardrail) — a bare named
// entity with no associated award is never, on its own, a claim worth
// proposing.
export function programFacts(extraction: DocumentExtractionData, documentId: string, documentName: string): DocumentFact[] {
  return extraction.programs.map((p) => ({ documentId, documentName, page: p.page, label: p.name }));
}
