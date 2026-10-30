// Prompt 922 (Adenda 1, C) — how the load is shared: Weighted (30/50/20 with 10 applications and N = 1 gives 3/5/2; a maximum per evaluator), By rules (single choice, multiple choice, Yes/No and a range of an amount;
// "first matching" and "all matching"; the fallback and "Unassigned"; a panel smaller than N; conflicts inside a panel; the applications that arrive later; a change of rules that does not touch what is fixed).
import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOC, allocate, allocProblems, apportion, conditionHolds, freshAlloc, matchedRules, panelsFor, parseAlloc, type AllocConfig, type AllocInput, type Panel, type Rule } from './eval-allocation';
import type { FormField } from './types';

const F = (id: string, kind: FormField['kind'], label: string, options: string[] = []): Pick<FormField, 'id' | 'kind' | 'label' | 'options'> => ({ id, kind, label, options: options.map((o, i) => ({ id: `${id}-o${i}`, label: o })) });
const SECTOR = F('sector', 'single_choice', 'Sector', ['Health', 'Fintech', 'Energy']);
const TECH = F('tech', 'multiple_choice', 'Technologies', ['AI', 'Hardware']);
const GRANT = F('grant', 'yes_no', 'Grant?');
const RAISED = F('raised', 'number', 'Investment received');
const FIELDS = [SECTOR, TECH, GRANT, RAISED];

const apps = (n: number, answers: (i: number) => Record<string, unknown> = () => ({})) => Array.from({ length: n }, (_, i) => ({ applicationId: `a${String(i + 1).padStart(2, '0')}`, answers: answers(i) }));
const input = (over: Partial<AllocInput> & { config: AllocConfig }): AllocInput => ({ applications: apps(10), fields: FIELDS, evaluators: ['ana', 'bruno', 'carla'], n: 1, existing: [], blocked: [], replan: false, ...over });
const counts = (out: ReturnType<typeof allocate>, users: string[]) => users.map((u) => out.add.filter((p) => p.userId === u).length);
const weighted = (percent: Record<string, number>, by: 'percent' | 'max' = 'percent', max: Record<string, number> = {}): AllocConfig => ({ ...freshAlloc(), strategy: 'weighted', weighted: { by, percent, max } });
const panel = (id: string, name: string, members: string[], over: Partial<Panel> = {}): Panel => ({ id, name, members, balance: 'equal', percent: {}, shortfall: null, ...over });
const rule = (id: string, panelId: string, conditions: Rule['conditions']): Rule => ({ id, panelId, conditions });
const isSector = (name: string) => ({ fieldId: 'sector', type: 'choice' as const, optionIds: [`sector-o${['Health', 'Fintech', 'Energy'].indexOf(name)}`] });

describe('equal is what it always was', () => {
  it('ten applications among three evaluators: 4 / 3 / 3 (the first by id takes the extra one)', () => {
    expect(counts(allocate(input({ config: DEFAULT_ALLOC })), ['ana', 'bruno', 'carla'])).toEqual([4, 3, 3]);
  });
});

describe('weighted', () => {
  it('30 / 50 / 20 with 10 applications and one evaluator each gives 3 / 5 / 2', () => {
    const out = allocate(input({ config: weighted({ ana: 30, bruno: 50, carla: 20 }) }));
    expect(counts(out, ['ana', 'bruno', 'carla'])).toEqual([3, 5, 2]);
    expect(out.evaluators).toEqual([{ userId: 'ana', requested: 30, limit: null, got: 3 }, { userId: 'bruno', requested: 50, limit: null, got: 5 }, { userId: 'carla', requested: 20, limit: null, got: 2 }]);
  });
  it('with two evaluators per application the shares apply to all the places: 20 places → 6 / 10 / 4, nobody twice on the same application', () => {
    const out = allocate(input({ config: weighted({ ana: 30, bruno: 50, carla: 20 }), n: 2 }));
    expect(counts(out, ['ana', 'bruno', 'carla'])).toEqual([6, 10, 4]);
    for (const a of apps(10)) expect(new Set(out.add.filter((p) => p.applicationId === a.applicationId).map((p) => p.userId)).size).toBe(2);
  });
  it('the number of evaluators per application and the conflicts still hold: a blocked pair is never chosen, and the share is met by the others', () => {
    const blocked = [{ applicationId: 'a01', userId: 'bruno' }, { applicationId: 'a02', userId: 'bruno' }];
    const out = allocate(input({ config: weighted({ ana: 30, bruno: 50, carla: 20 }), blocked }));
    expect(out.add.some((p) => p.userId === 'bruno' && ['a01', 'a02'].includes(p.applicationId))).toBe(false);
    expect(counts(out, ['ana', 'bruno', 'carla'])).toEqual([3, 5, 2]);
  });
  it('a maximum per evaluator is a hard limit; the rest is shared equally, and what does not fit is said', () => {
    const out = allocate(input({ config: weighted({}, 'max', { ana: 2, bruno: 3, carla: 100 }) }));
    expect(counts(out, ['ana', 'bruno', 'carla'])).toEqual([2, 3, 5]);
    const tight = allocate(input({ config: weighted({}, 'max', { ana: 2, bruno: 3, carla: 1 }) }));
    expect(counts(tight, ['ana', 'bruno', 'carla'])).toEqual([2, 3, 1]);
    expect(tight.shortfalls).toHaveLength(4);
    expect(tight.shortfalls[0]).toMatchObject({ wanted: 1, got: 0, reason: 'capacity' });
  });
  it('what is already assigned counts: an application that arrives later goes where the shares need it', () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({ applicationId: `a${String(i + 1).padStart(2, '0')}`, userId: i < 3 ? 'ana' : i < 8 ? 'bruno' : 'carla', fixed: false }));
    const later = allocate(input({ config: weighted({ ana: 30, bruno: 50, carla: 20 }), applications: [...apps(10), { applicationId: 'a11', answers: {} }, { applicationId: 'a12', answers: {} }], existing }));
    expect(later.add.map((p) => p.userId).sort()).toEqual(['ana', 'bruno']);               // 12 in all: 3.6 / 6 / 2.4 → ana and bruno are the ones under their share
  });
  it('a change of the shares re-decides what is not fixed and tells what moves; what is fixed stays', () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({ applicationId: `a${String(i + 1).padStart(2, '0')}`, userId: ['ana', 'bruno', 'carla'][i % 3], fixed: i === 0 }));       // a01 is started
    const out = allocate(input({ config: weighted({ ana: 10, bruno: 10, carla: 80 }), existing, replan: true }));
    expect(out.remove.every((p) => p.applicationId !== 'a01')).toBe(true);
    const finalLoads = existing.filter((e) => !out.remove.some((r) => r.applicationId === e.applicationId && r.userId === e.userId)).length + out.add.length;
    expect(finalLoads).toBe(10);
    expect(out.loads.carla).toBeGreaterThanOrEqual(7);
  });
  it('the percentages must add up to 100 before it can be applied, in words; the maximums need a number', () => {
    const ctx = { evaluators: [{ userId: 'ana', name: 'Ana' }, { userId: 'bruno', name: 'Bruno' }], fields: FIELDS, n: 1 as const };
    expect(allocProblems(weighted({ ana: 30, bruno: 50 }), ctx)).toEqual(['Weighted: the percentages add up to 80 %, not 100 % (20 % missing).']);
    expect(allocProblems(weighted({ ana: 60, bruno: 50 }), ctx)).toEqual(['Weighted: the percentages add up to 110 %, not 100 % (10 % over).']);
    expect(allocProblems(weighted({ ana: 50, bruno: 50 }), ctx)).toEqual([]);
    expect(allocProblems(weighted({}, 'max', { ana: 4 }), ctx)).toEqual(['Weighted: give Bruno a maximum number of applications.']);
    expect(allocProblems({ ...freshAlloc() }, ctx)).toEqual([]);                           // equal needs nothing
  });
  it('the apportionment is whole numbers that add up, with the largest fractions first', () => {
    expect(apportion(10, { a: 30, b: 50, c: 20 })).toEqual({ a: 3, b: 5, c: 2 });
    expect(apportion(7, { a: 1, b: 1, c: 1 })).toEqual({ a: 3, b: 2, c: 2 });
    expect(Object.values(apportion(11, { a: 33.3, b: 33.3, c: 33.4 })).reduce((x, y) => x + y, 0)).toBe(11);
  });
});

describe('by rules', () => {
  const health = ['ana', 'bruno']; const seed = ['carla'];
  const base: AllocConfig = {
    ...freshAlloc(), strategy: 'rules', panels: [panel('p-health', 'Health panel', health), panel('p-seed', 'Seed panel', seed)],
    rules: [rule('r1', 'p-health', [isSector('Health')]), rule('r2', 'p-seed', [{ fieldId: 'raised', type: 'range', min: 0, max: 250000 }])],
  };
  const sectors = ['Health', 'Fintech'];
  const answers = (i: number) => ({ sector: `sector-o${i % 2}`, raised: i % 2 === 0 ? '100000' : '500000' });

  it('single choice: a sector sends the application to its panel, equally inside it', () => {
    const out = allocate(input({ config: { ...base, fallback: 'equal' }, applications: apps(10, answers) }));
    const healthApps = apps(10, answers).filter((a) => a.answers.sector === 'sector-o0').map((a) => a.applicationId);
    expect(out.add.filter((p) => healthApps.includes(p.applicationId)).every((p) => health.includes(p.userId))).toBe(true);
    expect(counts(out, health).sort()).not.toEqual([0, 0]);
    expect(out.matched['a01']).toEqual(['p-health']);
    expect(sectors).toHaveLength(2);
  });
  it('multiple choice (contains), Yes/No and a range of an amount each route an application', () => {
    const fields = FIELDS;
    expect(conditionHolds({ fieldId: 'tech', type: 'choice', optionIds: ['tech-o0'] }, fields.find((f) => f.id === 'tech'), ['tech-o0', 'tech-o1'])).toBe(true);
    expect(conditionHolds({ fieldId: 'tech', type: 'choice', optionIds: ['tech-o1'] }, fields.find((f) => f.id === 'tech'), ['tech-o0'])).toBe(false);
    expect(conditionHolds({ fieldId: 'grant', type: 'yes_no', yes: true }, GRANT as never, 'yes')).toBe(true);
    expect(conditionHolds({ fieldId: 'grant', type: 'yes_no', yes: true }, GRANT as never, 'no')).toBe(false);
    expect(conditionHolds({ fieldId: 'grant', type: 'yes_no', yes: false }, GRANT as never, undefined)).toBe(false);          // no answer never matches
    const range = { fieldId: 'raised', type: 'range' as const, min: 0, max: 250000 };
    expect([0, 250000, 250001, -1].map((v) => conditionHolds(range, RAISED as never, String(v)))).toEqual([true, true, false, false]);
    expect(conditionHolds({ ...range, min: 1000, max: null }, RAISED as never, '999')).toBe(false);
    expect(conditionHolds({ ...range, min: 1000, max: null }, RAISED as never, '5 000 000')).toBe(true);
    expect(conditionHolds(range, RAISED as never, '')).toBe(false);
  });
  it('several conditions in one rule must ALL hold (AND)', () => {
    const r = rule('r', 'p-health', [isSector('Health'), { fieldId: 'grant', type: 'yes_no', yes: true }]);
    expect(matchedRules({ rules: [r] }, FIELDS, { sector: 'sector-o0', grant: 'yes' })).toHaveLength(1);
    expect(matchedRules({ rules: [r] }, FIELDS, { sector: 'sector-o0', grant: 'no' })).toHaveLength(0);
  });
  it('"first matching rule" (the default) or "all matching panels" when an application meets several', () => {
    const both = { sector: 'sector-o0', raised: '100000' };                                  // Health AND under 250 000
    expect(panelsFor({ rules: base.rules, multi: 'first' }, FIELDS, both)).toEqual(['p-health']);
    expect(panelsFor({ rules: base.rules, multi: 'all' }, FIELDS, both)).toEqual(['p-health', 'p-seed']);
    const out = allocate(input({ config: { ...base, multi: 'all' }, applications: [{ applicationId: 'x1', answers: both }] }));
    expect(out.add.map((p) => p.userId).sort()).toEqual([health[0], 'carla']);               // N = 1 inside EACH panel
    expect(out.matched['x1']).toEqual(['p-health', 'p-seed']);
  });
  it('an application that meets no rule follows the fallback: everybody equally, or the weighted shares, or "Unassigned"', () => {
    const none = [{ applicationId: 'n1', answers: { sector: 'sector-o2', raised: '999999' } }, { applicationId: 'n2', answers: { sector: 'sector-o1', raised: '999999' } }];
    const eq = allocate(input({ config: { ...base, fallback: 'equal' }, applications: none }));
    expect(eq.add).toHaveLength(2); expect(eq.unassigned).toEqual([]);
    const w = allocate(input({ config: { ...base, fallback: 'weighted', weighted: { by: 'percent', percent: { ana: 0, bruno: 0, carla: 100 }, max: {} } }, applications: none }));
    expect(w.add.map((p) => p.userId)).toEqual(['carla', 'carla']);
    const un = allocate(input({ config: { ...base, fallback: 'unassigned' }, applications: none }));
    expect(un.add).toEqual([]); expect(un.unassigned).toEqual(['n1', 'n2']);
  });
  it('inside a panel the load can be by percentage', () => {
    const cfg: AllocConfig = { ...base, panels: [panel('p-health', 'Health panel', health, { balance: 'percent', percent: { ana: 75, bruno: 25 } }), base.panels[1]] };
    const out = allocate(input({ config: cfg, applications: apps(8, () => ({ sector: 'sector-o0' })) }));
    expect(counts(out, health)).toEqual([6, 2]);
    expect(out.panels.find((p) => p.panelId === 'p-health')!.evaluators).toEqual([{ userId: 'ana', requested: 75, got: 6 }, { userId: 'bruno', requested: 25, got: 2 }]);
  });
  it('a panel smaller than N: a warning, nothing to apply until the entity chooses; "lower" gives the whole panel, "complete" fills from outside', () => {
    const small: AllocConfig = { ...base, panels: [panel('p-health', 'Health panel', ['ana']), base.panels[1]] };
    const one = [{ applicationId: 'h1', answers: { sector: 'sector-o0' } }];
    const unchosen = allocate(input({ config: small, applications: one, n: 2 }));
    expect(unchosen.needsChoice).toEqual(['Health panel']);
    expect(unchosen.warning).toContain('Health panel');
    expect(unchosen.panels[0]).toMatchObject({ size: 1, short: true, needsChoice: true });
    const lower = allocate(input({ config: { ...small, panels: [panel('p-health', 'Health panel', ['ana'], { shortfall: 'lower' }), base.panels[1]] }, applications: one, n: 2 }));
    expect(lower.add.map((p) => p.userId)).toEqual(['ana']); expect(lower.needsChoice).toEqual([]);
    const complete = allocate(input({ config: { ...small, panels: [panel('p-health', 'Health panel', ['ana'], { shortfall: 'complete' }), base.panels[1]] }, applications: one, n: 2 }));
    expect(complete.add.map((p) => p.userId).sort()).toEqual(['ana', 'bruno']);
    expect(complete.needsChoice).toEqual([]);
  });
  it('conflicts inside a panel: the blocked person is never chosen, and the panel may fall short', () => {
    const out = allocate(input({ config: { ...base, panels: [panel('p-health', 'Health panel', health, { shortfall: 'lower' }), base.panels[1]] }, applications: [{ applicationId: 'h1', answers: { sector: 'sector-o0' } }], n: 2, blocked: [{ applicationId: 'h1', userId: 'ana' }] }));
    expect(out.add.map((p) => p.userId)).toEqual(['bruno']);
    expect(out.shortfalls[0]).toMatchObject({ applicationId: 'h1', got: 1 });
  });
  it('the applications that arrive later follow the same rules, counting what is assigned', () => {
    const existing = [{ applicationId: 'h0', userId: 'ana', fixed: false }];
    const out = allocate(input({ config: base, applications: [{ applicationId: 'h0', answers: { sector: 'sector-o0' } }, { applicationId: 'h1', answers: { sector: 'sector-o0' } }], existing }));
    expect(out.add).toEqual([{ applicationId: 'h1', userId: 'bruno' }]);                  // ana already has one: the new one goes to bruno
  });
  it('changing the rules re-decides what has not started, and never touches what is fixed (started or by hand)', () => {
    const existing = [{ applicationId: 'h1', userId: 'carla', fixed: false }, { applicationId: 'h2', userId: 'carla', fixed: true }];
    const out = allocate(input({ config: base, applications: [{ applicationId: 'h1', answers: { sector: 'sector-o0' } }, { applicationId: 'h2', answers: { sector: 'sector-o0' } }], existing, replan: true }));
    expect(out.remove).toEqual([{ applicationId: 'h1', userId: 'carla' }]);                // h1 is Health now: it leaves the Seed panel's person
    expect(out.add.map((p) => p.applicationId)).toEqual(['h1']);
    expect(out.remove.some((p) => p.applicationId === 'h2')).toBe(false);                  // h2 keeps carla, who already started it
  });
});

describe('reading and checking what the editor sends', () => {
  it('is read strictly but may be incomplete; unknown things are refused', () => {
    expect(parseAlloc({ strategy: 'whatever' })).toMatchObject({ ok: false });
    expect(parseAlloc({ strategy: 'rules', panels: [{ id: 'p1', name: '  Health   panel ', members: ['ana', 'ana'] }], rules: [{ id: 'r1', panelId: 'p1', conditions: [] }] })).toMatchObject({ ok: true, config: { panels: [{ name: 'Health panel', members: ['ana'], balance: 'equal', shortfall: null }], multi: 'first', fallback: 'equal' } });
    expect(parseAlloc({ strategy: 'weighted', weighted: { percent: { ana: 120 } } })).toMatchObject({ ok: false });
    expect(parseAlloc({ strategy: 'weighted', weighted: { by: 'max', max: { ana: 1.5 } } })).toMatchObject({ ok: false });
    expect(parseAlloc({ strategy: 'rules', rules: [{ id: 'r1', panelId: 'p', conditions: [{ fieldId: 'x', type: 'range', min: 'a' }] }] })).toMatchObject({ ok: false });
    expect(parseAlloc({ strategy: 'rules', panels: [{ id: 'p1' }, { id: 'p1' }] })).toMatchObject({ ok: false });
  });
  it('says what is missing for rules: a panel without people or name, a rule without panel or condition, a question that left the form, a choice with no answer', () => {
    const ctx = { evaluators: [{ userId: 'ana', name: 'Ana' }], fields: FIELDS, n: 1 as const };
    const cfg: AllocConfig = { ...freshAlloc(), strategy: 'rules', panels: [panel('p1', '', [])], rules: [rule('r1', 'nope', []), rule('r2', 'p1', [{ fieldId: 'gone', type: 'yes_no', yes: true }, { fieldId: 'sector', type: 'choice', optionIds: [] }, { fieldId: 'raised', type: 'range', min: null, max: null }])] };
    const p = allocProblems(cfg, ctx);
    expect(p).toEqual(expect.arrayContaining([
      'Give every panel a name.', 'Panel “unnamed” has no evaluators.', 'Rule 1: choose the panel it sends the application to.', 'Rule 1: add a condition.',
      'Rule 2: a condition is about a question that is not in the form any more.', 'Rule 2: choose at least one answer of “Sector”.', 'Rule 2: give the range of “Investment received” a minimum or a maximum.',
    ]));
    const ok: AllocConfig = { ...freshAlloc(), strategy: 'rules', panels: [panel('p1', 'Health', ['ana'])], rules: [rule('r1', 'p1', [isSector('Health')])] };
    expect(allocProblems(ok, ctx)).toEqual([]);
    expect(allocProblems({ ...ok, panels: [panel('p1', 'Health', ['ana', 'gone'])] }, ctx)).toEqual(['Panel “Health” has 1 person who can no longer evaluate: take them out.']);
    expect(allocProblems({ ...ok, panels: [panel('p1', 'Health', ['ana'])] }, { ...ctx, n: 3 })).toEqual(['Panel “Health” has 1 evaluator but each application needs 3: choose to complete with other evaluators or to lower the number for this panel.']);
  });
});
