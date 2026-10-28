// Prompt 918 (I1) — the call's four tabs and the seven steps of Setup: what opens first, what the old links mean now, and the state shown for each step.
import { describe, expect, it } from 'vitest';
import { MAIN_TABS, STEPS, defaultMain, navQuery, neighbourStep, resolveNav, stepOfIssue, stepStates, type StepContext } from './editor-nav';
import { readiness } from './lifecycle';
import type { Call, CallPhase, FormField } from './types';
import { newField } from './form-builder';

describe('the structure', () => {
  it('four tabs, in this order; seven steps, in this order', () => {
    expect(MAIN_TABS.map((t) => t.label)).toEqual(['Setup', 'Applications', 'Evaluation', 'Results']);
    expect(STEPS.map((s) => s.label)).toEqual(['General', 'Phases', 'Form', 'Eligibility rules', 'Team & distribution', 'Evaluation grid', 'Review & publish']);
  });
  it('previous and next stop at the ends', () => {
    expect(neighbourStep('general', -1)).toBeNull();
    expect(neighbourStep('general', 1)).toBe('phases');
    expect(neighbourStep('form', -1)).toBe('phases');
    expect(neighbourStep('review', 1)).toBeNull();
  });
});

describe('what opens first', () => {
  it('a call being configured opens on Setup, a published one on Applications', () => {
    for (const s of ['draft', 'validated', 'scheduled'] as const) expect(defaultMain(s)).toBe('setup');
    for (const s of ['open', 'closed', 'archived'] as const) expect(defaultMain(s)).toBe('applications');
    expect(resolveNav({}, 'draft')).toEqual({ main: 'setup', step: 'general' });
    expect(resolveNav({}, 'open')).toEqual({ main: 'applications', step: 'general' });
  });
});

describe('the old links keep opening the right place', () => {
  it('each old ?tab= lands on its step, or on its new tab', () => {
    const at = (tab: string, status: Parameters<typeof resolveNav>[1] = 'draft') => resolveNav({ tab }, status);
    expect(at('general')).toEqual({ main: 'setup', step: 'general' });
    expect(at('phases')).toEqual({ main: 'setup', step: 'phases' });
    expect(at('form')).toEqual({ main: 'setup', step: 'form' });
    expect(at('eligibility')).toEqual({ main: 'setup', step: 'eligibility' });
    expect(at('team')).toEqual({ main: 'setup', step: 'team' });
    expect(at('preview')).toEqual({ main: 'setup', step: 'review' });
    expect(at('submissions')).toEqual({ main: 'applications', step: 'general' });
    expect(at('evaluation')).toEqual({ main: 'evaluation', step: 'general' });
  });
  it('an old link wins over the default, in any state of the call (a published call asked for its form gets the form)', () => {
    expect(resolveNav({ tab: 'form' }, 'open')).toEqual({ main: 'setup', step: 'form' });
    expect(resolveNav({ tab: 'submissions' }, 'draft')).toEqual({ main: 'applications', step: 'general' });
  });
  it('the new names work too, and a step on its own means Setup', () => {
    expect(resolveNav({ section: 'applications' }, 'draft')).toEqual({ main: 'applications', step: 'general' });
    expect(resolveNav({ section: 'setup', step: 'team' }, 'open')).toEqual({ main: 'setup', step: 'team' });
    expect(resolveNav({ step: 'grid' }, 'open')).toEqual({ main: 'setup', step: 'grid' });
    expect(resolveNav({ tab: 'results' }, 'draft')).toEqual({ main: 'results', step: 'general' });
  });
  it('nonsense falls back to the default; the address a place makes is read back to the same place', () => {
    expect(resolveNav({ tab: '<script>', section: 'x', step: 'y' }, 'draft')).toEqual({ main: 'setup', step: 'general' });
    expect(resolveNav({ tab: 'constructor' }, 'draft')).toEqual({ main: 'setup', step: 'general' });
    for (const n of [{ main: 'setup', step: 'form' }, { main: 'applications', step: 'general' }, { main: 'results', step: 'general' }] as const) {
      expect(resolveNav(navQuery(n), 'draft')).toEqual(n);
    }
  });
});

describe('the state of each step', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const call = (over: Partial<Call> = {}): Call => ({ name: 'Untitled call', description: null, opensAt: null, closesAt: null, status: 'draft', ...over } as Call);
  const phase = (over: Partial<CallPhase> = {}): CallPhase => ({ id: 'p1', callId: 'c', position: 0, name: 'Phase 1', startsOn: null, endsOn: null, ...over } as CallPhase);
  const field = (over: Partial<FormField> = {}): FormField => ({ ...newField('short_text', 1, 0), id: 'field-id-0001', label: 'Company name', ...over });
  const ctx = (c: Call, phases: CallPhase[], fields: FormField[], teamMembers = 0): StepContext => ({ call: c, phases, fields, issues: readiness(c, phases, fields, now), teamMembers });

  it('a call just created: nothing is started (the empty "Phase 1" it comes with is not a phase set up)', () => {
    const s = stepStates(ctx(call(), [phase()], []));
    expect(['general', 'phases', 'form', 'team', 'review'].map((k) => s[k as keyof typeof s].kind)).toEqual(['not_started', 'not_started', 'not_started', 'not_started', 'attention']);
    expect(s.general.label).toBe('Not started');
  });
  it('eligibility rules are optional: not started without a rule, complete with one, and a broken rule is a thing to fix', () => {
    const s = stepStates(ctx(call(), [phase()], []));
    expect(s.eligibility).toMatchObject({ kind: 'not_started', label: 'Not started' });
    expect(stepStates({ ...ctx(call(), [phase()], []), eligibilityRules: 2 }).eligibility).toMatchObject({ kind: 'complete' });
    expect(stepStates({ ...ctx(call(), [phase()], []), eligibilityRules: 2, issues: [{ tab: 'eligibility', message: 'The question no longer exists.' }] }).eligibility).toMatchObject({ kind: 'attention', count: 1 });
  });
  it('the evaluation grid (Prompt 922) is optional too: not started without a criterion, complete with some, ⚠ while the weights do not add up', () => {
    expect(stepStates(ctx(call(), [phase()], [])).grid).toMatchObject({ kind: 'not_started', label: 'Not started' });
    expect(stepStates({ ...ctx(call(), [phase()], []), evalCriteria: 3 }).grid).toMatchObject({ kind: 'complete' });
    expect(stepStates({ ...ctx(call(), [phase()], []), evalCriteria: 2, issues: [{ tab: 'grid', message: 'The weights add up to 50 %.' }] }).grid).toMatchObject({ kind: 'attention', count: 1 });
  });
  it('something missing shows the NUMBER; complete shows ✓', () => {
    const c = call({ name: 'INNOV-ID', opensAt: '2026-11-01T09:00:00Z' });                // no closing date: one thing missing
    expect(stepStates(ctx(c, [phase()], [])).general).toMatchObject({ kind: 'attention', count: 1, icon: '⚠', label: '1 to fix' });
    const done = call({ name: 'INNOV-ID', opensAt: '2026-11-01T09:00:00Z', closesAt: '2026-12-01T09:00:00Z' });
    expect(stepStates(ctx(done, [phase({ name: 'Applications', startsOn: '2026-11-01' })], [field()])).general).toMatchObject({ kind: 'complete', icon: '✓' });
  });
  it('the form: not started with no questions; a question with no text is something to fix', () => {
    const c = call({ name: 'INNOV-ID', opensAt: '2026-11-01T09:00:00Z', closesAt: '2026-12-01T09:00:00Z' });
    expect(stepStates(ctx(c, [phase()], [])).form.kind).toBe('not_started');
    const blank = field({ label: '' });
    expect(stepStates(ctx(c, [phase()], [blank])).form).toMatchObject({ kind: 'attention', count: 1 });
    expect(stepStates(ctx(c, [phase()], [field()])).form.kind).toBe('complete');
  });
  it('team: ✓ once someone besides the creator is on it; Review: all the issues, then ✓ when General, Phases and Form are complete', () => {
    const c = call({ name: 'INNOV-ID', opensAt: '2026-11-01T09:00:00Z', closesAt: '2026-12-01T09:00:00Z' });
    const ph = [phase({ name: 'Applications', startsOn: '2026-11-01' })];
    expect(stepStates(ctx(c, ph, [field()], 0)).team.kind).toBe('not_started');
    expect(stepStates(ctx(c, ph, [field()], 1)).team.kind).toBe('not_started');             // only the creator
    expect(stepStates(ctx(c, ph, [field()], 2)).team).toMatchObject({ kind: 'complete', icon: '✓' });
    expect(stepStates(ctx(c, ph, [field()])).review.kind).toBe('complete');
    expect(stepStates(ctx(call({ name: 'INNOV-ID' }), ph, [field()])).review).toMatchObject({ kind: 'attention', count: 2, label: '2 to fix' });
  });
});

describe('"What is missing" leads to the step and the field', () => {
  it('every issue knows its step, and — for the ones about one field — which one', () => {
    const issues = readiness({ name: '', opensAt: null, closesAt: null, status: 'draft' } as Call, [{ id: 'ph-1', name: '' } as CallPhase], [{ ...newField('short_text', 1, 0), id: 'q-1', label: '' }], new Date('2026-10-16T12:00:00Z'));
    expect(issues.map((i) => [stepOfIssue(i), i.target])).toEqual([['general', 'name'], ['general', 'opens'], ['general', 'closes'], ['phases', 'ph-1'], ['form', 'q-1']]);
  });
});
