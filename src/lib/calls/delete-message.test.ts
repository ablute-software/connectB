// Prompt 918 (Adenda 1, A) — "This call has applications" was said of a call with none: the count included the DRAFTS, which the entity never sees. The message now says the true reason,
// in the order it applies: the call has opened; it has submitted applications; only drafts (a number, never names).
import { describe, expect, it } from 'vitest';
import { availableActions, deleteProblem, type ApplicationCounts } from './lifecycle';
import type { Call } from './types';

const counts = (o: Partial<ApplicationCounts> = {}): ApplicationCounts => { const c = { submitted: 0, inProgress: 0, withdrawn: 0, total: 0, ...o }; return { ...c, total: o.total ?? c.submitted + c.inProgress + c.withdrawn }; };

describe('the message says why', () => {
  it('a call that has opened — whatever else it has — says it has opened', () => {
    for (const status of ['open', 'closed', 'archived'] as const) {
      expect(deleteProblem(status, counts({ submitted: 3, inProgress: 2 }))).toBe('This call has opened, so it cannot be deleted. Archive it instead.');
      expect(deleteProblem(status, counts())).toBe('This call has opened, so it cannot be deleted. Archive it instead.');
    }
  });
  it('only drafts: how many have STARTED, not submitted — a number, no names — and why', () => {
    expect(deleteProblem('draft', counts({ inProgress: 1 }))).toBe('1 applicant has started an application (not submitted yet). To protect their data, the call cannot be deleted. Archive it instead.');
    expect(deleteProblem('scheduled', counts({ inProgress: 3 }))).toBe('3 applicants have started an application (not submitted yet). To protect their data, the call cannot be deleted. Archive it instead.');
  });
  it('submitted applications: how many (a withdrawn one was submitted); this wins over drafts', () => {
    expect(deleteProblem('validated', counts({ submitted: 1 }))).toBe('This call has 1 submitted application, so it cannot be deleted: there is applicants’ data in it. Archive it instead.');
    expect(deleteProblem('draft', counts({ submitted: 2, withdrawn: 1, inProgress: 4 }))).toBe('This call has 3 submitted applications, so it cannot be deleted: there is applicants’ data in it. Archive it instead.');
  });
  it('nobody has applied and it has not opened: it may be deleted', () => {
    for (const status of ['draft', 'validated', 'scheduled'] as const) expect(deleteProblem(status, counts())).toBeNull();
  });
  it('a bare number still works and counts as drafts', () => {
    expect(deleteProblem('draft', 0)).toBeNull();
    expect(deleteProblem('draft', 2)).toContain('2 applicants have started an application');
  });
  it('never names anyone', () => {
    expect(deleteProblem('draft', counts({ inProgress: 1 }))).not.toMatch(/@|codigo|name/i);
  });
});

describe('the screen shows the sentence the server decides', () => {
  const call = { status: 'draft', opensAt: null, closesAt: null } as Call;
  it('availableActions carries it, and canDelete is exactly "there is no sentence"', () => {
    const none = availableActions(call, [], new Date(), counts());
    expect(none).toMatchObject({ canDelete: true, deleteProblem: null });
    const drafts = availableActions(call, [], new Date(), counts({ inProgress: 1 }));
    expect(drafts.canDelete).toBe(false);
    expect(drafts.deleteProblem).toBe(deleteProblem('draft', counts({ inProgress: 1 })));
  });
});
