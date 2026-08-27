// Prompt 411 §C.5 — engine tests: caps (confirmed vs unverified),
// coverage with skips/stage-exclusion, not_material, confidence-band
// thresholds, each contradiction rule firing and NOT firing.
import { describe, expect, it } from 'vitest';
import {
  applicableQuestions, computeAxisResult, confidenceBand, crossAxisContradictions,
  type BarsAnswerRecord, type BarsAxisStateRecord, type BarsFlagStateRecord,
} from './bars-scoring';
import { TEAM_V1 } from '../content/bars/team_v1';
import { MARKET_V1 } from '../content/bars/market_v1';
import { PRODUCT_V1 } from '../content/bars/product_v1';
import { TECHNOLOGY_V1 } from '../content/bars/technology_v1';
import type { BarsBank } from './bars-types';

// A tiny synthetic bank keeps these tests independent of the real content
// banks' exact question counts/subdimensions — only the cross-axis-rule
// and content-integrity tests need the real banks.
const TEST_BANK: BarsBank = {
  axis: 'team',
  version: 'test_v1',
  questions: [
    { id: 'team.q1', axis: 'team', subdimension: 'A', stages: ['concept_idea', 'prototype', 'pilot', 'launch_early_adopters', 'growth'], question: 'Q1?', anchors: { l1: 'a', l3: 'b', l5: 'c' }, evidenceHints: ['claim'], why: 'w' },
    { id: 'team.q2', axis: 'team', subdimension: 'A', stages: ['concept_idea', 'prototype', 'pilot', 'launch_early_adopters', 'growth'], question: 'Q2?', anchors: { l1: 'a', l3: 'b', l5: 'c' }, evidenceHints: ['claim'], why: 'w' },
    { id: 'team.q3', axis: 'team', subdimension: 'B', stages: ['pilot', 'launch_early_adopters', 'growth'], question: 'Q3?', anchors: { l1: 'a', l3: 'b', l5: 'c' }, evidenceHints: ['claim'], why: 'w' },
  ],
  redFlags: [
    { id: 'team.rf_low_cap', axis: 'team', check: 'low cap', capLevel: 2 },
    { id: 'team.rf_mid_cap', axis: 'team', check: 'mid cap', capLevel: 3 },
  ],
};

function answer(questionId: string, level: number | null, opts: Partial<BarsAnswerRecord> = {}): BarsAnswerRecord {
  return { questionId, level, skipped: false, evidenceRefs: [], ...opts };
}

describe('applicableQuestions', () => {
  it('excludes questions whose stages do not include the given phase', () => {
    expect(applicableQuestions(TEST_BANK, 'concept_idea').map((q) => q.id)).toEqual(['team.q1', 'team.q2']);
    expect(applicableQuestions(TEST_BANK, 'pilot').map((q) => q.id)).toEqual(['team.q1', 'team.q2', 'team.q3']);
  });
});

describe('computeAxisResult — score and coverage', () => {
  it('scores the mean of answered levels only, never counting skipped', () => {
    const answers = [answer('team.q1', 4), answer('team.q2', 2, { skipped: true, level: null })];
    const r = computeAxisResult(TEST_BANK, answers, [], null, 'concept_idea');
    expect(r.score).toBe(4);
    expect(r.answered).toBe(1);
    expect(r.applicable).toBe(2);
    expect(r.coverage).toBe(0.5);
  });

  it('excludes stage-inapplicable questions from the coverage denominator', () => {
    // q3 only applies from 'pilot' onward — at concept_idea it must not
    // count against coverage even though it has no answer.
    const answers = [answer('team.q1', 5), answer('team.q2', 5)];
    const r = computeAxisResult(TEST_BANK, answers, [], null, 'concept_idea');
    expect(r.applicable).toBe(2);
    expect(r.coverage).toBe(1);
  });

  it('score is null (never a fabricated average) when nothing is answered yet, but coverage is a real 0', () => {
    const r = computeAxisResult(TEST_BANK, [], [], null, 'concept_idea');
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });

  it('coverage is null (not 0) when the axis has zero applicable questions at this stage', () => {
    const emptyAtStageBank: BarsBank = {
      axis: 'team', version: 'test_v1',
      questions: [{ id: 'team.only', axis: 'team', subdimension: 'A', stages: ['growth'], question: 'Q?', anchors: { l1: 'a', l3: 'b', l5: 'c' }, evidenceHints: ['claim'], why: 'w' }],
      redFlags: [],
    };
    const r = computeAxisResult(emptyAtStageBank, [], [], null, 'concept_idea');
    expect(r.applicable).toBe(0);
    expect(r.coverage).toBeNull();
  });

  it('computes per-subdimension subscores independently', () => {
    const answers = [answer('team.q1', 2), answer('team.q2', 4), answer('team.q3', 5)];
    const r = computeAxisResult(TEST_BANK, answers, [], null, 'pilot');
    expect(r.subscores.A).toBe(3);
    expect(r.subscores.B).toBe(5);
  });
});

describe('computeAxisResult — red flag caps', () => {
  it('a CONFIRMED red flag caps the score at its capLevel', () => {
    const answers = [answer('team.q1', 5), answer('team.q2', 5)];
    const flags: BarsFlagStateRecord[] = [{ flagId: 'team.rf_low_cap', state: 'confirmed' }];
    const r = computeAxisResult(TEST_BANK, answers, flags, null, 'concept_idea');
    expect(r.score).toBe(2);
    expect(r.capApplied).toEqual({ flagId: 'team.rf_low_cap', capLevel: 2 });
  });

  it('an UNVERIFIED red flag never caps the score — Confirmed vs. Critical Unverified', () => {
    const answers = [answer('team.q1', 5), answer('team.q2', 5)];
    const flags: BarsFlagStateRecord[] = [{ flagId: 'team.rf_low_cap', state: 'unverified' }];
    const r = computeAxisResult(TEST_BANK, answers, flags, null, 'concept_idea');
    expect(r.score).toBe(5);
    expect(r.capApplied).toBeUndefined();
  });

  it('a CLEARED red flag never caps the score', () => {
    const answers = [answer('team.q1', 5), answer('team.q2', 5)];
    const flags: BarsFlagStateRecord[] = [{ flagId: 'team.rf_low_cap', state: 'cleared' }];
    const r = computeAxisResult(TEST_BANK, answers, flags, null, 'concept_idea');
    expect(r.score).toBe(5);
    expect(r.capApplied).toBeUndefined();
  });

  it('with multiple confirmed flags, the SMALLEST capLevel wins', () => {
    const answers = [answer('team.q1', 5), answer('team.q2', 5)];
    const flags: BarsFlagStateRecord[] = [
      { flagId: 'team.rf_mid_cap', state: 'confirmed' },
      { flagId: 'team.rf_low_cap', state: 'confirmed' },
    ];
    const r = computeAxisResult(TEST_BANK, answers, flags, null, 'concept_idea');
    expect(r.score).toBe(2);
    expect(r.capApplied?.flagId).toBe('team.rf_low_cap');
  });

  it('a confirmed flag is reported even when it does not currently bind the raw score', () => {
    const answers = [answer('team.q1', 1), answer('team.q2', 1)];
    const flags: BarsFlagStateRecord[] = [{ flagId: 'team.rf_low_cap', state: 'confirmed' }];
    const r = computeAxisResult(TEST_BANK, answers, flags, null, 'concept_idea');
    expect(r.score).toBe(1);
    expect(r.capApplied).toEqual({ flagId: 'team.rf_low_cap', capLevel: 2 });
  });
});

describe('computeAxisResult — not_material', () => {
  it('nulls the whole axis result and never penalizes', () => {
    const answers = [answer('team.q1', 1), answer('team.q2', 1)];
    const flags: BarsFlagStateRecord[] = [{ flagId: 'team.rf_low_cap', state: 'confirmed' }];
    const axisState: BarsAxisStateRecord = { notMaterial: true };
    const r = computeAxisResult(TEST_BANK, answers, flags, axisState, 'concept_idea');
    expect(r.notMaterial).toBe(true);
    expect(r.score).toBeNull();
    expect(r.coverage).toBeNull();
    expect(r.confidenceBand).toBeNull();
    expect(r.capApplied).toBeUndefined();
    expect(r.subscores).toEqual({});
  });
});

describe('confidenceBand', () => {
  it('is low when nothing is answered', () => {
    expect(confidenceBand([])).toBe('low');
  });

  it('is low when answers carry no evidence at all', () => {
    const answers = [answer('team.q1', 5), answer('team.q2', 4)];
    expect(confidenceBand(answers)).toBe('low');
  });

  it('is high at exactly the 60% tier<=2 threshold', () => {
    const answers = [
      answer('team.q1', 5, { evidenceRefs: [{ kind: 'document' }] }),
      answer('team.q2', 5, { evidenceRefs: [{ kind: 'document' }] }),
      answer('team.q3', 5, { evidenceRefs: [{ kind: 'document' }] }),
      answer('team.q4', 5, { evidenceRefs: [{ kind: 'claim' }] }),
      answer('team.q5', 5, { evidenceRefs: [{ kind: 'claim' }] }),
    ];
    expect(confidenceBand(answers)).toBe('high');
  });

  it('is just below high (59%) -> moderate', () => {
    // 10 answers: 5 strong (document/interaction ~ tier<=2 would be 50%,
    // so use 5 strong + 4 weak + skip one to land under 60 but over 30.
    const strong = Array.from({ length: 5 }, (_, i) => answer(`team.s${i}`, 5, { evidenceRefs: [{ kind: 'document' as const }] }));
    const weak = Array.from({ length: 4 }, (_, i) => answer(`team.w${i}`, 5, { evidenceRefs: [{ kind: 'claim' as const }] }));
    expect(confidenceBand([...strong, ...weak])).toBe('moderate'); // 5/9 = 55.6%
  });

  it('is moderate at exactly the 30% threshold (3/10), below 60%', () => {
    const strong = Array.from({ length: 3 }, (_, i) => answer(`team.s${i}`, 5, { evidenceRefs: [{ kind: 'document' as const }] }));
    const weak = Array.from({ length: 7 }, (_, i) => answer(`team.w${i}`, 5, { evidenceRefs: [{ kind: 'claim' as const }] }));
    expect(confidenceBand([...strong, ...weak])).toBe('moderate');
  });

  it('is low just below the 30% threshold (2/10)', () => {
    const strong = Array.from({ length: 2 }, (_, i) => answer(`team.s${i}`, 5, { evidenceRefs: [{ kind: 'document' as const }] }));
    const weak = Array.from({ length: 8 }, (_, i) => answer(`team.w${i}`, 5, { evidenceRefs: [{ kind: 'claim' as const }] }));
    expect(confidenceBand([...strong, ...weak])).toBe('low');
  });

  it('interaction evidence (tier 1) counts as strong', () => {
    const answers = [answer('team.q1', 5, { evidenceRefs: [{ kind: 'interaction' }] })];
    expect(confidenceBand(answers)).toBe('high');
  });

  it('skipped answers are excluded from the denominator', () => {
    const answers = [
      answer('team.q1', 5, { evidenceRefs: [{ kind: 'document' }] }),
      answer('team.q2', null, { skipped: true }),
    ];
    expect(confidenceBand(answers)).toBe('high');
  });
});

describe('crossAxisContradictions', () => {
  it('fires urgency_vs_adoption when urgency=5 and adoption<=2', () => {
    const rules = crossAxisContradictions({}, { 'market.buyer_urgency': 5, 'product.adoption_engagement': 2 });
    expect(rules.map((r) => r.ruleId)).toContain('urgency_vs_adoption');
  });

  it('does NOT fire urgency_vs_adoption when adoption is above the threshold', () => {
    const rules = crossAxisContradictions({}, { 'market.buyer_urgency': 5, 'product.adoption_engagement': 3 });
    expect(rules.map((r) => r.ruleId)).not.toContain('urgency_vs_adoption');
  });

  it('does NOT fire when the high side is below 5', () => {
    const rules = crossAxisContradictions({}, { 'market.buyer_urgency': 4, 'product.adoption_engagement': 1 });
    expect(rules.map((r) => r.ruleId)).not.toContain('urgency_vs_adoption');
  });

  it('fires value_vs_pricing when value=5 and pricing<=1', () => {
    const rules = crossAxisContradictions({}, { 'product.value_delivered': 5, 'product.pricing_power': 1 });
    expect(rules.map((r) => r.ruleId)).toContain('value_vs_pricing');
  });

  it('fires tech_advantage_vs_differentiation when performance=5 and differentiation<=2', () => {
    const rules = crossAxisContradictions({}, { 'tech.performance_advantage': 5, 'market.differentiation_space': 1 });
    expect(rules.map((r) => r.ruleId)).toContain('tech_advantage_vs_differentiation');
  });

  it('fires market_growth_vs_traction when growth=5 and adoption<=1', () => {
    const rules = crossAxisContradictions({}, { 'market.growth_trajectory': 5, 'product.adoption_engagement': 1 });
    expect(rules.map((r) => r.ruleId)).toContain('market_growth_vs_traction');
  });

  it('fires retention_vs_switching_costs with the pull nuance, never a flat accusation', () => {
    const rules = crossAxisContradictions({}, { 'product.retention_stickiness': 5, 'product.switching_costs': 1 });
    const rule = rules.find((r) => r.ruleId === 'retention_vs_switching_costs');
    expect(rule).toBeDefined();
    expect(rule!.question.toLowerCase()).toContain('pull');
  });

  it('is silent when neither side of any rule is met', () => {
    const rules = crossAxisContradictions({}, { 'market.buyer_urgency': 3, 'product.adoption_engagement': 3 });
    expect(rules).toEqual([]);
  });

  it('skips a rule when either involved axis is marked not_material', () => {
    const rules = crossAxisContradictions(
      { technology: { notMaterial: true } },
      { 'tech.performance_advantage': 5, 'market.differentiation_space': 1 },
    );
    expect(rules.map((r) => r.ruleId)).not.toContain('tech_advantage_vs_differentiation');
  });

  it('ignores unanswered (undefined) questions', () => {
    const rules = crossAxisContradictions({}, { 'market.buyer_urgency': 5 });
    expect(rules).toEqual([]);
  });
});

describe('real content banks integrate cleanly with the engine', () => {
  it('computes a result for each real bank at every stage without throwing', () => {
    const stages = ['concept_idea', 'prototype', 'pilot', 'launch_early_adopters', 'growth'] as const;
    for (const bank of [TEAM_V1, MARKET_V1, PRODUCT_V1, TECHNOLOGY_V1]) {
      for (const stage of stages) {
        expect(() => computeAxisResult(bank, [], [], null, stage)).not.toThrow();
      }
    }
  });
});
