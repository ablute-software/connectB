import { describe, expect, it } from 'vitest';
import {
  PLANS, PLAN_TIERS, normalizePlan, planIsPaid, planName, planEntitlements,
  planPriceLabel, planRow, encodePlanRequest, parsePlanRequest, buildPlanSections,
} from './plans';
import type { PlanCardSection } from '@/components/plans/types';

describe('normalizePlan (legacy mapping)', () => {
  it('maps legacy free -> idea', () => {
    expect(normalizePlan('free')).toBe('idea');
  });

  it('maps legacy paid -> garage', () => {
    expect(normalizePlan('paid')).toBe('garage');
  });

  it('passes through the three valid tiers unchanged', () => {
    expect(normalizePlan('idea')).toBe('idea');
    expect(normalizePlan('garage')).toBe('garage');
    expect(normalizePlan('motherfunding')).toBe('motherfunding');
  });

  it('falls back to idea for null/undefined/unknown', () => {
    expect(normalizePlan(null)).toBe('idea');
    expect(normalizePlan(undefined)).toBe('idea');
    expect(normalizePlan('enterprise')).toBe('idea');
    expect(normalizePlan('')).toBe('idea');
  });
});

describe('plan metadata', () => {
  it('has exactly the three tiers, in order', () => {
    expect(PLAN_TIERS).toEqual(['idea', 'garage', 'motherfunding']);
    expect(PLANS.map((p) => p.tier)).toEqual(['idea', 'garage', 'motherfunding']);
  });

  it('keeps the founder-verbatim names', () => {
    expect(planName('idea')).toBe('Elementary, my dear');
    expect(planName('garage')).toBe('List of Suspects');
    expect(planName('motherfunding')).toBe("It's the butler!");
  });

  it('only idea is free', () => {
    expect(planIsPaid('idea')).toBe(false);
    expect(planIsPaid('garage')).toBe(true);
    expect(planIsPaid('motherfunding')).toBe(true);
  });
});

describe('planEntitlements (C — plan-gate resolution)', () => {
  it('free plan (idea) does NOT get the AI composer', () => {
    expect(planEntitlements('idea', false).aiComposer).toBe(false);
  });

  it('paid plans get the AI composer', () => {
    expect(planEntitlements('garage', false).aiComposer).toBe(true);
    expect(planEntitlements('motherfunding', false).aiComposer).toBe(true);
  });

  it('platform org gets the AI composer regardless of plan', () => {
    // Even on the free tier, the platform org bypasses the gate.
    expect(planEntitlements('idea', true).aiComposer).toBe(true);
  });

  // Prompt 160 (10/08) — opened for both paid plans, same pattern as
  // aiComposer; free ('idea') stays frosted, the plan card never promised
  // this there.
  it('Review & Optimization is open on both paid plans, frosted only on the free plan', () => {
    expect(planEntitlements('idea', false).reviewOptimization).toBe(false);
    expect(planEntitlements('garage', false).reviewOptimization).toBe(true);
    expect(planEntitlements('motherfunding', false).reviewOptimization).toBe(true);
    expect(planEntitlements('idea', true).reviewOptimization).toBe(true); // ablute_ bypasses regardless of plan
  });

  it('reviewTopTierTools (Prompt 117 Bloco G) is motherfunding-only among customer plans', () => {
    expect(planEntitlements('idea', false).reviewTopTierTools).toBe(false);
    expect(planEntitlements('garage', false).reviewTopTierTools).toBe(false);
    expect(planEntitlements('motherfunding', false).reviewTopTierTools).toBe(true);
  });

  it('platform org gets reviewTopTierTools regardless of plan', () => {
    expect(planEntitlements('idea', true).reviewTopTierTools).toBe(true);
  });
});

describe('planPriceLabel (Monthly/Annual toggle mapping)', () => {
  it('garage: monthly €85, annual €756/year equivalence', () => {
    expect(planPriceLabel(planRow('garage'), 'monthly')).toBe('€85/month');
    expect(planPriceLabel(planRow('garage'), 'annual')).toBe('€756/year (equivalent to €63/month)');
  });

  it('motherfunding: monthly €149, annual €1,308/year equivalence', () => {
    expect(planPriceLabel(planRow('motherfunding'), 'monthly')).toBe('€149/month');
    expect(planPriceLabel(planRow('motherfunding'), 'annual')).toBe('€1,308/year (equivalent to €109/month)');
  });

  it('free (idea) is €0 regardless of period (no annual → falls back to monthly)', () => {
    expect(planPriceLabel(planRow('idea'), 'monthly')).toBe('€0');
    expect(planPriceLabel(planRow('idea'), 'annual')).toBe('€0');
  });
});

// Prompt 749 replaced the 3 cards' copy in full — each tier's card now
// states its own COMPLETE, independent feature list via buildPlanSections()
// rather than a cumulative bullets array. What still has to hold: the
// features that genuinely don't change per tier keep appearing verbatim at
// every tier, and each tier's own numbers (seats, MatchDeal, AI credits)
// are its own.
describe('buildPlanSections — shared features persist across tiers (Prompt 749)', () => {
  const CARRIED_FORWARD = [
    'Smart Calendar',
    'Vault Data Room with access control',
    'Protected Outreach (Linting, Volume Caps & Contact Locks)',
    'Actionable Review Queue',
    'Bulk Investor Import',
    'NDA-protected document sharing',
  ];

  function titles(tier: (typeof PLAN_TIERS)[number]): string[] {
    return buildPlanSections(tier, null).map((s) => s.title);
  }

  it('every unchanging feature line appears in all three tiers', () => {
    for (const tier of PLAN_TIERS) {
      const t = titles(tier);
      for (const line of CARRIED_FORWARD) expect(t).toContain(line);
    }
  });

  it('each tier states its own seat count', () => {
    expect(titles('idea')).toContain('1 user');
    expect(titles('garage')).toContain('2 users');
    expect(titles('motherfunding')).toContain('5 users');
  });

  it('each tier has its own MatchDeal line with its own numbers', () => {
    expect(titles('idea').find((t) => t.startsWith('MatchDeal'))).toBe('MatchDeal: 3 new investors per week · 1 Swipe Right per week');
    expect(titles('garage').find((t) => t.startsWith('MatchDeal'))).toBe('MatchDeal: 10 new investors per week · 5 Swipe Rights per week · 2 Reconsiderations per week');
    expect(titles('motherfunding').find((t) => t.startsWith('MatchDeal'))).toBe('MatchDeal: 20 new investors per week · 10 Swipe Rights per week · Unlimited Reconsiderations until you use the 10 weekly Swipe Rights');
  });

  it('the AI-credits number is live, not hardcoded — null renders no number, a real number is interpolated', () => {
    expect(titles('garage')).toContain('AI credits included');
    expect(buildPlanSections('garage', 90).map((s) => s.title)).toContain('90 AI credits / month');
  });

  it('every tier advertises a curated-pipeline section with its own monthly-addition number', () => {
    const pipelineItems = (tier: (typeof PLAN_TIERS)[number]) =>
      buildPlanSections(tier, null).find((s) => s.title === 'Curated pipeline*')?.items.map((i) => i.text) ?? [];
    expect(pipelineItems('idea')).toContain('Up to 10 new curated investors / month*');
    expect(pipelineItems('garage')).toContain('Up to 25 new curated investors / month*');
    expect(pipelineItems('motherfunding')).toContain('Up to 50 new curated investors / month*');
  });

  // Prompt 749 — exact per-tier AI-action item count, per the prompt's own
  // spec: idea=3 (Pitch Blueprint assistant, Company & team research, Market
  // & document intelligence), garage=6 (+AI outreach drafts, Advanced Review
  // & Optimization, Investability reports), motherfunding=8 (+Market data
  // research, Find contradictions across documents).
  it('AI section lists exactly 3/6/8 items for idea/garage/motherfunding', () => {
    const aiItemCount = (tier: (typeof PLAN_TIERS)[number]) =>
      buildPlanSections(tier, null).find((s) => s.enforcedBy === 'ai-credits-wallet')?.items.length ?? -1;
    expect(aiItemCount('idea')).toBe(3);
    expect(aiItemCount('garage')).toBe(6);
    expect(aiItemCount('motherfunding')).toBe(8);
  });

  // Prompt 749 audit — six lines removed because no code backs them at all
  // (see plans.ts's own header comment on buildPlanSections for the full
  // per-line account): no more cumulative "Everything in X, plus" framing,
  // no fake reprioritization/follow-up/re-engagement/fundraising-round
  // claims, and no dead WATSON_DRAFT_QUOTA-derived bullet.
  it('never claims a capability with no code behind it', () => {
    const FORBIDDEN = [
      'Everything in',
      'reprioritization',
      'follow-up for up to',
      'fundraising round',
      're-engagement',
      'AI-personalized outreach drafts and reviews per month',
    ];
    for (const tier of PLAN_TIERS) {
      const allText = buildPlanSections(tier, 100)
        .flatMap((s: PlanCardSection) => [s.title, s.note ?? '', ...s.items.map((i) => i.text)])
        .join(' | ');
      for (const phrase of FORBIDDEN) expect(allText).not.toContain(phrase);
    }
  });

  it('every section and item declares enforcedBy (required field — this is also a compile-time check)', () => {
    for (const tier of PLAN_TIERS) {
      for (const s of buildPlanSections(tier, 100)) {
        expect(s.enforcedBy).toBeTruthy();
        for (const item of s.items) expect(item.enforcedBy).toBeTruthy();
      }
    }
  });
});

describe('plan-change request period encoding (no-migration)', () => {
  it('encodes annual with a suffix and monthly as a bare tier', () => {
    expect(encodePlanRequest('garage', 'annual')).toBe('garage@annual');
    expect(encodePlanRequest('garage', 'monthly')).toBe('garage');
  });

  it('round-trips through parse', () => {
    expect(parsePlanRequest(encodePlanRequest('motherfunding', 'annual'))).toEqual({ tier: 'motherfunding', period: 'annual' });
    expect(parsePlanRequest(encodePlanRequest('garage', 'monthly'))).toEqual({ tier: 'garage', period: 'monthly' });
  });

  it('is back-compatible with legacy bare-tier rows (monthly)', () => {
    expect(parsePlanRequest('garage')).toEqual({ tier: 'garage', period: 'monthly' });
  });

  it('maps legacy free/paid + null through normalizePlan', () => {
    expect(parsePlanRequest('paid')).toEqual({ tier: 'garage', period: 'monthly' });
    expect(parsePlanRequest('free@annual')).toEqual({ tier: 'idea', period: 'annual' });
    expect(parsePlanRequest(null)).toEqual({ tier: 'idea', period: 'monthly' });
  });
});
