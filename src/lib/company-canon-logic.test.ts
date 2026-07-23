import { describe, expect, it } from 'vitest';
import { computeAlignment, computeCanonDelta, evaluateProvenanceGate, type ComposerDraftWithClaims } from './company-canon-logic';
import type { CompanyFact, Entity } from './types';

function fact(overrides: Partial<CompanyFact> & { id: string }): CompanyFact {
  return {
    category: 'other', statement: 'x', status: 'confirmed', source: 'user',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function entity(overrides: Partial<Entity> & { id: string }): Entity {
  return {
    name: overrides.id, type: 'vc', invests_in_geographies: [], website_verified: false,
    email_domain_verified: false, sectors: [], submission_channel_type: 'unknown',
    hard_filter_status: 'not_applicable', status: 'not_contacted',
    ...overrides,
  };
}

describe('evaluateProvenanceGate (§11b)', () => {
  const confirmed = new Set(['fact-1', 'fact-2']);

  it('grounds a draft where every claim maps to a confirmed fact', () => {
    const draft: ComposerDraftWithClaims = {
      subject: '', body: 'x', rationale: '', confidence: 0.8,
      claims: [{ text: 'a', factId: 'fact-1' }, { text: 'b', factId: 'fact-2' }],
    };
    const result = evaluateProvenanceGate(draft, confirmed);
    expect(result.grounded).toBe(true);
    expect(result.ungroundedClaims).toHaveLength(0);
    expect(result.pendingQuestions).toHaveLength(0);
  });

  it('blocks a draft with any needs_confirmation claim, even if others are grounded', () => {
    const draft: ComposerDraftWithClaims = {
      subject: '', body: 'x', rationale: '', confidence: 0.8,
      claims: [
        { text: 'a', factId: 'fact-1' },
        { text: 'b', needsConfirmation: { question: 'What is the current tranche size?', options: ['€300k', '€500k'] } },
      ],
    };
    const result = evaluateProvenanceGate(draft, confirmed);
    expect(result.grounded).toBe(false);
    expect(result.pendingQuestions).toHaveLength(1);
  });

  it('treats a factId not in the confirmed set as ungrounded, not trusted', () => {
    const draft: ComposerDraftWithClaims = {
      subject: '', body: 'x', rationale: '', confidence: 0.8,
      claims: [{ text: 'a', factId: 'fact-invented-by-model' }],
    };
    const result = evaluateProvenanceGate(draft, confirmed);
    expect(result.grounded).toBe(false);
    expect(result.ungroundedClaims).toHaveLength(1);
  });

  it('treats a claim with neither factId nor needsConfirmation as ungrounded', () => {
    const draft: ComposerDraftWithClaims = {
      subject: '', body: 'x', rationale: '', confidence: 0.8,
      claims: [{ text: 'bioFET passive cortisol capture' }],
    };
    const result = evaluateProvenanceGate(draft, confirmed);
    expect(result.grounded).toBe(false);
    expect(result.ungroundedClaims).toHaveLength(1);
  });

  it('grounds a draft with zero claims (nothing asserted, nothing to confirm)', () => {
    const draft: ComposerDraftWithClaims = { subject: '', body: 'x', rationale: '', confidence: 0.8, claims: [] };
    expect(evaluateProvenanceGate(draft, confirmed).grounded).toBe(true);
  });
});

describe('computeCanonDelta (§11c)', () => {
  it('finds facts superseded and facts newly confirmed after a given date', () => {
    const facts: CompanyFact[] = [
      fact({ id: 'f1', status: 'deprecated', updated_at: '2026-06-01T00:00:00Z' }), // after cutoff
      fact({ id: 'f2', status: 'deprecated', updated_at: '2025-01-01T00:00:00Z' }), // before cutoff
      fact({ id: 'f3', status: 'confirmed', valid_from: '2026-06-15', created_at: '2026-06-15T00:00:00Z' }), // after cutoff
      fact({ id: 'f4', status: 'confirmed', valid_from: '2024-01-01', created_at: '2024-01-01T00:00:00Z' }), // before cutoff
    ];
    const delta = computeCanonDelta(facts, '2026-03-01');
    expect(delta.supersededSinceDate.map((f) => f.id)).toEqual(['f1']);
    expect(delta.newSinceDate.map((f) => f.id)).toEqual(['f3']);
  });

  it('is exactly the reported real case: health/hardware pass superseded by wellness/biosphere repositioning', () => {
    const facts: CompanyFact[] = [
      fact({ id: 'old-positioning', category: 'positioning', status: 'deprecated', statement: 'Medical device for CKD monitoring', updated_at: '2026-02-01T00:00:00Z' }),
      fact({ id: 'new-positioning', category: 'positioning', status: 'confirmed', statement: 'Wellness/biosphere device, not a medical device', valid_from: '2026-02-01', created_at: '2026-02-01T00:00:00Z' }),
    ];
    const delta = computeCanonDelta(facts, '2024-01-01'); // "since last contact" (a 2022/2024 pass)
    expect(delta.supersededSinceDate).toHaveLength(1);
    expect(delta.newSinceDate).toHaveLength(1);
    expect(delta.newSinceDate[0].statement).toContain('Wellness');
  });
});

describe('computeAlignment (§11d)', () => {
  it('flags misaligned when the round is below the fund minimum cheque', () => {
    const e = entity({ id: 'e1', check_min_eur: 2_000_000, check_max_eur: 5_000_000 });
    const facts: CompanyFact[] = [fact({ id: 'f1', category: 'financing', statement: 'Seed €1.3M phased; first tranche €300k' })];
    const verdict = computeAlignment(e, facts);
    expect(verdict.status).toBe('misaligned');
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it('flags misaligned when the round exceeds the fund maximum cheque', () => {
    const e = entity({ id: 'e1', check_min_eur: 25_000, check_max_eur: 250_000 });
    const facts: CompanyFact[] = [fact({ id: 'f1', category: 'financing', statement: 'Seed €1.3M phased; first tranche €300k' })];
    const verdict = computeAlignment(e, facts);
    expect(verdict.status).toBe('misaligned');
  });

  it('flags misaligned on a hardware-avoidant fund when canon is still hardware-framed', () => {
    const e = entity({ id: 'e1', hardware_stance: 'no hardware/wellness only' });
    const facts: CompanyFact[] = [fact({ id: 'f1', category: 'positioning', statement: 'A medical device for cardio-intestinal monitoring' })];
    const verdict = computeAlignment(e, facts);
    expect(verdict.status).toBe('misaligned');
  });

  it('is aligned when the round fits the cheque range and there is no positioning conflict', () => {
    const e = entity({ id: 'e1', check_min_eur: 100_000, check_max_eur: 2_000_000 });
    const facts: CompanyFact[] = [
      fact({ id: 'f1', category: 'financing', statement: 'Seed €1.3M phased; first tranche €300k' }),
      fact({ id: 'f2', category: 'positioning', statement: 'Wellness device, not a medical device' }),
    ];
    const verdict = computeAlignment(e, facts);
    expect(verdict.status).toBe('aligned');
    expect(verdict.reasons).toHaveLength(0);
  });

  it('is aligned (not caution/misaligned) when there is simply no canon to compare against', () => {
    const e = entity({ id: 'e1', check_min_eur: 100_000, check_max_eur: 2_000_000 });
    const verdict = computeAlignment(e, []);
    expect(verdict.status).toBe('aligned');
  });
});
