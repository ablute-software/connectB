// Prompt 541 §B — the pure half of /api/company/round-suggestion: given an
// org's saved Round values, its provenance record, and its Vault
// extractions, produce the per-field material the UI's precedence rule
// needs. No I/O, so the route stays a thin fetch-and-serialise wrapper and
// this — the part with the actual decisions in it — is testable.
import type { ExtractedRoundFacts } from './document-extraction';
import { ROUND_SOURCE_FIELDS, type RoundFieldsSource, type RoundFieldValue, type RoundSourceField } from './round-field-precedence';

export interface RoundExtractionRow {
  extracted: { round?: ExtractedRoundFacts | null } | null;
  created_at: string;
  document_id: string | null;
  documents: { name?: string } | null;
}

export interface RoundSuggestionField {
  current: RoundFieldValue;
  currentSource: 'manual' | 'document' | null;
  dismissedCandidate?: string;
  candidate: RoundFieldValue;
  candidateDocumentId?: string;
  candidateDocumentName?: string;
  candidateExtractedAt?: string;
  candidatePage?: number | null;
}

// The one place the extraction's field names are tied to the orgs column
// names. A literal map rather than string munging, so a rename on either
// side is a type error instead of a silently dead field.
const PICK: Record<RoundSourceField, (r: ExtractedRoundFacts) => { value: RoundFieldValue; page: number | null } | undefined> = {
  round_target_eur: (r) => r.targetEur,
  round_instruments: (r) => r.instruments,
  round_valuation_eur: (r) => r.valuationEur,
  round_valuation_basis: (r) => r.valuationBasis,
  round_runway_months: (r) => r.runwayMonths,
  round_runway_post_months: (r) => r.runwayPostMonths,
  round_target_close_date: (r) => r.targetCloseDate,
  round_use_of_funds: (r) => r.useOfFunds,
  round_min_ticket_eur: (r) => r.minTicketEur,
};

export function buildRoundSuggestions(params: {
  org: Partial<Record<RoundSourceField, RoundFieldValue>>;
  sources: RoundFieldsSource | null | undefined;
  // Newest first — the caller orders by created_at desc.
  extractions: RoundExtractionRow[];
}): { anyCandidate: boolean; fields: Record<RoundSourceField, RoundSuggestionField> } {
  const sources = params.sources ?? {};
  const fields = {} as Record<RoundSourceField, RoundSuggestionField>;
  let anyCandidate = false;

  for (const column of ROUND_SOURCE_FIELDS) {
    const entry = sources[column];
    // Per FIELD, the most recent extraction that actually states it — not
    // the most recent extraction overall. A deck that states the target and
    // a later term sheet that states only the valuation should contribute
    // one field each, rather than the newer document silently blanking the
    // older one's contribution.
    const found = params.extractions
      .map((row) => ({ row, hit: row.extracted?.round ? PICK[column](row.extracted.round) : undefined }))
      .find((x) => x.hit !== undefined);

    if (found?.hit !== undefined) anyCandidate = true;

    fields[column] = {
      current: params.org[column] ?? null,
      currentSource: entry?.source ?? null,
      dismissedCandidate: entry?.dismissed_candidate,
      candidate: found?.hit?.value ?? null,
      candidateDocumentId: found?.row.document_id ?? undefined,
      candidateDocumentName: found?.row.documents?.name ?? undefined,
      candidateExtractedAt: found?.row.created_at,
      candidatePage: found?.hit?.page ?? null,
    };
  }

  return { anyCandidate, fields };
}
