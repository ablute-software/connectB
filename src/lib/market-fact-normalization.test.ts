import { describe, expect, it } from 'vitest';
import {
  normalizeMarketCandidates, validateGrowthFact, validateMarketSizeFact,
  type GrowthCandidate, type MarketSizeCandidate, type GrowthFact, type MarketSizeFact,
} from './market-fact-normalization';

function growth(overrides: Partial<GrowthCandidate> & { observationId: string; pct: number }): GrowthCandidate {
  return {
    kind: 'growth', documentId: 'doc-1', page: null, sourceQuote: null,
    marketDefinition: null, geography: null, bound: null, metric: null, periodStart: null, periodEnd: null,
    ...overrides,
  };
}

function size(overrides: Partial<MarketSizeCandidate> & { observationId: string; value: number }): MarketSizeCandidate {
  return {
    kind: 'size', documentId: 'doc-1', page: null, sourceQuote: null,
    marketDefinition: null, geography: null, bound: null, metric: null, currency: null, asOfYear: null, methodology: null,
    ...overrides,
  };
}

// Prompt 466, Verificação — "duas fixtures obrigatórias, e são duas de
// propósito: provam coisas opostas e uma sozinha não chega." Fixture A
// proves the engine never invents identity from absence; Fixture B proves
// it correctly consolidates when identity IS proven.

describe('Fixture A — the 8 literal legacy candidates (production, ablute_, page 10, no context)', () => {
  // pct/period exactly as they exist in production market_research_items
  // today — this is the bug an earlier draft of this very prompt's own
  // central rule would have gotten wrong (collapsing all eight into one
  // invented 8-9.6% interval "because" their context was equally absent).
  const FIXTURE_A: GrowthCandidate[] = [
    growth({ observationId: 'obs-1', pct: 8, sourceQuote: 'annual' }),
    growth({ observationId: 'obs-2', pct: 8, sourceQuote: 'per annum (lower estimate)' }),
    growth({ observationId: 'obs-3', pct: 9.1, sourceQuote: 'annual' }),
    growth({ observationId: 'obs-4', pct: 9.1, sourceQuote: 'per annum (lower estimate)' }),
    growth({ observationId: 'obs-5', pct: 9.5, sourceQuote: 'annual' }),
    growth({ observationId: 'obs-6', pct: 9.5, sourceQuote: 'per annum (upper estimate)' }),
    growth({ observationId: 'obs-7', pct: 9.6, sourceQuote: 'annual' }),
    growth({ observationId: 'obs-8', pct: 9.6, sourceQuote: 'upper estimate' }),
  ];

  it('never produces 8 actionable facts, never invents a shared market, and never constructs the 8-9.6% interval', () => {
    const facts = normalizeMarketCandidates(FIXTURE_A) as GrowthFact[];

    // No merging happened at all — absence of context is not proof of
    // identity, so nothing had grounds to combine with anything else.
    expect(facts).toHaveLength(8);

    for (const fact of facts) {
      // The exact defect this prompt's own central rule was corrected to
      // prevent: no fact born from unproven context may be an interval.
      expect(fact.estimateShape).not.toBe('interval');
      expect(fact.validation.status).toBe('incomplete');
      expect(fact.validation.missing).toEqual(expect.arrayContaining(['marketDefinition', 'geography', 'period']));
    }

    // Nothing became a range — every one of the 8 stayed a lone point, so
    // there is no lowerBound/upperBound pair spanning 8 to 9.6 anywhere.
    const anyBoundPopulated = facts.some((f) => f.lowerBound !== null || f.upperBound !== null);
    expect(anyBoundPopulated).toBe(false);
    expect(facts.map((f) => f.value).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([8, 8, 9.1, 9.1, 9.5, 9.5, 9.6, 9.6]);
  });
});

describe('Fixture B — the same page 10, re-extracted under the widened §B schema with real context', () => {
  // Nuno's own semantic hypothesis for this page: two distinct markets,
  // each stated as a range — Digital Therapeutics 8-9.5%, Digital Health
  // 9.1-9.6%. obs-1/obs-2 simulate the SAME quote read twice (a genuine
  // production pattern — a re-run, or the model citing the same passage
  // from two angles), proving the sourceRef-vs-observationId distinction.
  const FIXTURE_B: GrowthCandidate[] = [
    growth({ observationId: 'obs-1', pct: 8, marketDefinition: 'Digital Therapeutics', geography: 'Europe', metric: 'annual', bound: 'lower', periodStart: 2026, periodEnd: 2030, sourceQuote: '8% (lower estimate)' }),
    growth({ observationId: 'obs-2', pct: 8, marketDefinition: 'Digital Therapeutics', geography: 'Europe', metric: 'annual', bound: 'lower', periodStart: 2026, periodEnd: 2030, sourceQuote: '8% (lower estimate)' }),
    growth({ observationId: 'obs-3', pct: 9.5, marketDefinition: 'Digital Therapeutics', geography: 'Europe', metric: 'annual', bound: 'upper', periodStart: 2026, periodEnd: 2030, sourceQuote: '9.5% (upper estimate)' }),
    growth({ observationId: 'obs-4', pct: 9.1, marketDefinition: 'Digital Health', geography: 'Europe', metric: 'annual', bound: 'lower', periodStart: 2026, periodEnd: 2030, sourceQuote: '9.1% (lower estimate)' }),
    growth({ observationId: 'obs-5', pct: 9.6, marketDefinition: 'Digital Health', geography: 'Europe', metric: 'annual', bound: 'upper', periodStart: 2026, periodEnd: 2030, sourceQuote: '9.6% (upper estimate)' }),
  ];

  it('consolidates reading duplicates into one sourceRef while preserving every observationId, and unites lower/upper into an interval only within a proven market', () => {
    const facts = normalizeMarketCandidates(FIXTURE_B) as GrowthFact[];
    expect(facts).toHaveLength(2);

    const dt = facts.find((f) => f.marketDefinition === 'Digital Therapeutics');
    expect(dt).toBeDefined();
    expect(dt).toMatchObject({ estimateShape: 'interval', lowerBound: 8, upperBound: 9.5, value: null });
    expect(dt!.validation).toEqual({ status: 'valid', missing: [], errors: [], flags: [] });
    // obs-1 and obs-2 share (documentId, page, quote) — one reading of the
    // same passage twice, deduplicated to a single sourceRef...
    expect(dt!.sourceRefs).toHaveLength(2); // (obs-1==obs-2) + obs-3
    // ...but BOTH extractions still show up in the audit trail.
    expect(dt!.observationIds).toEqual(['obs-1', 'obs-2', 'obs-3']);

    const dh = facts.find((f) => f.marketDefinition === 'Digital Health');
    expect(dh).toBeDefined();
    expect(dh).toMatchObject({ estimateShape: 'interval', lowerBound: 9.1, upperBound: 9.6, value: null });
    expect(dh!.validation.status).toBe('valid');
    expect(dh!.observationIds).toEqual(['obs-4', 'obs-5']);
  });
});

describe('the four required edge cases', () => {
  it('two candidates with the same value but different, FILLED contexts stay two separate facts — never collapse by number alone', () => {
    const facts = normalizeMarketCandidates([
      growth({ observationId: 'a', pct: 8, marketDefinition: 'Market A', geography: 'Europe', metric: 'annual', bound: 'point', periodStart: 2026, periodEnd: 2030 }),
      growth({ observationId: 'b', pct: 8, marketDefinition: 'Market B', geography: 'Europe', metric: 'annual', bound: 'point', periodStart: 2026, periodEnd: 2030 }),
    ]) as GrowthFact[];
    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.marketDefinition).sort()).toEqual(['Market A', 'Market B']);
    for (const f of facts) {
      expect(f.value).toBe(8);
      expect(f.estimateShape).toBe('point');
      expect(f.validation.status).toBe('valid');
    }
  });

  it('a standalone lower_bound with full context is valid, never incomplete — "at least 8% CAGR" is a complete assertion', () => {
    const [fact] = normalizeMarketCandidates([
      growth({ observationId: 'a', pct: 8, marketDefinition: 'Market A', geography: 'Europe', metric: 'CAGR', bound: 'lower', periodStart: 2026, periodEnd: 2030 }),
    ]) as GrowthFact[];
    expect(fact.estimateShape).toBe('lower_bound');
    expect(fact.lowerBound).toBe(8);
    expect(fact.upperBound).toBeNull();
    expect(validateGrowthFact(fact).validation).toEqual({ status: 'valid', missing: [], errors: [], flags: [] });
  });

  it('an interval that lost its upper extreme is incomplete, naming upperBound in missing — never invalid', () => {
    const fact: GrowthFact = {
      kind: 'growth', marketDefinition: 'Market A', geography: 'Europe', metric: 'CAGR',
      estimateShape: 'interval', value: null, lowerBound: 8, upperBound: null,
      periodStart: 2026, periodEnd: 2030, sourceRefs: [], observationIds: ['a'],
      validation: { status: 'valid', missing: [], errors: [], flags: [] }, hasPositiveIdentity: true,
    };
    const validated = validateGrowthFact(fact);
    expect(validated.validation.status).toBe('incomplete');
    expect(validated.validation.missing).toEqual(['upperBound']);
    expect(validated.validation.errors).toEqual([]);
  });

  it('periodStart after periodEnd is invalid with the contradiction named — never incomplete', () => {
    const fact: GrowthFact = {
      kind: 'growth', marketDefinition: 'Market A', geography: 'Europe', metric: 'CAGR',
      estimateShape: 'point', value: 8, lowerBound: null, upperBound: null,
      periodStart: 2028, periodEnd: 2024, sourceRefs: [], observationIds: ['a'],
      validation: { status: 'valid', missing: [], errors: [], flags: [] }, hasPositiveIdentity: true,
    };
    const validated = validateGrowthFact(fact);
    expect(validated.validation.status).toBe('invalid');
    expect(validated.validation.errors).toEqual(expect.arrayContaining([expect.stringContaining('periodStart > periodEnd')]));
    expect(validated.validation.missing).toEqual([]);
  });
});

describe('validateGrowthFact — no arbitrary plausibility ceiling (§D)', () => {
  it('growth above 100% is flagged for review but stays valid — small markets really do grow that fast', () => {
    const fact: GrowthFact = {
      kind: 'growth', marketDefinition: 'Niche Market', geography: 'Europe', metric: 'annual',
      estimateShape: 'point', value: 250, lowerBound: null, upperBound: null,
      periodStart: 2026, periodEnd: 2030, sourceRefs: [], observationIds: ['a'],
      validation: { status: 'valid', missing: [], errors: [], flags: [] }, hasPositiveIdentity: true,
    };
    const validated = validateGrowthFact(fact);
    expect(validated.validation.status).toBe('valid');
    expect(validated.validation.errors).toEqual([]);
    expect(validated.validation.flags.length).toBeGreaterThan(0);
  });

  it('growth below -100% is invalid — a non-negative quantity cannot decline more than everything it had', () => {
    const fact: GrowthFact = {
      kind: 'growth', marketDefinition: 'Market A', geography: 'Europe', metric: 'annual',
      estimateShape: 'point', value: -150, lowerBound: null, upperBound: null,
      periodStart: 2026, periodEnd: 2030, sourceRefs: [], observationIds: ['a'],
      validation: { status: 'valid', missing: [], errors: [], flags: [] }, hasPositiveIdentity: true,
    };
    expect(validateGrowthFact(fact).validation.status).toBe('invalid');
  });

  it('NaN and Infinity are invalid, never silently accepted', () => {
    const base: Omit<GrowthFact, 'value'> = {
      kind: 'growth', marketDefinition: 'Market A', geography: 'Europe', metric: 'annual',
      estimateShape: 'point', lowerBound: null, upperBound: null,
      periodStart: 2026, periodEnd: 2030, sourceRefs: [], observationIds: ['a'],
      validation: { status: 'valid', missing: [], errors: [], flags: [] }, hasPositiveIdentity: true,
    };
    expect(validateGrowthFact({ ...base, value: NaN }).validation.status).toBe('invalid');
    expect(validateGrowthFact({ ...base, value: Infinity }).validation.status).toBe('invalid');
  });
});

describe('MarketSizeFact — the same completeness/validity split, proven independently of GrowthFact', () => {
  it('normalizeMarketCandidates: a size candidate without as_of_year is incomplete and names the field', () => {
    const [fact] = normalizeMarketCandidates([
      size({ observationId: 'a', value: 50_000_000, marketDefinition: 'Digital Therapeutics', geography: 'Europe', metric: 'TAM', currency: 'EUR', bound: 'point' }),
    ]) as MarketSizeFact[];
    expect(fact.validation.status).toBe('incomplete');
    expect(fact.validation.missing).toContain('asOfYear');
  });

  it('validateMarketSizeFact: as_of_year in the future is invalid, with the error named', () => {
    const fact: MarketSizeFact = {
      kind: 'size', marketDefinition: 'Market A', geography: 'Europe', metric: 'TAM',
      estimateShape: 'point', value: 50_000_000, lowerBound: null, upperBound: null,
      currency: 'EUR', asOfYear: 2099, methodology: null, sourceRefs: [], observationIds: ['a'],
      validation: { status: 'valid', missing: [], errors: [], flags: [] }, hasPositiveIdentity: true,
    };
    const validated = validateMarketSizeFact(fact, new Date('2026-08-29T00:00:00Z'));
    expect(validated.validation.status).toBe('invalid');
    expect(validated.validation.errors).toEqual(expect.arrayContaining([expect.stringContaining('as_of_year')]));
  });

  it('validateMarketSizeFact: a negative value is invalid — a market cannot be smaller than nothing', () => {
    const fact: MarketSizeFact = {
      kind: 'size', marketDefinition: 'Market A', geography: 'Europe', metric: 'TAM',
      estimateShape: 'point', value: -1, lowerBound: null, upperBound: null,
      currency: 'EUR', asOfYear: 2026, methodology: null, sourceRefs: [], observationIds: ['a'],
      validation: { status: 'valid', missing: [], errors: [], flags: [] }, hasPositiveIdentity: true,
    };
    expect(validateMarketSizeFact(fact, new Date('2026-08-29T00:00:00Z')).validation.status).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// Prompt 488 — the ablute_ TAM slide: "Urinalysis Market: ~USD 4B (↑8–9.6%
// p.a.)" and "Biosensors Market: ~USD 30–34B (↑9.1–9.5% p.a.)". The model
// reads each range correctly — same market_definition, one bound:'lower',
// one bound:'upper' — but states no geography and no period, because the
// slide states none. Before this prompt each half became its own fact.
describe('Prompt 488 — the two halves of one range, when the document names no geography or period', () => {
  it('pairs lower and upper into ONE interval — the exact ablute_ case', () => {
    const facts = normalizeMarketCandidates([
      growth({ observationId: 'obs-lo', pct: 8, marketDefinition: 'Urinalysis Market', bound: 'lower' }),
      growth({ observationId: 'obs-hi', pct: 9.6, marketDefinition: 'Urinalysis Market', bound: 'upper' }),
    ]) as GrowthFact[];

    expect(facts).toHaveLength(1);
    expect(facts[0].estimateShape).toBe('interval');
    expect(facts[0].lowerBound).toBe(8);
    expect(facts[0].upperBound).toBe(9.6);
    expect(facts[0].observationIds.sort()).toEqual(['obs-hi', 'obs-lo']);
    // §4 — the merge joins the halves; it never invents the missing context.
    expect(facts[0].geography).toBeNull();
    expect(facts[0].periodStart).toBeNull();
    expect(facts[0].validation.status).toBe('incomplete');
    expect(facts[0].validation.missing).toContain('geography');
    // 467 v3 §2 stays intact: this pair is one range inside ONE extraction,
    // never a claim that another document's contextless 8–9.6% is the same
    // proposition.
    expect(facts[0].hasPositiveIdentity).toBe(false);
  });

  it('handles both ranges on the same slide independently', () => {
    const facts = normalizeMarketCandidates([
      growth({ observationId: 'u-lo', pct: 8, marketDefinition: 'Urinalysis Market', bound: 'lower' }),
      growth({ observationId: 'u-hi', pct: 9.6, marketDefinition: 'Urinalysis Market', bound: 'upper' }),
      growth({ observationId: 'b-lo', pct: 9.1, marketDefinition: 'Biosensors Market', bound: 'lower' }),
      growth({ observationId: 'b-hi', pct: 9.5, marketDefinition: 'Biosensors Market', bound: 'upper' }),
    ]) as GrowthFact[];

    expect(facts).toHaveLength(2);
    const urinalysis = facts.find((f) => f.marketDefinition === 'Urinalysis Market')!;
    const biosensors = facts.find((f) => f.marketDefinition === 'Biosensors Market')!;
    expect([urinalysis.lowerBound, urinalysis.upperBound]).toEqual([8, 9.6]);
    expect([biosensors.lowerBound, biosensors.upperBound]).toEqual([9.1, 9.5]);
  });

  it('the same fix serves market_size — one function, both kinds', () => {
    const facts = normalizeMarketCandidates([
      size({ observationId: 's-lo', value: 30_000_000_000, marketDefinition: 'Biosensors Market', bound: 'lower' }),
      size({ observationId: 's-hi', value: 34_000_000_000, marketDefinition: 'Biosensors Market', bound: 'upper' }),
    ]) as MarketSizeFact[];

    expect(facts).toHaveLength(1);
    expect(facts[0].estimateShape).toBe('interval');
    expect([facts[0].lowerBound, facts[0].upperBound]).toEqual([30_000_000_000, 34_000_000_000]);
  });
});

describe('Prompt 488 — invariable 14 does not break because of this fix', () => {
  it('DIFFERENT marketDefinition, both without geography, still never merge', () => {
    const facts = normalizeMarketCandidates([
      growth({ observationId: 'a', pct: 8, marketDefinition: 'Urinalysis Market', bound: 'lower' }),
      growth({ observationId: 'b', pct: 9.6, marketDefinition: 'Biosensors Market', bound: 'upper' }),
    ]);
    expect(facts).toHaveLength(2);
  });

  it('one WITH geography and one without is inconsistent absence, not a pair', () => {
    const facts = normalizeMarketCandidates([
      growth({ observationId: 'a', pct: 8, marketDefinition: 'Urinalysis Market', bound: 'lower', geography: 'EU' }),
      growth({ observationId: 'b', pct: 9.6, marketDefinition: 'Urinalysis Market', bound: 'upper' }),
    ]);
    expect(facts).toHaveLength(2);
  });

  it('two lowers and one upper is ambiguous — nothing is guessed', () => {
    const facts = normalizeMarketCandidates([
      growth({ observationId: 'lo1', pct: 8, marketDefinition: 'Urinalysis Market', bound: 'lower' }),
      growth({ observationId: 'lo2', pct: 8.4, marketDefinition: 'Urinalysis Market', bound: 'lower' }),
      growth({ observationId: 'hi', pct: 9.6, marketDefinition: 'Urinalysis Market', bound: 'upper' }),
    ]);
    expect(facts).toHaveLength(3);
  });

  it('point-valued candidates never pair — buildEstimate would drop all but the first', () => {
    // The reason this rule is bounds-only rather than "both contexts absent":
    // merging points reaches buildEstimate's final branch, which keeps
    // pointTagged[0] and silently discards the rest.
    const facts = normalizeMarketCandidates([
      growth({ observationId: 'p1', pct: 8, marketDefinition: 'Urinalysis Market', bound: 'point' }),
      growth({ observationId: 'p2', pct: 9.6, marketDefinition: 'Urinalysis Market', bound: 'point' }),
    ]) as GrowthFact[];
    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.value).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([8, 9.6]);
  });

  it('a candidate with no marketDefinition at all never pairs — Fixture A stays intact', () => {
    const facts = normalizeMarketCandidates([
      growth({ observationId: 'a', pct: 8, bound: 'lower' }),
      growth({ observationId: 'b', pct: 9.6, bound: 'upper' }),
    ]);
    expect(facts).toHaveLength(2);
  });
});
