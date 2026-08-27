// Prompt 411 §A.3 — content-integrity test for the four BARS banks: ids
// unique, every red-flag id well-formed, exact counts, no empty anchors.
import { describe, expect, it } from 'vitest';
import { TEAM_V1 } from './team_v1';
import { MARKET_V1 } from './market_v1';
import { PRODUCT_V1 } from './product_v1';
import { TECHNOLOGY_V1 } from './technology_v1';
import type { BarsBank } from '@/lib/bars-types';

const BANKS: { name: string; bank: BarsBank; questionCount: number; redFlagCount: number }[] = [
  { name: 'team', bank: TEAM_V1, questionCount: 11, redFlagCount: 4 },
  { name: 'market', bank: MARKET_V1, questionCount: 9, redFlagCount: 3 },
  { name: 'product', bank: PRODUCT_V1, questionCount: 10, redFlagCount: 3 },
  { name: 'technology', bank: TECHNOLOGY_V1, questionCount: 10, redFlagCount: 3 },
];

// The approved source content prefixes every Technology id with the
// abbreviated 'tech.' (e.g. 'tech.performance_advantage'), not
// 'technology.' — transcribed verbatim per 411 §A.1's "ids exatos".
// Team/Market/Product's id prefixes do match their axis name exactly.
const ID_PREFIX: Record<string, string> = { team: 'team', market: 'market', product: 'product', technology: 'tech' };

describe.each(BANKS)('$name bank', ({ bank, questionCount, redFlagCount }) => {
  it(`has exactly ${questionCount} questions and ${redFlagCount} red flags`, () => {
    expect(bank.questions).toHaveLength(questionCount);
    expect(bank.redFlags).toHaveLength(redFlagCount);
  });

  it('every question id is unique and carries this axis\'s id prefix', () => {
    const ids = bank.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(`${ID_PREFIX[bank.axis]}.`)).toBe(true);
  });

  it('every red flag id is unique and carries this axis\'s id prefix', () => {
    const ids = bank.redFlags.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(`${ID_PREFIX[bank.axis]}.`)).toBe(true);
  });

  it('no question has an empty question/anchor/why/subdimension', () => {
    for (const q of bank.questions) {
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(q.subdimension.trim().length).toBeGreaterThan(0);
      expect(q.why.trim().length).toBeGreaterThan(0);
      expect(q.anchors.l1.trim().length).toBeGreaterThan(0);
      expect(q.anchors.l3.trim().length).toBeGreaterThan(0);
      expect(q.anchors.l5.trim().length).toBeGreaterThan(0);
      if (q.anchors.l5b != null) expect(q.anchors.l5b.trim().length).toBeGreaterThan(0);
      expect(q.stages.length).toBeGreaterThan(0);
      expect(q.evidenceHints.length).toBeGreaterThan(0);
    }
  });

  it('no red flag has an empty check', () => {
    for (const f of bank.redFlags) {
      expect(f.check.trim().length).toBeGreaterThan(0);
      expect(f.capLevel).toBeGreaterThanOrEqual(1);
      expect(f.capLevel).toBeLessThanOrEqual(5);
    }
  });

  it('every question belongs to this bank\'s own axis', () => {
    for (const q of bank.questions) expect(q.axis).toBe(bank.axis);
    for (const f of bank.redFlags) expect(f.axis).toBe(bank.axis);
  });
});

describe('cross-axis contradiction rule question ids', () => {
  // bars-scoring.ts's CONTRADICTION_RULES hard-codes these 8 distinct
  // question ids (2 reused across rules 1/4) — this guards against a
  // silent rename in the content banks breaking the rule set without
  // either file's own tests catching it.
  const ALL_IDS = new Set([
    ...TEAM_V1.questions.map((q) => q.id),
    ...MARKET_V1.questions.map((q) => q.id),
    ...PRODUCT_V1.questions.map((q) => q.id),
    ...TECHNOLOGY_V1.questions.map((q) => q.id),
  ]);
  const REFERENCED = [
    'market.buyer_urgency', 'product.adoption_engagement', 'product.value_delivered',
    'product.pricing_power', 'tech.performance_advantage', 'market.differentiation_space',
    'market.growth_trajectory', 'product.retention_stickiness', 'product.switching_costs',
  ];

  it.each(REFERENCED)('%s exists in a content bank', (id) => {
    expect(ALL_IDS.has(id)).toBe(true);
  });
});
