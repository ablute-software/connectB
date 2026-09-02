// Prompt 541 §B — the shape /api/company/round-suggestion returns, and the
// three §C cases read end to end (extraction row -> per-field material ->
// decideRoundField's verdict), since that pairing is what the founder
// actually experiences.
import { describe, it, expect } from 'vitest';
import { buildRoundSuggestions, type RoundExtractionRow } from './round-suggestion';
import { ROUND_SOURCE_FIELDS, decideRoundField } from './round-field-precedence';

function extraction(over: Partial<RoundExtractionRow> & { round?: RoundExtractionRow['extracted'] extends null ? never : object }): RoundExtractionRow {
  return {
    extracted: { round: (over as { round?: object }).round ?? null } as RoundExtractionRow['extracted'],
    created_at: over.created_at ?? '2026-09-01T10:00:00Z',
    document_id: over.document_id ?? 'doc-1',
    documents: over.documents ?? { name: 'Term sheet.pdf' },
  };
}

const TERM_SHEET = extraction({
  round: { targetEur: { value: 1300000, page: 4 }, valuationEur: { value: 6000000, page: 4 } },
});

describe('buildRoundSuggestions', () => {
  it('returns an entry for every round field, whether or not anything was found', () => {
    const { fields } = buildRoundSuggestions({ org: {}, sources: {}, extractions: [] });
    expect(Object.keys(fields).sort()).toEqual([...ROUND_SOURCE_FIELDS].sort());
  });

  it('reports anyCandidate false when no extraction states a single round field', () => {
    const r = buildRoundSuggestions({
      org: {}, sources: {},
      extractions: [extraction({ round: undefined })],
    });
    expect(r.anyCandidate).toBe(false);
    expect(r.fields.round_target_eur.candidate).toBeNull();
  });

  it('carries the candidate with its document, date and page', () => {
    const { anyCandidate, fields } = buildRoundSuggestions({ org: {}, sources: {}, extractions: [TERM_SHEET] });
    expect(anyCandidate).toBe(true);
    expect(fields.round_target_eur).toMatchObject({
      candidate: 1300000, candidateDocumentId: 'doc-1',
      candidateDocumentName: 'Term sheet.pdf', candidateExtractedAt: '2026-09-01T10:00:00Z', candidatePage: 4,
    });
  });

  it('takes the newest extraction that states each field, not the newest overall', () => {
    // A later deck that says nothing about the valuation must not blank the
    // earlier term sheet's valuation.
    const newerDeck = extraction({
      created_at: '2026-09-02T10:00:00Z', document_id: 'doc-2', documents: { name: 'Deck v4.pdf' },
      round: { targetEur: { value: 1500000, page: 2 } },
    });
    const { fields } = buildRoundSuggestions({ org: {}, sources: {}, extractions: [newerDeck, TERM_SHEET] });
    expect(fields.round_target_eur.candidate).toBe(1500000);
    expect(fields.round_target_eur.candidateDocumentName).toBe('Deck v4.pdf');
    expect(fields.round_valuation_eur.candidate).toBe(6000000);
    expect(fields.round_valuation_eur.candidateDocumentName).toBe('Term sheet.pdf');
  });

  it('passes the saved value and its provenance straight through', () => {
    const { fields } = buildRoundSuggestions({
      org: { round_target_eur: 1000000 },
      sources: { round_target_eur: { source: 'manual', dismissed_candidate: '1500000' } },
      extractions: [TERM_SHEET],
    });
    expect(fields.round_target_eur.current).toBe(1000000);
    expect(fields.round_target_eur.currentSource).toBe('manual');
    expect(fields.round_target_eur.dismissedCandidate).toBe('1500000');
  });
});

describe('the three §C cases, end to end', () => {
  function verdict(org: Parameters<typeof buildRoundSuggestions>[0]['org'], sources: Parameters<typeof buildRoundSuggestions>[0]['sources']) {
    const { fields } = buildRoundSuggestions({ org, sources, extractions: [TERM_SHEET] });
    const f = fields.round_target_eur;
    return decideRoundField({
      current: f.current,
      entry: f.currentSource ? { source: f.currentSource, dismissed_candidate: f.dismissedCandidate } : undefined,
      candidate: {
        value: f.candidate, documentId: f.candidateDocumentId ?? '', documentName: f.candidateDocumentName ?? '',
        extractedAt: f.candidateExtractedAt ?? '', page: f.candidatePage ?? null,
      },
    });
  }

  it('§C.1a — an empty field is offered the document value', () => {
    expect(verdict({}, {}).kind).toBe('suggest');
  });

  it('§C.1b — a field that only ever came from a document is offered the newer value', () => {
    expect(verdict({ round_target_eur: 900000 }, { round_target_eur: { source: 'document' } }).kind).toBe('suggest');
  });

  it('§C.2 — a field the founder typed is protected, and raises a conflict instead', () => {
    expect(verdict({ round_target_eur: 900000 }, { round_target_eur: { source: 'manual' } }).kind).toBe('conflict');
  });

  it('§C.2 — and stays quiet once they have kept their own against this candidate', () => {
    expect(verdict(
      { round_target_eur: 900000 },
      { round_target_eur: { source: 'manual', dismissed_candidate: '1300000' } },
    ).kind).toBe('none');
  });
});
