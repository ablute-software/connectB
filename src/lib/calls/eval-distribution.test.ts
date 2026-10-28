// Prompt 922 (I2) — the balanced distribution: N = 1, 2, 5 and "all", N larger than the team (with a warning), the load kept equal, new applications joining, conflicts (never assigned; removed and redone),
// and the automatic conflicts of interest (membership, the same company domain — never a generic mailbox —, the same startup as an applicant).
import { describe, expect, it } from 'vitest';
import { CONFLICT_TEXT, autoConflict, distribute, loadsOf, redistribute, type Pair } from './eval-distribution';

const apps = (n: number) => Array.from({ length: n }, (_, i) => ({ applicationId: `a${String(i + 1).padStart(2, '0')}` }));
const team = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `u${i + 1}` }));
const perApp = (pairs: Pair[]) => { const m: Record<string, string[]> = {}; for (const p of pairs) (m[p.applicationId] ??= []).push(p.userId); return m; };
const spread = (loads: Record<string, number>) => Math.max(...Object.values(loads)) - Math.min(...Object.values(loads));

describe('the number of evaluators per application', () => {
  for (const n of [1, 2, 5]) {
    it(`N = ${n}: every application gets exactly ${n} different evaluators and the load is equal (never more than one apart)`, () => {
      const r = distribute({ applications: apps(23), evaluators: team(7), n, existing: [], blocked: [] });
      for (const list of Object.values(perApp(r.add))) { expect(list).toHaveLength(n); expect(new Set(list).size).toBe(n); }
      expect(r.add).toHaveLength(23 * n);
      expect(spread(r.loads)).toBeLessThanOrEqual(1);
      expect(r.shortfalls).toEqual([]);
      expect(r.warning).toBeNull();
    });
  }
  it('"all": every evaluator gets every application', () => {
    const r = distribute({ applications: apps(4), evaluators: team(3), n: 'all', existing: [], blocked: [] });
    expect(r.add).toHaveLength(12);
    expect(Object.values(perApp(r.add)).every((l) => l.length === 3)).toBe(true);
    expect(r.loads).toEqual({ u1: 4, u2: 4, u3: 4 });
  });
  it('N larger than the team: everybody available is used, and it says so', () => {
    const r = distribute({ applications: apps(3), evaluators: team(3), n: 5, existing: [], blocked: [] });
    expect(r.effectiveN).toBe(3);
    expect(r.add).toHaveLength(9);
    expect(r.warning).toBe('5 evaluators per application were asked for but only 3 people can evaluate: every application gets all 3.');
    expect(r.shortfalls).toEqual([]);
    expect(distribute({ applications: apps(1), evaluators: [], n: 2, existing: [], blocked: [] }).warning).toContain('nobody can be assigned yet');
    expect(distribute({ applications: apps(1), evaluators: team(1), n: 2, existing: [], blocked: [] }).warning).toContain('that person');
  });
  it('is stable: the same input gives the same assignments', () => {
    const a = distribute({ applications: apps(10), evaluators: team(4), n: 2, existing: [], blocked: [] });
    const b = distribute({ applications: apps(10), evaluators: team(4), n: 2, existing: [], blocked: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('new applications and existing work', () => {
  it('a new application joining later goes to the evaluators with the least work; what was assigned stays', () => {
    const first = distribute({ applications: apps(6), evaluators: team(3), n: 1, existing: [], blocked: [] });
    expect(first.loads).toEqual({ u1: 2, u2: 2, u3: 2 });
    // u3 has done nothing and u1/u2 keep their two each; a 7th application arrives: it goes to the first of the least loaded (a tie: stable by id)
    const second = distribute({ applications: [...apps(6), { applicationId: 'a07' }], evaluators: team(3), n: 1, existing: first.add, blocked: [] });
    expect(second.add).toHaveLength(1);
    expect(second.add[0].applicationId).toBe('a07');
    expect(spread(second.loads)).toBeLessThanOrEqual(1);
  });
  it('an application that has some evaluators is only completed, never reassigned', () => {
    const existing: Pair[] = [{ applicationId: 'a01', userId: 'u1' }];
    const r = distribute({ applications: apps(1), evaluators: team(3), n: 2, existing, blocked: [] });
    expect(r.add).toHaveLength(1);
    expect(r.add[0].userId).not.toBe('u1');
  });
});

describe('conflicts: never assigned; removed and redone', () => {
  it('a blocked pair is never assigned; with too few people left the application is short, and it says how many', () => {
    const r = distribute({ applications: apps(1), evaluators: team(2), n: 2, existing: [], blocked: [{ applicationId: 'a01', userId: 'u1' }] });
    expect(r.add).toEqual([{ applicationId: 'a01', userId: 'u2' }]);
    expect(r.shortfalls).toEqual([{ applicationId: 'a01', wanted: 2, got: 1 }]);
  });
  it('a conflict found after the assignment: it is removed and the application is filled in again with someone else, balancing the load', () => {
    const first = distribute({ applications: apps(4), evaluators: team(4), n: 1, existing: [], blocked: [] });
    const victim = first.add.find((p) => p.applicationId === 'a01')!;
    const r = redistribute({ applications: apps(4), evaluators: team(4), n: 1, existing: first.add, blocked: [{ applicationId: 'a01', userId: victim.userId }] });
    expect(r.remove).toEqual([victim]);
    expect(r.add).toHaveLength(1);
    expect(r.add[0].applicationId).toBe('a01');
    expect(r.add[0].userId).not.toBe(victim.userId);
    expect(r.shortfalls).toEqual([]);
  });
  it('a person who is no longer an evaluator loses their assignments, which are redistributed (the preview says what changes before anything is applied)', () => {
    const first = distribute({ applications: apps(6), evaluators: team(3), n: 1, existing: [], blocked: [] });
    const r = redistribute({ applications: apps(6), evaluators: team(3).filter((e) => e.userId !== 'u3'), n: 1, existing: first.add, blocked: [] });
    expect(r.remove.every((p) => p.userId === 'u3')).toBe(true);
    expect(r.remove).toHaveLength(2);
    expect(r.add).toHaveLength(2);
    expect(spread(r.loads)).toBeLessThanOrEqual(1);
  });
  it('the loads of a set of assignments', () => {
    expect(loadsOf([{ applicationId: 'a', userId: 'u1' }, { applicationId: 'b', userId: 'u1' }, { applicationId: 'b', userId: 'u2' }], ['u1', 'u2', 'u3'])).toEqual({ u1: 2, u2: 1, u3: 0 });
  });
});

describe('the automatic conflicts of interest', () => {
  const app = { applicationId: 'a', startupOrgId: 'o', memberUserIds: ['m1', 'm2'], memberEmails: ['ana@acme.pt', 'bruno@acme.pt'], applicantUserIds: ['m1'] };
  const ev = (userId: string, email: string | null) => autoConflict({ userId, email, application: app });
  it('the evaluator is a member of the applying startup', () => {
    expect(ev('m2', 'x@whatever.com')).toEqual({ code: 'member_of_applicant_org', text: CONFLICT_TEXT.member_of_applicant_org });
  });
  it('the same company email domain as a member of the startup — but never a generic mailbox', () => {
    expect(ev('t1', 'rita@acme.pt')?.code).toBe('same_domain');
    expect(ev('t1', 'rita@ACME.PT')?.code).toBe('same_domain');
    expect(autoConflict({ userId: 't1', email: 'rita@gmail.com', application: { ...app, memberEmails: ['ana@gmail.com'] } })).toBeNull();
    expect(ev('t1', 'rita@other.com')).toBeNull();
    expect(ev('t1', null)).toBeNull();
  });
  it('the evaluator already applied for the same startup, as an applicant', () => {
    expect(autoConflict({ userId: 'x9', email: null, application: { ...app, memberUserIds: [], applicantUserIds: ['x9'] } })?.code).toBe('also_applicant');
  });
});
