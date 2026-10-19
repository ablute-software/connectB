// Prompt 907 (I1) — the state of a call from the applicant's side, on the server's clock.
import { describe, expect, it } from 'vitest';
import { applicantPhase, phaseSentence } from './phase';

const NOW = new Date('2026-10-14T12:00:00Z');
const call = (over: Record<string, unknown> = {}) => ({ status: 'open' as const, opensAt: '2026-10-01T09:00:00Z', closesAt: '2026-11-01T17:00:00Z', timezone: 'Europe/Lisbon', ...over });

describe('applicantPhase', () => {
  it('open between opening and deadline', () => {
    expect(applicantPhase(call(), NOW)).toBe('open');
    expect(phaseSentence(call(), NOW)).toBeNull();
  });
  it('a scheduled call whose time has come is open, one whose time has not is scheduled', () => {
    expect(applicantPhase(call({ status: 'scheduled' }), NOW)).toBe('open');
    expect(applicantPhase(call({ status: 'scheduled', opensAt: '2026-10-20T09:00:00Z' }), NOW)).toBe('scheduled');
  });
  it('an open call past its deadline is closed — by the clock, even if nobody changed its status yet', () => {
    expect(applicantPhase(call({ closesAt: '2026-10-14T11:59:00Z' }), NOW)).toBe('closed');
  });
  it('closed early, in evaluation or with results is closed', () => {
    for (const status of ['closed', 'evaluating', 'results_published'] as const) expect(applicantPhase(call({ status }), NOW)).toBe('closed');
  });
});

describe('phaseSentence — the sentence under the header', () => {
  it('"Opens on [date]" before the opening, in the call\'s own time zone', () => {
    expect(phaseSentence(call({ status: 'scheduled', opensAt: '2026-10-20T23:30:00Z', timezone: 'Europe/Lisbon' }), NOW)).toBe('Opens on 21 Oct 2026'); // already the 21st in Lisbon
  });
  it('"Applications closed on [date]" after the deadline', () => {
    expect(phaseSentence(call({ status: 'closed', closesAt: '2026-10-10T17:00:00Z' }), NOW)).toBe('Applications closed on 10 Oct 2026');
  });
});
