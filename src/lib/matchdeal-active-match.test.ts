import { describe, expect, it } from 'vitest';
import { matchQualifies } from './matchdeal-active-match';

describe('matchQualifies', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');

  it('refuses a match still in pending_consent — not yet mutually confirmed', () => {
    expect(matchQualifies({ status: 'pending_consent', cooldown_until: null }, now)).toBe(false);
  });

  it('refuses every terminal/ended status', () => {
    for (const status of ['declined_by_startup', 'expired_no_followup', 'closed_by_startup']) {
      expect(matchQualifies({ status, cooldown_until: null }, now)).toBe(false);
    }
  });

  it('allows an active match with no cooldown set', () => {
    expect(matchQualifies({ status: 'active', cooldown_until: null }, now)).toBe(true);
  });

  it('refuses an active match still in cooldown', () => {
    expect(matchQualifies({ status: 'active', cooldown_until: '2026-08-07T00:00:00.000Z' }, now)).toBe(false);
  });

  it('allows an active match whose cooldown has already elapsed', () => {
    expect(matchQualifies({ status: 'active', cooldown_until: '2026-08-01T00:00:00.000Z' }, now)).toBe(true);
  });
});
