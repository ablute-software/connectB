import { describe, expect, it } from 'vitest';
import {
  parseStructuredForSection, computeFactStatus, countIndependentSources, valuesConflict, computeFactStatusForRun, signatureFor,
  shouldAutoFillMarketData, type RunItemForFactStatus,
} from './market-research-structured';
import type { MatchState } from './market-competition';

function facetRaw(state: MatchState, sourceUrl?: string) {
  return { state, sourceUrl: sourceUrl ?? (state === 'MATCH' || state === 'PARTIAL' ? 'https://acme.com/product' : undefined) };
}
// A relation with every decisive facet MATCH + a real source — enough for
// parseStructuredForSection to accept it and classifyCompetitor to reach
// DIRECT; the exact classification cascade is market-competition.test.ts's
// job, not this file's.
function fullRelationRaw(overrides: Record<string, ReturnType<typeof facetRaw>> = {}) {
  return {
    problemOrJobOverlap: facetRaw('MATCH'), outcomeOverlap: facetRaw('MATCH'), substitutability: facetRaw('MATCH'),
    userOrBuyerOverlap: facetRaw('MATCH'), useContextOverlap: facetRaw('MATCH'),
    ...overrides,
  };
}

// Prompt 447 §C — the exact behavior change this section verifies directly
// (not just by code reading): a web-sourced sizing/growth item now
// auto-fills org_market_data, where before only a document-sourced one did.
describe('shouldAutoFillMarketData', () => {
  it('sizing and growth qualify regardless of source — the 447 §C fix itself', () => {
    expect(shouldAutoFillMarketData('sizing', 'web')).toBe(true);
    expect(shouldAutoFillMarketData('sizing', null)).toBe(true);
    expect(shouldAutoFillMarketData('growth', 'web')).toBe(true);
    expect(shouldAutoFillMarketData('sizing', 'document')).toBe(true);
    expect(shouldAutoFillMarketData('growth', 'document')).toBe(true);
  });
  it('segments still requires a document source (no web equivalent this phase)', () => {
    expect(shouldAutoFillMarketData('segments', 'document')).toBe(true);
    expect(shouldAutoFillMarketData('segments', 'web')).toBe(false);
    expect(shouldAutoFillMarketData('segments', null)).toBe(false);
  });
  it('sections with no org_market_data field never qualify, from any source', () => {
    expect(shouldAutoFillMarketData('trends', 'document')).toBe(false);
    expect(shouldAutoFillMarketData('regulatory', 'document')).toBe(false);
    expect(shouldAutoFillMarketData('players', 'document')).toBe(false);
    expect(shouldAutoFillMarketData('rounds', 'document')).toBe(false);
  });
});

describe('signatureFor — the research cache key', () => {
  it('is deterministic for the same inputs', () => {
    expect(signatureFor('h1', 1, 'sizing')).toBe(signatureFor('h1', 1, 'sizing'));
  });
  it('changes when thesisVersion changes, even for the same hypothesisId and section', () => {
    const v1 = signatureFor('h1', 1, 'sizing');
    const v2 = signatureFor('h1', 2, 'sizing');
    expect(v1).not.toBe(v2);
  });
  it('changes when hypothesisId changes', () => {
    expect(signatureFor('h1', 1, 'sizing')).not.toBe(signatureFor('h2', 1, 'sizing'));
  });
  it('changes when section changes', () => {
    expect(signatureFor('h1', 1, 'sizing')).not.toBe(signatureFor('h1', 1, 'growth'));
    expect(signatureFor('h1', 1, 'sizing')).not.toBe(signatureFor('h1', 1, null));
  });
});

describe('parseStructuredForSection — sizing', () => {
  const valid = { valueEur: 2_000_000_000, scope: 'TAM', year: 2026, geography: 'EU', method: 'top_down' };
  it('accepts a complete, valid sizing structured', () => {
    expect(parseStructuredForSection('sizing', valid)).toEqual(valid);
  });
  it('rejects a missing field', () => {
    const { method: _drop, ...rest } = valid;
    expect(parseStructuredForSection('sizing', rest)).toBeNull();
  });
  it('rejects an invalid enum value', () => {
    expect(parseStructuredForSection('sizing', { ...valid, scope: 'XAM' })).toBeNull();
    expect(parseStructuredForSection('sizing', { ...valid, method: 'guess' })).toBeNull();
  });
  it('rejects a non-numeric valueEur', () => {
    expect(parseStructuredForSection('sizing', { ...valid, valueEur: '2bn' })).toBeNull();
  });
});

describe('parseStructuredForSection — growth', () => {
  it('accepts pct + periodYears, segment optional', () => {
    expect(parseStructuredForSection('growth', { pct: 24, periodYears: 5 })).toEqual({ pct: 24, periodYears: 5, segment: null });
    expect(parseStructuredForSection('growth', { pct: 24, periodYears: 5, segment: 'SMB' })).toEqual({ pct: 24, periodYears: 5, segment: 'SMB' });
  });
  it('rejects missing pct or periodYears', () => {
    expect(parseStructuredForSection('growth', { periodYears: 5 })).toBeNull();
    expect(parseStructuredForSection('growth', { pct: 24 })).toBeNull();
  });
});

describe('parseStructuredForSection — rounds', () => {
  const valid = { company: 'Acme', amountEur: 5_000_000, date: '2026-03-01', stage: 'Series A' };
  it('accepts a complete round', () => {
    expect(parseStructuredForSection('rounds', valid)).toEqual(valid);
  });
  it('rejects a missing field', () => {
    const { stage: _drop, ...rest } = valid;
    expect(parseStructuredForSection('rounds', rest)).toBeNull();
  });
});

describe('parseStructuredForSection — players', () => {
  it('accepts a status-quo candidate directly, untouched by classification', () => {
    const result = parseStructuredForSection('players', { company: 'Manual spreadsheet tracking', statusQuoNote: 'Founder said most buyers still track this in Excel.' });
    expect(result).toEqual({ company: 'Manual spreadsheet tracking', statusQuoNote: 'Founder said most buyers still track this in Excel.', sherlockClassification: 'STATUS_QUO' });
  });
  it('rejects a missing company, statusQuoNote or not', () => {
    expect(parseStructuredForSection('players', { statusQuoNote: 'no company here' })).toBeNull();
    expect(parseStructuredForSection('players', { candidateStage: 'commercial', relation: fullRelationRaw() })).toBeNull();
  });
  it('accepts a real candidate: company + candidateStage + relation -> sherlockClassification computed, never model-supplied', () => {
    const result = parseStructuredForSection('players', { company: 'Rival Inc', candidateStage: 'commercial', relation: fullRelationRaw() }) as { sherlockClassification?: string };
    expect(result?.sherlockClassification).toBe('DIRECT'); // classifyCompetitor's own cascade, not read from input
  });
  it('rejects an invalid candidateStage', () => {
    expect(parseStructuredForSection('players', { company: 'Rival Inc', candidateStage: 'seed', relation: fullRelationRaw() })).toBeNull();
  });
  it('rejects a missing or malformed relation', () => {
    expect(parseStructuredForSection('players', { company: 'Rival Inc', candidateStage: 'commercial' })).toBeNull();
    expect(parseStructuredForSection('players', { company: 'Rival Inc', candidateStage: 'commercial', relation: 'not an object' })).toBeNull();
  });
  it('a MATCH facet with no sourceUrl regresses to UNKNOWN for that facet alone, never discards the candidate', () => {
    const result = parseStructuredForSection('players', {
      company: 'Rival Inc', candidateStage: 'commercial',
      relation: fullRelationRaw({ userOrBuyerOverlap: { state: 'MATCH', sourceUrl: undefined } }), // no sourceUrl
    }) as { relation?: { userOrBuyerOverlap: { state: string; sourceUrl: string | null } } };
    expect(result?.relation?.userOrBuyerOverlap).toEqual({ state: 'UNKNOWN', note: null, sourceUrl: null });
  });
  it('returns null when every decisive facet and budgetOverlap are UNKNOWN — nothing to work with', () => {
    const allUnknown = fullRelationRaw({
      problemOrJobOverlap: facetRaw('UNKNOWN'), outcomeOverlap: facetRaw('UNKNOWN'), substitutability: facetRaw('UNKNOWN'),
      userOrBuyerOverlap: facetRaw('UNKNOWN'), useContextOverlap: facetRaw('UNKNOWN'),
    });
    expect(parseStructuredForSection('players', { company: 'Obscure Co', candidateStage: 'unknown', relation: allUnknown })).toBeNull();
  });
  it('a single decisive MATCH is enough to avoid the all-UNKNOWN discard, even alone', () => {
    const oneMatch = {
      problemOrJobOverlap: facetRaw('MATCH'), outcomeOverlap: facetRaw('UNKNOWN'), substitutability: facetRaw('UNKNOWN'),
      userOrBuyerOverlap: facetRaw('UNKNOWN'), useContextOverlap: facetRaw('UNKNOWN'),
    };
    expect(parseStructuredForSection('players', { company: 'Obscure Co', candidateStage: 'unknown', relation: oneMatch })).not.toBeNull();
  });
});

describe('parseStructuredForSection — sections with no typed structured this phase', () => {
  it('returns null for trends/regulatory/definition regardless of input', () => {
    expect(parseStructuredForSection('trends', { anything: 'goes' })).toBeNull();
    expect(parseStructuredForSection('regulatory', { anything: 'goes' })).toBeNull();
    expect(parseStructuredForSection('definition', { anything: 'goes' })).toBeNull();
  });
});

describe('parseStructuredForSection — malformed input never throws', () => {
  it('handles null, non-object, and empty input', () => {
    expect(parseStructuredForSection('sizing', null)).toBeNull();
    expect(parseStructuredForSection('sizing', 'not an object')).toBeNull();
    expect(parseStructuredForSection('sizing', {})).toBeNull();
  });
});

describe('countIndependentSources', () => {
  it('counts distinct domains as distinct sources', () => {
    expect(countIndependentSources([{ sourceUrl: 'https://a.com/x' }, { sourceUrl: 'https://b.com/y' }])).toBe(2);
  });
  it('collapses the same domain (with or without www) to one source', () => {
    expect(countIndependentSources([{ sourceUrl: 'https://www.a.com/x' }, { sourceUrl: 'https://a.com/y' }])).toBe(1);
  });
  it('counts an unparseable URL as its own opaque source rather than dropping it', () => {
    expect(countIndependentSources([{ sourceUrl: 'not-a-url' }, { sourceUrl: 'https://a.com/y' }])).toBe(2);
  });
  it('is zero for an empty list', () => {
    expect(countIndependentSources([])).toBe(0);
  });
});

describe('valuesConflict', () => {
  it('does not conflict when values agree', () => {
    expect(valuesConflict(2_000_000_000, 2_100_000_000)).toBe(false); // 5% apart
  });
  it('conflicts when values diverge more than 40%', () => {
    expect(valuesConflict(1_000_000_000, 3_000_000_000)).toBe(true); // 200% apart
  });
  it('is symmetric regardless of argument order', () => {
    expect(valuesConflict(1_000_000_000, 3_000_000_000)).toBe(valuesConflict(3_000_000_000, 1_000_000_000));
  });
  it('treats one zero and one non-zero as a conflict', () => {
    expect(valuesConflict(0, 100)).toBe(true);
  });
  it('treats two zeros as no conflict', () => {
    expect(valuesConflict(0, 0)).toBe(false);
  });
});

// The four cases the prompt itself requires, expressed directly against
// computeFactStatus (the pure decision function).
describe('computeFactStatus — the four required cases', () => {
  it('no structured -> INSUFFICIENT_FACT', () => {
    expect(computeFactStatus({ hasStructured: false, hasSourceUrl: true, sourceCount: 2, conflictingValues: false })).toBe('INSUFFICIENT_FACT');
  });
  it('no source URL -> INSUFFICIENT_FACT even with structured', () => {
    expect(computeFactStatus({ hasStructured: true, hasSourceUrl: false, sourceCount: 1, conflictingValues: false })).toBe('INSUFFICIENT_FACT');
  });
  it('1 source -> PARTIAL_FACT', () => {
    expect(computeFactStatus({ hasStructured: true, hasSourceUrl: true, sourceCount: 1, conflictingValues: false })).toBe('PARTIAL_FACT');
  });
  it('2 sources, different domains, agreeing values -> VALIDATED_FACT', () => {
    expect(computeFactStatus({ hasStructured: true, hasSourceUrl: true, sourceCount: 2, conflictingValues: false })).toBe('VALIDATED_FACT');
  });
  it('2 sources, values diverging >40% -> CONFLICTING_FACT (even with sourceCount >= 2)', () => {
    expect(computeFactStatus({ hasStructured: true, hasSourceUrl: true, sourceCount: 2, conflictingValues: true })).toBe('CONFLICTING_FACT');
  });
});

describe('computeFactStatusForRun — grouping + the four cases end to end', () => {
  function item(overrides: Partial<RunItemForFactStatus>): RunItemForFactStatus {
    return { section: 'sizing', title: 'EU diagnostics TAM', sourceUrl: 'https://a.com/x', structured: null, ...overrides };
  }

  it('no structured -> INSUFFICIENT_FACT', () => {
    const items = [item({ structured: null })];
    expect(computeFactStatusForRun(items).get(0)).toBe('INSUFFICIENT_FACT');
  });

  it('a single sourced, structured item -> PARTIAL_FACT', () => {
    const items = [item({ structured: { valueEur: 2e9, scope: 'TAM', year: 2026, geography: 'EU', method: 'top_down' } })];
    expect(computeFactStatusForRun(items).get(0)).toBe('PARTIAL_FACT');
  });

  it('two items, same fact, different domains, agreeing values -> VALIDATED_FACT for both', () => {
    const structured = { valueEur: 2e9, scope: 'TAM' as const, year: 2026, geography: 'EU', method: 'top_down' as const };
    const items = [
      item({ sourceUrl: 'https://a.com/x', structured }),
      item({ sourceUrl: 'https://b.com/y', structured: { ...structured, valueEur: 2.05e9 } }),
    ];
    const result = computeFactStatusForRun(items);
    expect(result.get(0)).toBe('VALIDATED_FACT');
    expect(result.get(1)).toBe('VALIDATED_FACT');
  });

  it('two items, same fact, values diverging >40% -> CONFLICTING_FACT for both', () => {
    const structured = { valueEur: 1e9, scope: 'TAM' as const, year: 2026, geography: 'EU', method: 'top_down' as const };
    const items = [
      item({ sourceUrl: 'https://a.com/x', structured }),
      item({ sourceUrl: 'https://b.com/y', structured: { ...structured, valueEur: 3e9 } }),
    ];
    const result = computeFactStatusForRun(items);
    expect(result.get(0)).toBe('CONFLICTING_FACT');
    expect(result.get(1)).toBe('CONFLICTING_FACT');
  });

  it('two items from the same domain only count as one source -> stays PARTIAL_FACT', () => {
    const structured = { valueEur: 2e9, scope: 'TAM' as const, year: 2026, geography: 'EU', method: 'top_down' as const };
    const items = [
      item({ sourceUrl: 'https://a.com/x', structured }),
      item({ sourceUrl: 'https://a.com/y', structured }),
    ];
    const result = computeFactStatusForRun(items);
    expect(result.get(0)).toBe('PARTIAL_FACT');
    expect(result.get(1)).toBe('PARTIAL_FACT');
  });

  it('unrelated facts (different titles) never affect each other\'s status', () => {
    const items = [
      item({ title: 'EU diagnostics TAM', sourceUrl: 'https://a.com/x', structured: { valueEur: 2e9, scope: 'TAM', year: 2026, geography: 'EU', method: 'top_down' } }),
      item({ title: 'US diagnostics TAM', sourceUrl: 'https://b.com/y', structured: { valueEur: 9e9, scope: 'TAM', year: 2026, geography: 'US', method: 'top_down' } }),
    ];
    const result = computeFactStatusForRun(items);
    expect(result.get(0)).toBe('PARTIAL_FACT');
    expect(result.get(1)).toBe('PARTIAL_FACT');
  });

  // Prompt 450 — players is the one section where sourceCount comes from
  // the RELATION's own facet sourceUrls (qualifying tier A/B only), never
  // the item's single top-level source_url. Every decisive facet is given
  // explicitly in each case below (never left to fullRelationRaw's default
  // acme.com source) so the domain count in each assertion is exact, not
  // incidentally right because of a bled-in default.
  describe('players: sourceCount from qualifying relation facets, not the item source_url', () => {
    function playersItem(relation: ReturnType<typeof fullRelationRaw>): RunItemForFactStatus {
      const structured = parseStructuredForSection('players', { company: 'Rival Inc', candidateStage: 'commercial', relation });
      return { section: 'players', title: 'Rival Inc', sourceUrl: 'https://tracxn.com/companies/rival-inc', structured };
    }

    it('two decisive facets backed by two different qualifying domains -> VALIDATED_FACT, even though the item\'s own source_url is an aggregator', () => {
      const items = [playersItem({
        problemOrJobOverlap: facetRaw('UNKNOWN'), outcomeOverlap: facetRaw('UNKNOWN'), substitutability: facetRaw('UNKNOWN'),
        userOrBuyerOverlap: facetRaw('MATCH', 'https://a.com/pricing'), useContextOverlap: facetRaw('MATCH', 'https://b.com/product'),
      })];
      expect(computeFactStatusForRun(items).get(0)).toBe('VALIDATED_FACT');
    });

    it('every facet source from the same domain only counts as one -> PARTIAL_FACT', () => {
      const items = [playersItem({
        problemOrJobOverlap: facetRaw('UNKNOWN'), outcomeOverlap: facetRaw('UNKNOWN'), substitutability: facetRaw('UNKNOWN'),
        userOrBuyerOverlap: facetRaw('MATCH', 'https://a.com/pricing'), useContextOverlap: facetRaw('MATCH', 'https://a.com/product'),
      })];
      expect(computeFactStatusForRun(items).get(0)).toBe('PARTIAL_FACT');
    });

    it('facet sources that are all known aggregators never reach VALIDATED_FACT, even with two distinct domains', () => {
      const items = [playersItem({
        problemOrJobOverlap: facetRaw('UNKNOWN'), outcomeOverlap: facetRaw('UNKNOWN'), substitutability: facetRaw('UNKNOWN'),
        userOrBuyerOverlap: facetRaw('MATCH', 'https://tracxn.com/companies/rival-inc'), useContextOverlap: facetRaw('MATCH', 'https://crunchbase.com/organization/rival-inc'),
      })];
      expect(computeFactStatusForRun(items).get(0)).toBe('PARTIAL_FACT');
    });
  });
});
