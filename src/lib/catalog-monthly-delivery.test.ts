import { describe, expect, it } from 'vitest';
import { isFirstOfMonth, monthlyDeliveryDue, monthlyDeliveryStamp, nextMonthlyDeliveryDate } from './catalog-monthly-delivery';

describe('isFirstOfMonth', () => {
  it('is true on the 1st', () => {
    expect(isFirstOfMonth('2026-09-01T09:00:00Z')).toBe(true);
  });
  it('is false on any other day', () => {
    expect(isFirstOfMonth('2026-09-02T09:00:00Z')).toBe(false);
    expect(isFirstOfMonth('2026-09-30T09:00:00Z')).toBe(false);
  });
});

describe('monthlyDeliveryDue', () => {
  it('is false on any day other than the 1st, regardless of the marker', () => {
    expect(monthlyDeliveryDue(null, '2026-09-15T09:00:00Z')).toBe(false);
  });
  it('is true on the 1st when the org has never run the job before', () => {
    expect(monthlyDeliveryDue(null, '2026-09-01T09:00:00Z')).toBe(true);
  });
  it('is false on the 1st when the marker already matches this month (same-day retry)', () => {
    expect(monthlyDeliveryDue('2026-09-01', '2026-09-01T09:00:00Z')).toBe(false);
  });
  it('is true on the 1st when the marker is from an earlier month', () => {
    expect(monthlyDeliveryDue('2026-08-01', '2026-09-01T09:00:00Z')).toBe(true);
  });
  it('is true on the 1st when the marker is from the same month last year', () => {
    expect(monthlyDeliveryDue('2025-09-01', '2026-09-01T09:00:00Z')).toBe(true);
  });
});

describe('monthlyDeliveryStamp', () => {
  it('stamps the 1st of the current month', () => {
    expect(monthlyDeliveryStamp('2026-09-17T09:00:00Z')).toBe('2026-09-01');
  });
  it('pads single-digit months', () => {
    expect(monthlyDeliveryStamp('2026-01-05T09:00:00Z')).toBe('2026-01-01');
  });
});

describe('nextMonthlyDeliveryDate', () => {
  it('returns the 1st of next month', () => {
    const d = nextMonthlyDeliveryDate('2026-09-17T09:00:00Z');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(9); // October, 0-indexed
    expect(d.getUTCDate()).toBe(1);
  });
  it('rolls over into next year from December', () => {
    const d = nextMonthlyDeliveryDate('2026-12-25T09:00:00Z');
    expect(d.getUTCFullYear()).toBe(2027);
    expect(d.getUTCMonth()).toBe(0); // January
    expect(d.getUTCDate()).toBe(1);
  });
});
