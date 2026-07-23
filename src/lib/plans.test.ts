import { describe, expect, it } from 'vitest';
import {
  PLANS, PLAN_TIERS, normalizePlan, planIsPaid, planName, planEntitlements,
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
    expect(planName('idea')).toBe('Mom, I have an idea');
    expect(planName('garage')).toBe("Dad, I'm leaving the garage");
    expect(planName('motherfunding')).toBe('Motherfunding');
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
