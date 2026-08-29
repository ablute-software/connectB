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

  return {
    documentType: typeof r.document_type === 'string' ? r.document_type : null,
    namedEntities, programs, dates, amounts,
    documentReference: typeof r.document_reference === 'string' ? r.document_reference : null,
    isSigned: typeof r.is_signed === 'boolean' ? r.is_signed : null,
    pitchProblem: pitchField(r.pitch_problem),
    pitchSolution: pitchField(r.pitch_solution),
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
