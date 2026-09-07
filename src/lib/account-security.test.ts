import { describe, it, expect } from 'vitest';
import { ACCOUNT_RETENTION_DAYS, canReopen, computePurgeAfter, daysUntilPurge, describeOrigin, orgNameMatches } from './account-security';

const now = new Date('2026-09-07T12:00:00Z');

describe('Prompt 602 — account security, pure rules', () => {
  it('the retention window is 30 days from the closure', () => {
    expect(ACCOUNT_RETENTION_DAYS).toBe(30);
    expect(computePurgeAfter('2026-09-07T12:00:00Z')).toBe('2026-10-07T12:00:00.000Z');
    expect(daysUntilPurge('2026-10-07T12:00:00.000Z', now)).toBe(30);
    expect(daysUntilPurge('2026-09-01T00:00:00Z', now)).toBe(0);
    expect(daysUntilPurge(null, now)).toBe(0);
  });

  it('only an owner-closed org inside its window can be reopened from the app', () => {
    expect(canReopen({ closedAt: '2026-09-01T00:00:00Z', closedReason: 'owner', purgeAfter: '2026-10-01T00:00:00Z' }, now)).toBe(true);
    expect(canReopen({ closedAt: '2026-07-01T00:00:00Z', closedReason: 'owner', purgeAfter: '2026-07-31T00:00:00Z' }, now)).toBe(false);
    expect(canReopen({ closedAt: '2026-09-01T00:00:00Z', closedReason: 'platform', purgeAfter: '2026-10-01T00:00:00Z' }, now)).toBe(false);
    expect(canReopen({ closedAt: null, closedReason: null, purgeAfter: null }, now)).toBe(false);
  });

  it('the typed confirmation forgives case and spacing, never a different name', () => {
    expect(orgNameMatches('  sherlock  DEAL ', 'Sherlock Deal')).toBe(true);
    expect(orgNameMatches('Sherlock', 'Sherlock Deal')).toBe(false);
    expect(orgNameMatches('', '')).toBe(false);
  });

  it('describes the origin without leaking the whole user agent', () => {
    expect(describeOrigin('1.2.3.4, 10.0.0.1', 'Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36')).toBe('IP 1.2.3.4, Chrome on Windows');
    expect(describeOrigin(null, null)).toBe('an unknown device');
  });
});
