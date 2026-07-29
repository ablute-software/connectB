import { describe, expect, it } from 'vitest';
import { isEligible, pickEligible, SESSION_COACHMARK_MAX, SESSION_MODAL_MAX, type OnboardingCtx } from './engine';
import { ONBOARDING_CONTENT, type OnboardingItem } from './content';

const MODAL: OnboardingItem = { key: 'welcome', type: 'modal', order: 1, title: 't', body: 'b', primaryCta: 'ok' };
const COACHMARK: OnboardingItem = { key: 'waves', type: 'coachmark', order: 2, title: 't', body: 'b', primaryCta: 'ok' };

function baseCtx(overrides: Partial<OnboardingCtx> = {}): OnboardingCtx {
  return {
    seen: {}, optedOut: false, lastShownAt: null, now: new Date('2026-07-28T12:00:00Z'),
    sessionModalsShown: 0, sessionCoachmarksShown: 0,
    conditions: { welcome: true, waves: true },
    ...overrides,
  };
}

describe('content registry — lifetime modal budget (§2)', () => {
  it('never exceeds 3 modal-type entries', () => {
    expect(ONBOARDING_CONTENT.filter((i) => i.type === 'modal').length).toBeLessThanOrEqual(3);
  });
});

describe('isEligible', () => {
  it('is eligible when opted-in, unseen, condition true, budget open', () => {
    expect(isEligible(MODAL, baseCtx())).toBe(true);
    expect(isEligible(COACHMARK, baseCtx())).toBe(true);
  });

  it('opted_out blocks everything', () => {
    expect(isEligible(MODAL, baseCtx({ optedOut: true }))).toBe(false);
  });

  it('already-seen blocks re-showing', () => {
    expect(isEligible(MODAL, baseCtx({ seen: { welcome: '2026-01-01T00:00:00Z' } }))).toBe(false);
  });

  it('a false trigger condition blocks it, regardless of everything else', () => {
    expect(isEligible(COACHMARK, baseCtx({ conditions: { waves: false } }))).toBe(false);
  });

  it('modal: session budget of 1 blocks a second modal same session', () => {
    expect(isEligible(MODAL, baseCtx({ sessionModalsShown: SESSION_MODAL_MAX }))).toBe(false);
  });

  it('modal: blocked within 24h of the last modal shown', () => {
    const ctx = baseCtx({ lastShownAt: '2026-07-28T00:00:00Z', now: new Date('2026-07-28T12:00:00Z') }); // 12h ago
    expect(isEligible(MODAL, ctx)).toBe(false);
  });

  it('modal: allowed again after 24h and a different session (sessionModalsShown reset to 0)', () => {
    const ctx = baseCtx({ lastShownAt: '2026-07-27T00:00:00Z', now: new Date('2026-07-28T12:00:00Z') }); // 36h ago
    expect(isEligible(MODAL, ctx)).toBe(true);
  });

  it('coachmark: session budget of 2 blocks a third coach mark same session', () => {
    expect(isEligible(COACHMARK, baseCtx({ sessionCoachmarksShown: SESSION_COACHMARK_MAX }))).toBe(false);
  });

  it('respects prerequisite keys not yet seen', () => {
    const ctx = baseCtx({ requires: { waves: ['welcome'] } });
    expect(isEligible(COACHMARK, ctx)).toBe(false);
    expect(isEligible(COACHMARK, { ...ctx, seen: { welcome: '2026-01-01T00:00:00Z' } })).toBe(true);
  });
});

describe('pickEligible — stability under repeated calls (regression)', () => {
  it('a shown coach mark stays the picked item on the next tick, not flipping to null and back (would loop the component that renders it)', () => {
    // First tick: coach mark becomes eligible and "opens".
    const ctx = baseCtx();
    const first = pickEligible([COACHMARK], ctx);
    expect(first?.key).toBe('waves');
    // Re-picking with the SAME ctx (nothing in `seen` changed yet — the
    // coach mark hasn't been dismissed) must return the identical result.
    // A prior bug fed "is a coach mark currently open" back into
    // eligibility, which made an open coach mark ineligible for itself and
    // oscillated open/closed every render (React "Maximum update depth
    // exceeded").
    const second = pickEligible([COACHMARK], ctx);
    expect(second?.key).toBe('waves');
  });
});

describe('pickEligible', () => {
  it('picks the lowest-order eligible item when more than one qualifies', () => {
    const winner = pickEligible([COACHMARK, MODAL], baseCtx());
    expect(winner?.key).toBe('welcome');
  });

  it('returns null when nothing is eligible', () => {
    expect(pickEligible([MODAL, COACHMARK], baseCtx({ optedOut: true }))).toBeNull();
  });

  it('falls through to the next-lowest-order item when the winner is ineligible', () => {
    const winner = pickEligible([MODAL, COACHMARK], baseCtx({ seen: { welcome: '2026-01-01T00:00:00Z' } }));
    expect(winner?.key).toBe('waves');
  });
});
