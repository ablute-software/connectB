import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped, gdprDueAt, GDPR_KINDS, isGdprKind, maxExtensionAt, statutoryDueAt,
} from './gdpr';

// Prompt 574's two fixture cases, re-expressed against the calendar month that
// replaced the flat 30 days (Prompt 626 §D). The labels changed because the
// sentence changed: "of 30" named a period that is not the legal one, and an
// extended request has no fixed denominator to name at all.
describe('gdprDueAt', () => {
  const now = new Date('2026-09-06T00:00:00.000Z').getTime();

  it('a request from 12 August: 6 days left, not overdue', () => {
    // 12 Aug + one month = 12 Sep. From 6 Sep that is 6 days, where the old
    // 30-day clock said 5 — August has 31 days, so the flat window was short.
    const due = gdprDueAt('2026-08-12T00:00:00.000Z', now);
    expect(due.daysLeft).toBe(6);
    expect(due.overdue).toBe(false);
    expect(due.label).toBe('6 days left');
  });

  it('past the month: OVERDUE by the right number', () => {
    const due = gdprDueAt('2026-08-05T00:00:00.000Z', now);
    expect(due.daysLeft).toBe(-1);
    expect(due.overdue).toBe(true);
    expect(due.label).toBe('OVERDUE by 1');
  });

  it('exactly on the due date: 0 days left, not yet overdue', () => {
    const due = gdprDueAt('2026-08-06T00:00:00.000Z', now);
    expect(due.daysLeft).toBe(0);
    expect(due.overdue).toBe(false);
  });
});

describe('the period is a calendar month, not thirty days', () => {
  it('February is the case the old clock got wrong, and it erred the unsafe way', () => {
    // 1 Feb + one month = 1 Mar: 28 days. A flat 30-day window reported two
    // days in hand that Article 12(3) does not give.
    const statutory = statutoryDueAt('2026-02-01T00:00:00.000Z');
    expect(statutory.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    const flatThirty = Date.parse('2026-02-01T00:00:00.000Z') + 30 * 86400000;
    expect(flatThirty).toBeGreaterThan(statutory.getTime());
  });

  it('clamps to the end of a short month instead of overflowing into the next', () => {
    expect(addMonthsClamped(new Date('2026-01-31T00:00:00.000Z'), 1).toISOString())
      .toBe('2026-02-28T00:00:00.000Z');
    expect(addMonthsClamped(new Date('2028-01-31T00:00:00.000Z'), 1).toISOString())
      .toBe('2028-02-29T00:00:00.000Z');
    expect(addMonthsClamped(new Date('2026-03-31T00:00:00.000Z'), 1).toISOString())
      .toBe('2026-04-30T00:00:00.000Z');
  });

  it('crosses a year boundary and keeps the time of day', () => {
    expect(statutoryDueAt('2026-12-15T09:30:00.000Z').toISOString())
      .toBe('2027-01-15T09:30:00.000Z');
  });
});

describe('the extension (Article 12(3))', () => {
  const created = '2026-09-01T00:00:00.000Z';
  const now = Date.parse('2026-09-20T00:00:00.000Z');

  it('is never derived — no recorded extension means the statutory date', () => {
    const due = gdprDueAt(created, now);
    expect(due.extended).toBe(false);
    expect(due.dueAt).toBe('2026-10-01T00:00:00.000Z');
    expect(due.label).not.toContain('extended');
  });

  it('is honoured when recorded, and says so', () => {
    const due = gdprDueAt(created, now, '2026-11-01T00:00:00.000Z');
    expect(due.extended).toBe(true);
    expect(due.dueAt).toBe('2026-11-01T00:00:00.000Z');
    expect(due.label).toContain('(extended)');
  });

  it('caps at three months: the queue shows the deadline that binds us, not the one somebody typed', () => {
    expect(maxExtensionAt(created).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    const due = gdprDueAt(created, now, '2027-06-01T00:00:00.000Z');
    expect(due.dueAt).toBe('2026-12-01T00:00:00.000Z');
    expect(due.extended).toBe(true);
  });

  it('ignores an "extension" earlier than the statutory date', () => {
    // Shortening our own deadline by writing a nearer date is not a thing the
    // Regulation contemplates; the statutory one stands.
    const due = gdprDueAt(created, now, '2026-09-10T00:00:00.000Z');
    expect(due.extended).toBe(false);
    expect(due.dueAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('ignores a malformed date rather than reporting NaN days', () => {
    const due = gdprDueAt(created, now, 'not a date');
    expect(due.extended).toBe(false);
    expect(Number.isFinite(due.daysLeft)).toBe(true);
  });
});

describe('the four rights', () => {
  it('offers all four, not just the two the enum had', () => {
    expect([...GDPR_KINDS]).toEqual(['access', 'rectify', 'object', 'erase']);
    expect(isGdprKind('access')).toBe(true);
    expect(isGdprKind('object')).toBe(true);
    expect(isGdprKind('nonsense')).toBe(false);
    expect(isGdprKind(null)).toBe(false);
  });
});
