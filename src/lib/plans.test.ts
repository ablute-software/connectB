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

  it('Review & Optimization is parked (frosted) for every org, incl. platform', () => {
    expect(planEntitlements('idea', false).reviewOptimization).toBe(false);
    expect(planEntitlements('garage', false).reviewOptimization).toBe(false);
    expect(planEntitlements('motherfunding', false).reviewOptimization).toBe(false);
    expect(planEntitlements('motherfunding', true).reviewOptimization).toBe(false);
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

describe('plan bullets stay cumulative across tiers (Prompt 113 §4 step 6)', () => {
  // A few lines interpolate a per-tier NUMBER but are otherwise the same
  // promise (catalog quota, MatchDeal weekly limits, Watson draft quota) —
  // normalize those before comparing so the cumulative check isn't fooled
  // by an intentional number update (plans.ts's own "repeats are
  // intentional" rule).
  function normalize(bullet: string): string {
    return bullet
      .replace(/^\d+ investors unlocked/, 'N investors unlocked')
      .replace(/^MatchDeal — .*/, 'MatchDeal line')
      .replace(/^\d+ AI-written outreach drafts/, 'N AI-written outreach drafts');
  }

  it('garage carries every idea bullet, in order, before its own new ones', () => {
    const idea = planRow('idea').bullets.map(normalize);
    const garage = planRow('garage').bullets.map(normalize);
    expect(garage.slice(0, idea.length)).toEqual(idea);
    expect(garage.length).toBeGreaterThan(idea.length);
  });

  it('motherfunding carries every garage bullet, in order, before its own new ones', () => {
    const garage = planRow('garage').bullets.map(normalize);
    const motherfunding = planRow('motherfunding').bullets.map(normalize);
    expect(motherfunding.slice(0, garage.length)).toEqual(garage);
    expect(motherfunding.length).toBeGreaterThan(garage.length);
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
