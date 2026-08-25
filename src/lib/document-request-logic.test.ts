import { describe, expect, it } from 'vitest';
import {
  allItemsResolved, compareTaskPriority, derivedRequestStatus, documentRequestPriorityKind,
  nextReminderAt, requestProgress,
} from './document-request-logic';

describe('priority ranking (Prompt 372 Block C §4)', () => {
  it('investor interest always outranks a diligence document request', () => {
    expect(compareTaskPriority('investor_interest', 'document_request_diligence')).toBeLessThan(0);
  });
  it('a diligence document request outranks an active conversation', () => {
    expect(compareTaskPriority('document_request_diligence', 'active_conversation')).toBeLessThan(0);
  });
  it('an active conversation outranks a non-diligence document request', () => {
    expect(compareTaskPriority('active_conversation', 'document_request_other')).toBeLessThan(0);
  });
  it('documentRequestPriorityKind picks the diligence tier only when in diligence', () => {
    expect(documentRequestPriorityKind(true)).toBe('document_request_diligence');
    expect(documentRequestPriorityKind(false)).toBe('document_request_other');
  });
});

describe('nextReminderAt (Prompt 372 Block C §5)', () => {
  const day = 86_400_000;
  it('the first three reminders are 2 days apart', () => {
    const last = new Date('2026-08-25T09:00:00.000Z');
    expect(nextReminderAt(last, 0).getTime()).toBe(last.getTime() + 2 * day);
    expect(nextReminderAt(last, 1).getTime()).toBe(last.getTime() + 2 * day);
    expect(nextReminderAt(last, 2).getTime()).toBe(last.getTime() + 2 * day);
  });
  it('switches to weekly from the 4th reminder onward', () => {
    const last = new Date('2026-08-25T09:00:00.000Z');
    expect(nextReminderAt(last, 3).getTime()).toBe(last.getTime() + 7 * day);
    expect(nextReminderAt(last, 10).getTime()).toBe(last.getTime() + 7 * day);
  });
  it('a promised_for date overrides the cadence entirely, resetting the count', () => {
    const last = new Date('2026-08-25T09:00:00.000Z');
    const result = nextReminderAt(last, 5, '2026-09-10');
    expect(result.toISOString().slice(0, 10)).toBe('2026-09-10');
  });
});

describe('derivedRequestStatus / requestProgress / allItemsResolved (Prompt 372 Block A)', () => {
  it('is pending while any item is pending', () => {
    expect(derivedRequestStatus([{ status: 'granted' }, { status: 'pending' }])).toBe('pending');
  });
  it('is resolved once every item has granted/promised/declined', () => {
    expect(derivedRequestStatus([{ status: 'granted' }, { status: 'promised' }, { status: 'declined' }])).toBe('resolved');
  });
  it('reports progress as resolved-of-total', () => {
    expect(requestProgress([{ status: 'granted' }, { status: 'pending' }, { status: 'pending' }])).toEqual({ resolved: 1, total: 3 });
  });
  it('allItemsResolved is false with a mix of pending items, true once none remain', () => {
    expect(allItemsResolved([{ status: 'granted' }, { status: 'pending' }])).toBe(false);
    expect(allItemsResolved([{ status: 'granted' }, { status: 'declined' }])).toBe(true);
  });
  it('an empty item list is never considered resolved (nothing to resolve is not the same as done)', () => {
    expect(allItemsResolved([])).toBe(false);
  });
});
