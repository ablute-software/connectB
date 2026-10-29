// Prompt 924 (Etapa 4, I3) — the rules of contestations, completing a call and the retention of the applicants' data, as pure functions: who is offered a contestation and until when (10 calendar days once on, a "Not selected"
// only, once); what an answer must contain (Upheld says what the decision becomes, Rejected needs a written response); when a call can be completed; when the data goes (24 months by default), the warning 30 days before
// and the single postponement; and that the summary that stays has no personal data.
import { describe, expect, it } from 'vitest';
import {
  DAY_MS, POSTPONE_MONTHS, WARN_DAYS, addMonths, buildSummary, cleanPostponeReason, cleanReason, completeBlockers, contestDeadline, contestInfo, parseAnswer, rejectedMessage, responseBlock, retentionState, upheldIntro,
} from './contestations';

const PUBLISHED = '2026-11-01T10:00:00.000Z';
const base = { enabled: true, days: 10, resultKind: 'reject' as const, publishedAt: PUBLISHED, callStatus: 'closed', existing: null };

describe('who is offered a contestation, and until when', () => {
  it('the deadline is the days asked for after the publication; at that moment it is still open, a moment later it is not', () => {
    expect(contestDeadline(PUBLISHED, 10)).toBe('2026-11-11T10:00:00.000Z');
    expect(contestInfo({ ...base, now: new Date('2026-11-11T10:00:00.000Z') }).state).toBe('available');
    expect(contestInfo({ ...base, now: new Date('2026-11-11T10:00:00.001Z') })).toMatchObject({ state: 'expired', deadline: '2026-11-11T10:00:00.000Z' });
    expect(contestInfo({ ...base, days: 3, now: new Date('2026-11-04T10:00:01Z') }).state).toBe('expired');
  });
  it('only a "Not selected", only if the call switched it on; Selected and Waiting list have nothing to contest', () => {
    const now = new Date('2026-11-02T00:00:00Z');
    expect(contestInfo({ ...base, now }).state).toBe('available');
    expect(contestInfo({ ...base, enabled: false, now })).toMatchObject({ state: 'not_offered', deadline: null });
    for (const k of ['advance', 'waitlist'] as const) expect(contestInfo({ ...base, resultKind: k, now }).state).toBe('not_offered');
  });
  it('once: an existing contestation is shown instead of the button, whatever the date; a completed or archived call offers nothing new', () => {
    const existing = { status: 'open' as const, reason: 'x', response: null, answeredAt: null, hasFile: false, fileName: null };
    expect(contestInfo({ ...base, existing, now: new Date('2030-01-01T00:00:00Z') })).toMatchObject({ state: 'done', contestation: { status: 'open' } });
    expect(contestInfo({ ...base, callStatus: 'completed', now: new Date('2026-11-02T00:00:00Z') }).state).toBe('closed');
    expect(contestInfo({ ...base, callStatus: 'archived', now: new Date('2026-11-02T00:00:00Z') }).state).toBe('closed');
  });
  it('the reason is required, trimmed and bounded', () => {
    expect(cleanReason('  Please review.  ')).toEqual({ ok: true, text: 'Please review.' });
    for (const bad of ['', '   ', undefined, 5, 'x'.repeat(2001)]) expect(cleanReason(bad), String(bad).slice(0, 10)).toMatchObject({ ok: false });
  });
});

describe('the answer', () => {
  it('Upheld says what the decision becomes (Advance or Waitlist); the response is optional', () => {
    expect(parseAnswer({ outcome: 'upheld', newResult: 'advance' })).toEqual({ ok: true, answer: { outcome: 'upheld', newResult: 'advance', response: '' } });
    expect(parseAnswer({ outcome: 'upheld', newResult: 'waitlist', response: '  You were right. ' })).toEqual({ ok: true, answer: { outcome: 'upheld', newResult: 'waitlist', response: 'You were right.' } });
    for (const bad of [{ outcome: 'upheld' }, { outcome: 'upheld', newResult: 'reject' }, { outcome: 'upheld', newResult: 'maybe' }]) expect(parseAnswer(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
  });
  it('Rejected needs a written response', () => {
    expect(parseAnswer({ outcome: 'rejected', response: 'The decision stands.' })).toEqual({ ok: true, answer: { outcome: 'rejected', response: 'The decision stands.' } });
    expect(parseAnswer({ outcome: 'rejected' })).toEqual({ ok: false, error: 'Write the response to the applicant: a rejection needs one.' });
    expect(parseAnswer({ outcome: 'rejected', response: '   ' })).toMatchObject({ ok: false });
    expect(parseAnswer({ outcome: 'rejected', response: 'x'.repeat(2001) })).toMatchObject({ ok: false });
    expect(parseAnswer({ outcome: 'nothing' })).toEqual({ ok: false, error: 'Choose Upheld or Rejected.' });
    expect(parseAnswer(null)).toMatchObject({ ok: false });
  });
  it('the words are in the language of the call, and the response is text, never markup', () => {
    expect(upheldIntro('pt', 'Chamada')).toBe('<p>Analisámos a sua contestação a “Chamada” e foi aceite.</p>');
    expect(upheldIntro('xx', 'Call')).toContain('and accepted it.');
    expect(responseBlock('en', '  ')).toBe('');
    expect(responseBlock('en', 'a <b>b</b>\nc')).toBe('<h3>Response</h3><p>a &lt;b&gt;b&lt;/b&gt;<br>c</p>');
    const m = rejectedMessage('de', 'Aufruf', 'Bleibt.');
    expect(m.subject).toBe('Aufruf: Antwort auf Ihren Einspruch');
    expect(m.html).toContain('Die Entscheidung bleibt bestehen.');
    expect(m.html).toContain('<h3>Antwort</h3><p>Bleibt.</p>');
  });
});

describe('"Complete call"', () => {
  const ok = { callStatus: 'closed', allPublished: true, contestationsEnabled: true, days: 10, lastPublishedAt: PUBLISHED, openContestations: 0, now: new Date('2026-11-20T00:00:00Z') };
  it('can be completed when everything is published, the period is over and nothing is open', () => { expect(completeBlockers(ok)).toEqual([]); });
  it('every reason, in words', () => {
    expect(completeBlockers({ ...ok, allPublished: false }).map((b) => b.code)).toEqual(['not_published']);
    expect(completeBlockers({ ...ok, now: new Date('2026-11-05T00:00:00Z') })).toEqual([{ code: 'contest_period', text: 'The contestation period is still open until 2026-11-11.' }]);
    expect(completeBlockers({ ...ok, openContestations: 2 })).toEqual([{ code: 'open_contestations', text: '2 contestations are still waiting for an answer.' }]);
    expect(completeBlockers({ ...ok, openContestations: 1 })[0].text).toBe('1 contestation is still waiting for an answer.');
    expect(completeBlockers({ ...ok, allPublished: false, openContestations: 1, now: new Date('2026-11-05T00:00:00Z') }).map((b) => b.code)).toEqual(['not_published', 'contest_period', 'open_contestations']);
    expect(completeBlockers({ ...ok, callStatus: 'completed' })).toEqual([{ code: 'completed', text: 'The call is already completed.' }]);
    expect(completeBlockers({ ...ok, callStatus: 'archived' })[0].code).toBe('archived');
  });
  it('without contestations the period does not matter', () => {
    expect(completeBlockers({ ...ok, contestationsEnabled: false, now: new Date('2026-11-02T00:00:00Z') })).toEqual([]);
  });
});

describe('how long the data is kept', () => {
  it('N calendar months later, the same day or the last day of a shorter month', () => {
    expect(addMonths('2026-10-29T12:00:00.000Z', 24)).toBe('2028-10-29T12:00:00.000Z');
    expect(addMonths('2026-01-31T00:00:00.000Z', 1)).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonths('2027-12-31T00:00:00.000Z', 2)).toBe('2028-02-29T00:00:00.000Z');
    expect(addMonths('2026-10-29T00:00:00.000Z', POSTPONE_MONTHS)).toBe('2027-04-29T00:00:00.000Z');
  });
  it('kept, then a warning in the last 30 days, then due; the deletion can be postponed once and not when it is due', () => {
    const purgeAfter = '2028-10-29T00:00:00.000Z';
    const at = (daysBefore: number) => new Date(Date.parse(purgeAfter) - daysBefore * DAY_MS);
    expect(retentionState({ purgeAfter, extendedAt: null, purgedAt: null, now: at(200) })).toMatchObject({ phase: 'kept', daysLeft: 200, canPostpone: true });
    expect(retentionState({ purgeAfter, extendedAt: null, purgedAt: null, now: at(WARN_DAYS + 1) }).phase).toBe('kept');
    expect(retentionState({ purgeAfter, extendedAt: null, purgedAt: null, now: at(WARN_DAYS) })).toMatchObject({ phase: 'warn', daysLeft: 30, canPostpone: true });
    expect(retentionState({ purgeAfter, extendedAt: null, purgedAt: null, now: at(1) })).toMatchObject({ phase: 'warn', daysLeft: 1 });
    expect(retentionState({ purgeAfter, extendedAt: null, purgedAt: null, now: at(0) })).toMatchObject({ phase: 'due', daysLeft: 0, canPostpone: false });
    expect(retentionState({ purgeAfter, extendedAt: '2028-09-01T00:00:00Z', purgedAt: null, now: at(10) })).toMatchObject({ phase: 'warn', canPostpone: false });          // once
    expect(retentionState({ purgeAfter, extendedAt: null, purgedAt: '2028-10-30T00:00:00Z', now: at(-5) })).toMatchObject({ phase: 'purged', canPostpone: false });
    expect(retentionState({ purgeAfter: null, extendedAt: null, purgedAt: null, now: at(0) })).toMatchObject({ phase: 'kept', canPostpone: false });
  });
  it('a reason is needed to postpone', () => {
    expect(cleanPostponeReason(' For the audit. ')).toEqual({ ok: true, text: 'For the audit.' });
    for (const bad of ['', 'ok', undefined, 'x'.repeat(501)]) expect(cleanPostponeReason(bad), String(bad).slice(0, 5)).toMatchObject({ ok: false });
  });
  it('what stays is counts and the grid — nothing that names, quotes or identifies anybody', () => {
    const s = buildSummary({
      callName: 'Seed Call 2027', completedAt: '2026-11-20T00:00:00Z', results: [{ result: 'advance' }, { result: 'reject' }, { result: 'reject' }], contestations: [{ status: 'upheld' }, { status: 'rejected' }, { status: 'rejected' }],
      phases: 2, criteria: [{ name: 'Team', weight: 60, scaleMin: 1, scaleMax: 5, minScore: 2 }, { name: 'Market', weight: 40, scaleMin: 0, scaleMax: 10, minScore: null }],
    });
    expect(s).toEqual({
      call: { name: 'Seed Call 2027', completedAt: '2026-11-20T00:00:00Z' }, outcome: { total: 3, byResult: { advance: 1, reject: 2 } }, contestations: { total: 3, upheld: 1, rejected: 2 }, phases: 2,
      criteria: [{ name: 'Team', weight: 60, scaleMin: 1, scaleMax: 5, minScore: 2 }, { name: 'Market', weight: 40, scaleMin: 0, scaleMax: 10, minScore: null }],
    });
  });
});
