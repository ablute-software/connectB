import { describe, expect, it } from 'vitest';
import {
  evidenceEligibleForInsight, materialToHypothesis, computeInsightConfidence, classifyNumericDelta, computeVerdict,
  FOUNDER_DEVIATION_THRESHOLD_PCT, type FounderBaseline,
} from './market-assessment-engine';
import type { SizingStructured, PlayerStructured } from './market-research-structured';
import type { FactStatus } from './market-intelligence-types';
import type { CompetitorClassification } from './market-competition';

const NO_FOUNDER: FounderBaseline = { sizingValueEur: null, growthPct: null, knownCompetitorNames: [] };

function sizing(valueEur: number, scope: SizingStructured['scope'] = 'TAM'): SizingStructured {
  return { valueEur, scope, year: 2026, geography: 'EU', method: 'top_down' };
}
// materialToHypothesis/computeVerdict only ever read .company and
// .sherlockClassification off a players structured — the facets/stage/kind
// are irrelevant here (classifyCompetitor itself is exhaustively covered by
// market-competition.test.ts), so a placeholder all-UNKNOWN relation and a
// fixed candidateKind are enough to satisfy the type.
function player(company: string, sherlockClassification: CompetitorClassification): PlayerStructured {
  const unknown = { state: 'UNKNOWN' as const, note: null, sourceUrl: null };
  return {
    company, candidateKind: 'COMPANY', candidateStage: 'commercial', sherlockClassification,
    relation: {
      problemOrJobOverlap: unknown, outcomeOverlap: unknown, substitutability: unknown,
      userOrBuyerOverlap: unknown, useContextOverlap: unknown,
    },
  };
}

describe('evidenceEligibleForInsight', () => {
  it('is false for INSUFFICIENT_FACT', () => {
    expect(evidenceEligibleForInsight('INSUFFICIENT_FACT')).toBe(false);
  });
  it('is true for the other three statuses', () => {
    expect(evidenceEligibleForInsight('VALIDATED_FACT')).toBe(true);
    expect(evidenceEligibleForInsight('PARTIAL_FACT')).toBe(true);
    expect(evidenceEligibleForInsight('CONFLICTING_FACT')).toBe(true);
  });
  it('is false for null', () => {
    expect(evidenceEligibleForInsight(null)).toBe(false);
  });
});

describe('materialToHypothesis', () => {
  it('sizing is always material, regardless of fact status', () => {
    (['VALIDATED_FACT', 'PARTIAL_FACT', 'CONFLICTING_FACT'] as FactStatus[]).forEach((fs) => {
      expect(materialToHypothesis('sizing', fs, sizing(1e9))).toBe(true);
    });
  });
  it('growth is always material, regardless of fact status', () => {
    (['VALIDATED_FACT', 'PARTIAL_FACT', 'CONFLICTING_FACT'] as FactStatus[]).forEach((fs) => {
      expect(materialToHypothesis('growth', fs, null)).toBe(true);
    });
  });
  it('players with sherlockClassification DIRECT or FUNCTIONAL is material', () => {
    expect(materialToHypothesis('players', 'VALIDATED_FACT', player('Acme', 'DIRECT'))).toBe(true);
    expect(materialToHypothesis('players', 'VALIDATED_FACT', player('Acme', 'FUNCTIONAL'))).toBe(true);
  });
  it('players with any other classification is not material', () => {
    // Prompt 455 — STATUS_QUO now flows through this exact same
    // PlayerStructured/sherlockClassification path as every other
    // classification (it used to arrive via a separate statusQuoNote
    // shape materialToHypothesis never saw scored like this).
    (['BUDGET', 'EMERGING', 'POTENTIAL_ENTRANT', 'ADJACENT', 'STATUS_QUO', 'NOT_COMPETITOR', 'UNRESOLVED'] as CompetitorClassification[]).forEach((type) => {
      expect(materialToHypothesis('players', 'VALIDATED_FACT', player('Acme', type))).toBe(false);
    });
  });
  it('any players classification becomes material under CONFLICTING_FACT', () => {
    (['BUDGET', 'EMERGING', 'POTENTIAL_ENTRANT', 'ADJACENT', 'STATUS_QUO', 'NOT_COMPETITOR', 'UNRESOLVED'] as CompetitorClassification[]).forEach((type) => {
      expect(materialToHypothesis('players', 'CONFLICTING_FACT', player('Acme', type))).toBe(true);
    });
  });
  it('rounds is not material without a conflict', () => {
    expect(materialToHypothesis('rounds', 'VALIDATED_FACT', null)).toBe(false);
    expect(materialToHypothesis('rounds', 'PARTIAL_FACT', null)).toBe(false);
  });
  it('rounds becomes material under CONFLICTING_FACT', () => {
    expect(materialToHypothesis('rounds', 'CONFLICTING_FACT', null)).toBe(true);
  });
});

describe('computeInsightConfidence', () => {
  it('maps fact status to the calculated verdict confidence', () => {
    expect(computeInsightConfidence('VALIDATED_FACT')).toBe('high');
    expect(computeInsightConfidence('PARTIAL_FACT')).toBe('medium');
    expect(computeInsightConfidence('CONFLICTING_FACT')).toBe('low');
  });
});

describe('classifyNumericDelta', () => {
  it('is null when the founder declared nothing', () => {
    expect(classifyNumericDelta(null, 1_000_000)).toBeNull();
  });
  it('is VALUE_SUPPORTED within the threshold', () => {
    expect(classifyNumericDelta(1_000_000, 1_100_000)).toBe('VALUE_SUPPORTED'); // 10% apart
  });
  it('is exactly at the threshold boundary -> still VALUE_SUPPORTED (<=)', () => {
    const founder = 1_000_000;
    const evidence = founder * (1 + FOUNDER_DEVIATION_THRESHOLD_PCT);
    expect(classifyNumericDelta(founder, evidence)).toBe('VALUE_SUPPORTED');
  });
  it('is VALUE_ABOVE_EVIDENCE when the founder claimed more than the evidence, beyond the threshold', () => {
    expect(classifyNumericDelta(1_400_000, 1_000_000)).toBe('VALUE_ABOVE_EVIDENCE'); // 40% apart
  });
  it('is VALUE_BELOW_EVIDENCE when the founder claimed less than the evidence, beyond the threshold', () => {
    expect(classifyNumericDelta(1_000_000, 1_400_000)).toBe('VALUE_BELOW_EVIDENCE');
  });
});

// §E's eight required computeVerdict cases, lettered to match the prompt.
describe('computeVerdict', () => {
  it('(a) sizing with no founder value -> DISCOVERED, promotedToInsight=false', () => {
    const v = computeVerdict('sizing', 'VALIDATED_FACT', sizing(2e9), NO_FOUNDER);
    expect(v).toEqual({ changeClass: 'DISCOVERED', deltaType: null, comparisonBaseline: 'MARKET_THESIS', implication: null, insightConfidence: 'high', promotedToInsight: false });
  });

  it('(b) sizing with founder within the threshold -> CONFIRMED, promotedToInsight=true', () => {
    const founder: FounderBaseline = { ...NO_FOUNDER, sizingValueEur: 2e9 };
    const v = computeVerdict('sizing', 'VALIDATED_FACT', sizing(2.1e9), founder);
    expect(v?.changeClass).toBe('CONFIRMED');
    expect(v?.deltaType).toBe('VALUE_SUPPORTED');
    expect(v?.promotedToInsight).toBe(true);
    expect(v?.comparisonBaseline).toBe('FOUNDER_CLAIM');
  });

  it('(c) sizing with founder 40% above the evidence -> CHALLENGED/VALUE_ABOVE_EVIDENCE, promotedToInsight=true', () => {
    const founder: FounderBaseline = { ...NO_FOUNDER, sizingValueEur: 1.4e9 };
    const v = computeVerdict('sizing', 'VALIDATED_FACT', sizing(1e9), founder);
    expect(v?.changeClass).toBe('CHALLENGED');
    expect(v?.deltaType).toBe('VALUE_ABOVE_EVIDENCE');
    expect(v?.promotedToInsight).toBe(true);
    expect(v?.implication?.direction).toBe('REVISES_ESTIMATE');
  });

  it('(d) players, name already in knownCompetitorNames -> CONFIRMED, promotedToInsight=false', () => {
    const founder: FounderBaseline = { ...NO_FOUNDER, knownCompetitorNames: ['acme'] };
    const v = computeVerdict('players', 'VALIDATED_FACT', player('Acme', 'DIRECT'), founder);
    expect(v).toEqual({ changeClass: 'CONFIRMED', deltaType: null, comparisonBaseline: 'FOUNDER_CLAIM', implication: null, insightConfidence: 'high', promotedToInsight: false });
  });

  it('(e) players, new name, sherlockClassification=DIRECT -> DISCOVERED/NEW_COMPETITOR, promotedToInsight=true', () => {
    const v = computeVerdict('players', 'VALIDATED_FACT', player('Rival Inc', 'DIRECT'), NO_FOUNDER);
    expect(v?.changeClass).toBe('DISCOVERED');
    expect(v?.deltaType).toBe('NEW_COMPETITOR');
    expect(v?.promotedToInsight).toBe(true);
    expect(v?.implication?.scope).toBe('COMPETITION');
    expect(v?.implication?.code).toBe('DIRECT_COMPETITOR_DISCOVERED');
  });

  it('(f) players, new name, sherlockClassification=BUDGET -> material=false -> DISCOVERED with implication=null, promotedToInsight=false', () => {
    const v = computeVerdict('players', 'VALIDATED_FACT', player('Some Budget Co', 'BUDGET'), NO_FOUNDER);
    expect(v).toEqual({ changeClass: 'DISCOVERED', deltaType: null, comparisonBaseline: 'MARKET_THESIS', implication: null, insightConfidence: 'high', promotedToInsight: false });
  });

  it('(g) any section with factStatus=CONFLICTING_FACT and material=true -> UNRESOLVED/SOURCE_CONFLICT, promotedToInsight=true', () => {
    const v = computeVerdict('sizing', 'CONFLICTING_FACT', sizing(2e9), NO_FOUNDER);
    expect(v?.changeClass).toBe('UNRESOLVED');
    expect(v?.deltaType).toBe('SOURCE_CONFLICT');
    expect(v?.promotedToInsight).toBe(true);
    expect(v?.implication).not.toBeNull();
  });

  it('(h) factStatus=INSUFFICIENT_FACT -> computeVerdict returns null', () => {
    expect(computeVerdict('sizing', 'INSUFFICIENT_FACT', sizing(2e9), NO_FOUNDER)).toBeNull();
  });

  // Extra coverage beyond the required letter cases.
  it('growth: no founder value -> DISCOVERED', () => {
    const v = computeVerdict('growth', 'VALIDATED_FACT', { pct: 30, periodYears: 5, segment: null }, NO_FOUNDER);
    expect(v?.changeClass).toBe('DISCOVERED');
    expect(v?.promotedToInsight).toBe(false);
  });

  it('growth: challenged by evidence -> CHALLENGED/VALUE_BELOW_EVIDENCE', () => {
    const founder: FounderBaseline = { ...NO_FOUNDER, growthPct: 10 };
    const v = computeVerdict('growth', 'VALIDATED_FACT', { pct: 30, periodYears: 5, segment: null }, founder);
    expect(v?.changeClass).toBe('CHALLENGED');
    expect(v?.deltaType).toBe('VALUE_BELOW_EVIDENCE');
    expect(v?.implication?.scope).toBe('GROWTH');
  });

  it('rounds, non-conflict -> null verdict object shape is the generic not-material DISCOVERED (never a rounds-specific branch)', () => {
    const v = computeVerdict('rounds', 'VALIDATED_FACT', null, NO_FOUNDER);
    expect(v).toEqual({ changeClass: 'DISCOVERED', deltaType: null, comparisonBaseline: 'MARKET_THESIS', implication: null, insightConfidence: 'high', promotedToInsight: false });
  });

  it('a conflicting players item still carries the COMPETITION scope, not the section default', () => {
    const v = computeVerdict('players', 'CONFLICTING_FACT', player('Acme', 'DIRECT'), NO_FOUNDER);
    expect(v?.implication?.scope).toBe('COMPETITION');
  });
});
