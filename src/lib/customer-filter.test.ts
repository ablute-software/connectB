import { describe, expect, it } from 'vitest';
import { derivePaymentBucket, matchesCustomerFilter, isCustomerOverdue, isCustomerArchived } from './customer-filter';

const NOW = new Date('2026-09-10T12:00:00Z');

describe('derivePaymentBucket', () => {
  it('an active promo always wins, even over a paid status', () => {
    expect(derivePaymentBucket({ lastPaymentStatus: 'paid', hasActivePromo: true })).toBe('promo');
  });

  it('paid status with no active promo -> paid', () => {
    expect(derivePaymentBucket({ lastPaymentStatus: 'paid', hasActivePromo: false })).toBe('paid');
  });

  it('failed/none status with no active promo -> unpaid', () => {
    expect(derivePaymentBucket({ lastPaymentStatus: 'failed', hasActivePromo: false })).toBe('unpaid');
    expect(derivePaymentBucket({ lastPaymentStatus: 'none', hasActivePromo: false })).toBe('unpaid');
    expect(derivePaymentBucket({ lastPaymentStatus: null, hasActivePromo: false })).toBe('unpaid');
  });
});

describe('matchesCustomerFilter', () => {
  it('"all" matches every bucket', () => {
    for (const paymentBucket of ['paid', 'unpaid', 'promo'] as const) {
      expect(matchesCustomerFilter('all', { paymentBucket })).toBe(true);
    }
  });

  it('a specific filter matches only its own bucket', () => {
    expect(matchesCustomerFilter('paid', { paymentBucket: 'paid' })).toBe(true);
    expect(matchesCustomerFilter('paid', { paymentBucket: 'unpaid' })).toBe(false);
    expect(matchesCustomerFilter('promo', { paymentBucket: 'promo' })).toBe(true);
    expect(matchesCustomerFilter('promo', { paymentBucket: 'paid' })).toBe(false);
  });
});

describe('isCustomerOverdue', () => {
  it('no due date at all -> never overdue', () => {
    expect(isCustomerOverdue(null, 'failed', NOW)).toBe(false);
  });

  it('due date in the past AND not paid -> overdue', () => {
    expect(isCustomerOverdue('2026-08-01T00:00:00Z', 'failed', NOW)).toBe(true);
    expect(isCustomerOverdue('2026-08-01T00:00:00Z', 'none', NOW)).toBe(true);
    expect(isCustomerOverdue('2026-08-01T00:00:00Z', null, NOW)).toBe(true);
  });

  it('due date in the past but status is paid -> not overdue (it came in)', () => {
    expect(isCustomerOverdue('2026-08-01T00:00:00Z', 'paid', NOW)).toBe(false);
  });

  it('due date in the future -> not overdue yet', () => {
    expect(isCustomerOverdue('2026-12-01T00:00:00Z', 'failed', NOW)).toBe(false);
  });
});

describe('isCustomerArchived', () => {
  it('a deleted/cancelled account is always archived, regardless of payment state', () => {
    expect(isCustomerArchived({ accountDeleted: true, lastPaymentStatus: 'paid', lastBillingSignalAt: null, now: NOW })).toBe(true);
  });

  it('currently paid, not deleted -> never archived', () => {
    expect(isCustomerArchived({ accountDeleted: false, lastPaymentStatus: 'paid', lastBillingSignalAt: '2020-01-01T00:00:00Z', now: NOW })).toBe(false);
  });

  it('unpaid but no billing signal at all -> not archived (nothing to measure 3 months against)', () => {
    expect(isCustomerArchived({ accountDeleted: false, lastPaymentStatus: 'none', lastBillingSignalAt: null, now: NOW })).toBe(false);
  });

  it('unpaid, billing signal more than 3 months ago -> archived', () => {
    expect(isCustomerArchived({ accountDeleted: false, lastPaymentStatus: 'failed', lastBillingSignalAt: '2026-05-01T00:00:00Z', now: NOW })).toBe(true);
  });

  it('unpaid, billing signal within the last 3 months -> not archived yet', () => {
    expect(isCustomerArchived({ accountDeleted: false, lastPaymentStatus: 'failed', lastBillingSignalAt: '2026-08-01T00:00:00Z', now: NOW })).toBe(false);
  });
});
