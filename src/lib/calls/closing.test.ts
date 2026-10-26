// Prompt 918 (Adenda 3) — why a call is closed and what date it shows, in one pure place.
import { describe, expect, it } from 'vitest';
import { closeReasonFrom, closeReasonSentence, closedBeforeDeadline, closingLine } from './closing';
import { phaseSentence } from './applicant/phase';

const long = (iso: string | null) => (iso ? `LONG(${iso})` : '—');

describe('closeReasonFrom — read from the history, newest first', () => {
  it('no closing event at all: it closed at its deadline', () => {
    expect(closeReasonFrom([])).toBe('deadline');
    expect(closeReasonFrom([{ id: 1, event: 'call_published' }])).toBe('deadline');
  });
  it('a call closed on purpose is "early"; the platform\'s own closing is "deadline"', () => {
    expect(closeReasonFrom([{ id: 2, event: 'call_closed', detail: { early: true } }])).toBe('early');
    expect(closeReasonFrom([{ id: 2, event: 'call_closed', detail: { automatic: true } }])).toBe('deadline');
  });
  it('deleted while open and then restored: "restored" — in either order of arrival', () => {
    const evs = [{ id: 5, event: 'call_deleted', detail: { closed: true } }, { id: 6, event: 'call_restored' }];
    expect(closeReasonFrom(evs)).toBe('restored');
    expect(closeReasonFrom([...evs].reverse())).toBe('restored');
  });
  it('the NEWEST event decides: closed early, reopened, then closed by the clock is a deadline closing', () => {
    expect(closeReasonFrom([
      { id: 1, event: 'call_closed', detail: { early: true } },
      { id: 2, event: 'call_reopened' },
      { id: 3, event: 'call_closed', detail: { automatic: true } },
    ])).toBe('deadline');
    expect(closeReasonFrom([
      { id: 1, event: 'call_closed', detail: { automatic: true } },
      { id: 2, event: 'call_closed', detail: { early: true } },
    ])).toBe('early');
  });
  it('an old restore does not outlive a newer early closing', () => {
    expect(closeReasonFrom([{ id: 1, event: 'call_restored' }, { id: 2, event: 'call_closed', detail: { early: true } }])).toBe('early');
  });
  it('says the true thing in the box', () => {
    expect(closeReasonSentence('deadline')).toBe('This call closed at its deadline.');
    expect(closeReasonSentence('early')).toBe('This call was closed early, on purpose.');
    expect(closeReasonSentence('restored')).toMatch(/deleted and restored/);
  });
});

describe('closedBeforeDeadline / closingLine', () => {
  const early = { closedAt: '2026-10-22T10:00:00Z', closesAt: '2026-12-31T14:34:00Z', timezone: 'Europe/Lisbon' };
  it('a call closed on 22 Oct whose deadline is 31 Dec is closed before its deadline', () => {
    expect(closedBeforeDeadline(early)).toBe(true);
    expect(closedBeforeDeadline({ closedAt: '2026-12-31T14:34:00Z', closesAt: '2026-12-31T14:34:00Z' })).toBe(false);
    expect(closedBeforeDeadline({ closedAt: null, closesAt: '2026-12-31T14:34:00Z' })).toBe(false);
    expect(closedBeforeDeadline({ closedAt: '2026-10-22T10:00:00Z', closesAt: null })).toBe(false);
  });
  it('shows "Closed on 22 Oct 2026 (early)" once closed early, never the future "Closes 31 Dec"', () => {
    expect(closingLine(early, true, long)).toEqual({ label: 'Closed on', value: '22 Oct 2026 (early)', early: true });
  });
  it('shows the deadline while the call has not closed, and when it closed at the deadline', () => {
    expect(closingLine(early, false, long)).toEqual({ label: 'Closes', value: 'LONG(2026-12-31T14:34:00Z)', early: false });
    const atDeadline = { closedAt: '2026-12-31T14:34:00Z', closesAt: '2026-12-31T14:34:00Z', timezone: 'Europe/Lisbon' };
    expect(closingLine(atDeadline, true, long)).toMatchObject({ label: 'Closes', early: false });
  });
  it('the entry page sentence says the day it really closed', () => {
    const call = { status: 'closed' as const, opensAt: '2026-10-01T00:00:00Z', ...early };
    expect(phaseSentence(call, new Date('2026-10-23T00:00:00Z'))).toBe('Applications closed on 22 Oct 2026');
    expect(phaseSentence({ ...call, closedAt: '2026-12-31T14:34:00Z' }, new Date('2027-01-02T00:00:00Z'))).toBe('Applications closed on 31 Dec 2026');
  });
});
