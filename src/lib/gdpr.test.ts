import { describe, expect, it } from 'vitest';
import { gdprDueAt } from './gdpr';

// Prompt 574 — the two fixture cases named explicitly: 25 days old shows
// "5 days left" (and is the one that should sort/color as urgent, checked
// via .overdue/.daysLeft <= 7 in the caller); 31 days old shows "OVERDUE by 1".
describe('gdprDueAt', () => {
  const now = new Date('2026-09-06T00:00:00.000Z').getTime();

  it('25 days old: 5 days left, not overdue', () => {
    const createdAt = new Date(now - 25 * 86400000).toISOString();
    const due = gdprDueAt(createdAt, now);
    expect(due.daysLeft).toBe(5);
    expect(due.overdue).toBe(false);
    expect(due.label).toBe('5 days left of 30');
  });

  it('31 days old: OVERDUE by 1', () => {
    const createdAt = new Date(now - 31 * 86400000).toISOString();
    const due = gdprDueAt(createdAt, now);
    expect(due.daysLeft).toBe(-1);
    expect(due.overdue).toBe(true);
    expect(due.label).toBe('OVERDUE by 1');
  });

  it('exactly 30 days old: 0 days left, not yet overdue', () => {
    const createdAt = new Date(now - 30 * 86400000).toISOString();
    const due = gdprDueAt(createdAt, now);
    expect(due.daysLeft).toBe(0);
    expect(due.overdue).toBe(false);
  });
});
