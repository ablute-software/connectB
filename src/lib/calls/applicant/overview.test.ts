// Prompt 907 (I4) — the applicant's area: which calls are listed, with which button, and where each application sits (spec §20).
import { describe, expect, it } from 'vitest';
import { buildOverview, cardAction, stageOf, type ApplicationFacts, type CallFacts } from './overview';

const NOW = new Date('2026-10-14T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const call = (id: string, over: Partial<CallFacts> = {}): CallFacts => ({
  id, token: `tok-${id}-0123456789abcdef`, name: `Call ${id}`, promoter: 'Portugal Ventures', status: 'open', opensAt: at(-3), closesAt: at(10), timezone: 'Europe/Lisbon',
  description: 'Summary', visibility: 'listed', promoterIsTest: false, hasForm: true, allowMultiple: false, ...over,
});
const app = (id: string, callId: string, over: Partial<ApplicationFacts> = {}): ApplicationFacts => ({
  id, callId, status: 'draft', reference: `APP-${id}`, updatedAt: at(-1), submittedAt: null, ...over,
});
const overview = (calls: CallFacts[], apps: ApplicationFacts[] = [], opts: { link?: string[]; test?: boolean } = {}) =>
  buildOverview({ calls, apps, linkAccess: new Set(opts.link ?? []), viewerIsTestAccount: opts.test === true, now: NOW });

describe('Open calls', () => {
  it('lists the open, listed calls, nearest deadline first, with "Apply"', () => {
    const o = overview([call('later', { closesAt: at(20) }), call('soon', { closesAt: at(2) })]);
    expect(o.openCalls.map((c) => [c.callId, c.action])).toEqual([['soon', 'apply'], ['later', 'apply']]);
  });
  it('does not list a "closed — link only" call, unless this startup reached it by its link', () => {
    const calls = [call('a', { visibility: 'unlisted' })];
    expect(overview(calls).openCalls).toEqual([]);
    expect(overview(calls, [], { link: ['a'] }).openCalls.map((c) => [c.callId, c.linkOnly])).toEqual([['a', true]]);
  });
  it('does not advertise a scheduled, closed, draft or archived call, nor one with no form or no link', () => {
    const o = overview([
      call('sched', { status: 'scheduled', opensAt: at(3) }), call('closed', { closesAt: at(-1) }), call('draft', { status: 'draft' }), call('arch', { status: 'archived' }),
      call('noform', { hasForm: false }), call('nolink', { token: null }),
    ]);
    expect(o.openCalls).toEqual([]);
  });
  it('a call of a TEST organisation is for test accounts (and whoever reached its link), not for real startups', () => {
    const calls = [call('t', { promoterIsTest: true })];
    expect(overview(calls).openCalls).toEqual([]);
    expect(overview(calls, [], { test: true }).openCalls.map((c) => c.callId)).toEqual(['t']);
    expect(overview(calls, [], { link: ['t'] }).openCalls.map((c) => c.callId)).toEqual(['t']);
  });
  it('the button fits: Apply / Continue application / View application', () => {
    const o = overview([call('a'), call('b'), call('c')], [app('1', 'b', { status: 'draft' }), app('2', 'c', { status: 'submitted', submittedAt: at(-1) })]);
    expect(Object.fromEntries(o.openCalls.map((c) => [c.callId, c.action]))).toEqual({ a: 'apply', b: 'continue', c: 'view' });
    expect(cardAction([], false)).toBe('view'); // a closed call with nothing of mine: just look
  });
  it('a call the startup applied to stays in the list after its deadline (to view the application), but is not advertised to anyone else', () => {
    const closed = call('x', { closesAt: at(-2) });
    expect(overview([closed]).openCalls).toEqual([]);
    expect(overview([closed], [app('1', 'x', { status: 'submitted', submittedAt: at(-5) })]).openCalls.map((c) => [c.callId, c.action])).toEqual([['x', 'view']]);
  });
  it('several applications on one call: the draft wins ("Continue"), and the card says how many', () => {
    const c = call('m', { allowMultiple: true });
    const o = overview([c], [app('1', 'm', { status: 'submitted', submittedAt: at(-1) }), app('2', 'm', { status: 'draft' })]);
    expect(o.openCalls[0]).toMatchObject({ action: 'continue', applications: 2, applicationStage: 'in_progress' });
  });
});

describe('My applications', () => {
  it('stages: In progress, Submitted, Under review, Result available', () => {
    expect(stageOf({ status: 'draft' }, 'open')).toBe('in_progress');
    expect(stageOf({ status: 'submitted' }, 'open')).toBe('submitted');
    expect(stageOf({ status: 'submitted' }, 'closed')).toBe('submitted');
    expect(stageOf({ status: 'submitted' }, 'evaluating')).toBe('under_review');
    expect(stageOf({ status: 'submitted' }, 'results_published')).toBe('result_available');
  });
  it('order: in progress by the nearest deadline first, then the submitted ones, newest first', () => {
    const calls = [call('far', { closesAt: at(30) }), call('near', { closesAt: at(3) }), call('s1'), call('s2')];
    const apps = [
      app('d-far', 'far', { status: 'draft' }), app('s-old', 's1', { status: 'submitted', submittedAt: at(-9) }),
      app('d-near', 'near', { status: 'draft' }), app('s-new', 's2', { status: 'submitted', submittedAt: at(-2) }),
    ];
    expect(overview(calls, apps).mine.map((a) => a.applicationId)).toEqual(['d-near', 'd-far', 's-new', 's-old']);
  });
  it('a withdrawn application is nowhere', () => {
    const o = overview([call('a')], [app('1', 'a', { status: 'withdrawn' })]);
    expect(o.mine).toEqual([]); expect(o.past).toEqual([]); expect(o.openCalls[0].action).toBe('apply');
  });
});

describe('Past applications', () => {
  it('an unfinished draft on a call that ended goes to the archive; a submitted one stays in "My applications"', () => {
    const calls = [call('ended', { closesAt: at(-2) }), call('ended2', { closesAt: at(-3) })];
    const o = overview(calls, [app('1', 'ended', { status: 'draft' }), app('2', 'ended2', { status: 'submitted', submittedAt: at(-6) })]);
    expect(o.past).toMatchObject([{ callId: 'ended', reason: 'closed_without_submission' }]);
    expect(o.mine.map((a) => a.applicationId)).toEqual(['2']);
  });
  it('applications of an archived call are past', () => {
    const o = overview([call('old', { status: 'archived' })], [app('1', 'old', { status: 'submitted', submittedAt: at(-30) })]);
    expect(o.past).toMatchObject([{ callId: 'old', reason: 'archived' }]);
    expect(o.mine).toEqual([]);
  });
});
