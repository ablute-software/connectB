import { describe, expect, it } from 'vitest';
import { isPioneerBadgeDue, buildReferralCodeDrafts, PIONEER_REFERRAL_CODE_COUNT, PIONEER_REFERRAL_VALIDITY_MONTHS } from './pioneer';

describe('isPioneerBadgeDue', () => {
  const now = new Date('2026-08-12T00:00:00Z');

  it('is false when the promo is not a pioneer code', () => {
    expect(isPioneerBadgeDue(false, '2026-08-01T00:00:00Z', now)).toBe(false);
  });
  it('is false when the benefit has no expiry (permanent redemption)', () => {
    expect(isPioneerBadgeDue(true, null, now)).toBe(false);
  });
  it('is false while the benefit is still in the future', () => {
    expect(isPioneerBadgeDue(true, '2026-09-01T00:00:00Z', now)).toBe(false);
  });
  it('is true once the benefit has expired', () => {
    expect(isPioneerBadgeDue(true, '2026-08-01T00:00:00Z', now)).toBe(true);
  });
  it('is true at the exact expiry instant', () => {
    expect(isPioneerBadgeDue(true, now.toISOString(), now)).toBe(true);
  });
});

describe('buildReferralCodeDrafts', () => {
  it('builds exactly PIONEER_REFERRAL_CODE_COUNT drafts', () => {
    const drafts = buildReferralCodeDrafts('org-1', ['garage'], () => 'CODE1');
    expect(drafts).toHaveLength(PIONEER_REFERRAL_CODE_COUNT);
  });
  it('each draft is a 100%-off, single-redemption, pioneer-tagged code attributed to the org', () => {
    const drafts = buildReferralCodeDrafts('org-1', ['motherfunding'], () => 'CODEX');
    for (const d of drafts) {
      expect(d.discount_pct).toBe(100);
      expect(d.kind).toBe('free_trial');
      expect(d.max_redemptions).toBe(1);
      expect(d.is_pioneer).toBe(true);
      expect(d.referral_of_org_id).toBe('org-1');
      expect(d.applicable_plans).toEqual(['motherfunding']);
      expect(d.benefit_duration_months).toBe(PIONEER_REFERRAL_VALIDITY_MONTHS);
    }
  });
  it('falls back to garage when the originating promo somehow covered no plans', () => {
    const drafts = buildReferralCodeDrafts('org-1', [], () => 'CODEY');
    expect(drafts[0].applicable_plans).toEqual(['garage']);
  });
  it('calls the injected generator once per code, never Math.random directly', () => {
    let calls = 0;
    const drafts = buildReferralCodeDrafts('org-1', ['garage'], () => { calls += 1; return `C${calls}`; });
    expect(calls).toBe(PIONEER_REFERRAL_CODE_COUNT);
    expect(new Set(drafts.map((d) => d.code)).size).toBe(PIONEER_REFERRAL_CODE_COUNT);
  });
});
