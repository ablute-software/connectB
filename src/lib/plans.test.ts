import { describe, expect, it } from 'vitest';
import {
  PLANS, PLAN_TIERS, normalizePlan, planIsPaid, planName, planEntitlements,
  planPriceLabel, planRow, encodePlanRequest, parsePlanRequest,
} from './plans';

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

// Prompt 123 §B.1 replaced the 3 cards' copy in full, per "Correção Cards
// Planos.md" — the old strict "garage bullets = idea bullets + new ones, in
// the same order" invariant (Prompt 113 §4 step 6) no longer holds by
// design: several lines are TIER-SPECIFIC REPLACEMENTS, not pure additions
// (seats: 1/2/5 users; Investor Pipeline's own numbers; Preset vs
// Customizable Vault). What still has to hold: the features that genuinely
// don't change per tier keep appearing verbatim at every tier above their
// introduction.
describe('plan bullets — shared features persist across tiers (Prompt 123 §B.1)', () => {
  const CARRIED_FORWARD = [
    'Smart Calendar',
    'Protected Outreach (Linting, Volume Caps & Contact Locks)',
    'Actionable Review Queue',
    'Bulk Investor Import',
    'NDA-protected document sharing',
  ];

  it('every unchanging feature bullet appears in all three tiers', () => {
    for (const tier of PLAN_TIERS) {
      const bullets = planRow(tier).bullets;
      for (const line of CARRIED_FORWARD) expect(bullets).toContain(line);
    }
  });

  it('each tier states its own seat count', () => {
    expect(planRow('idea').bullets).toContain('1 User (Owner)');
    expect(planRow('garage').bullets).toContain('2 users');
    expect(planRow('motherfunding').bullets).toContain('5 users');
  });

  it('each tier has its own Investor Pipeline bullet with its own numbers', () => {
    for (const tier of PLAN_TIERS) {
      expect(planRow(tier).bullets.some((b) => b.startsWith('Investor Pipeline'))).toBe(true);
    }
    expect(planRow('idea').bullets.find((b) => b.startsWith('Investor Pipeline'))).toContain('5 investors');
    expect(planRow('garage').bullets.find((b) => b.startsWith('Investor Pipeline'))).toContain('10 investors');
    expect(planRow('motherfunding').bullets.find((b) => b.startsWith('Investor Pipeline'))).toContain('25 investors');
  });

  // Flagged discrepancy (see plans.ts's own comment on the idea tier): the
  // doc's Elementary card has no MatchDeal line at all, while List of
  // Suspects introduces "Access to MatchDeal" as something NEW — even
  // though idea-tier orgs already have real MATCHDEAL_WEEKLY.idea access at
  // the entitlement layer. This test pins the CARD COPY as currently
  // authored, not a claim that the underlying access matches.
  it('only garage and motherfunding advertise a MatchDeal bullet in copy', () => {
    expect(planRow('idea').bullets.some((b) => b.startsWith('Access to MatchDeal'))).toBe(false);
    expect(planRow('garage').bullets.some((b) => b.startsWith('Access to MatchDeal'))).toBe(true);
    expect(planRow('motherfunding').bullets.some((b) => b.startsWith('Access to MatchDeal'))).toBe(true);
  });

  // Prompt 158 — promoted out of `comingSoon` into real bullets on both
  // paid tiers (Nuno confirmed 10/08 they'll be ready by launch). Prompt
  // 160 (same day) opened the underlying entitlement to match — see the
  // 'planEntitlements' describe block above for that behavior; this test
  // only pins the card copy.
  it('Review & Optimization and Investability Reports are live bullets, not comingSoon, on paid tiers', () => {
    for (const tier of ['garage', 'motherfunding'] as const) {
      const row = planRow(tier);
      expect(row.bullets).toContain('Advanced Review & Optimization');
      expect(row.bullets).toContain('Investability reports');
      expect(row.comingSoon ?? []).toEqual([]);
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
