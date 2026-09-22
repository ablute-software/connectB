import { describe, expect, it } from 'vitest';
import { CAPITAL_CONFIRMATION_STALE_DAYS, isCapitalConfirmationStale, isContextExpired, isPauseActive } from './investor-context';

const NOW = '2026-09-22T12:00:00Z';

describe('isContextExpired', () => {
  it('is false with no expiry date at all', () => {
    expect(isContextExpired({ expiresAt: null }, NOW)).toBe(false);
  });
  it('is false while the expiry date is still in the future', () => {
    expect(isContextExpired({ expiresAt: '2026-10-01T00:00:00Z' }, NOW)).toBe(false);
  });
  it('is true once the expiry date has passed', () => {
    expect(isContextExpired({ expiresAt: '2026-09-01T00:00:00Z' }, NOW)).toBe(true);
  });
});

describe('isPauseActive — Prompt 715 Pedido G hook', () => {
  const base = { priorityNote: null, capacity: null, expiryLabel: null, suggestionDismissedAt: null, updatedAt: NOW };

  it('is false when nothing is set', () => {
    expect(isPauseActive(null, NOW)).toBe(false);
  });
  it('is false when pause was never requested', () => {
    expect(isPauseActive({ ...base, pauseNewCandidates: false, expiresAt: null }, NOW)).toBe(false);
  });
  it('is true while a pause is active and not expired', () => {
    expect(isPauseActive({ ...base, pauseNewCandidates: true, expiresAt: '2026-10-01T00:00:00Z' }, NOW)).toBe(true);
  });
  it('is true for a pause with no expiry date at all', () => {
    expect(isPauseActive({ ...base, pauseNewCandidates: true, expiresAt: null }, NOW)).toBe(true);
  });
  // Prompt 715 Pedido C — "nunca se prolonga sozinho": once the date
  // passes, the pause simply stops applying, no auto-renewal.
  it('is false once the pause has expired — reservations resume without a second action', () => {
    expect(isPauseActive({ ...base, pauseNewCandidates: true, expiresAt: '2026-09-01T00:00:00Z' }, NOW)).toBe(false);
  });
});

describe('isCapitalConfirmationStale', () => {
  it('never flags anything when capital_to_deploy_eur is not set', () => {
    expect(isCapitalConfirmationStale(null, null, NOW)).toBe(false);
  });
  it('flags a set value that has never been confirmed', () => {
    expect(isCapitalConfirmationStale(500000, null, NOW)).toBe(true);
  });
  it('does not flag a value confirmed recently', () => {
    expect(isCapitalConfirmationStale(500000, '2026-09-01T00:00:00Z', NOW)).toBe(false);
  });
  it(`flags a value confirmed more than ${CAPITAL_CONFIRMATION_STALE_DAYS} days ago`, () => {
    expect(isCapitalConfirmationStale(500000, '2026-01-01T00:00:00Z', NOW)).toBe(true);
  });
});
