// Prompt 927 (A) — the startups that applied to a call reach the pipeline of the right people of the firm, with the tag: administrators of the call see the submitted applications that were told about the deal
// flow; an evaluator only the ones assigned to them and never in a blind call; drafts never; an investor of another organisation nothing at all; the older applications only through "Add applicants to my pipeline".
import { beforeEach, describe, expect, it } from 'vitest';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';
import { ALL_PERMISSIONS, NO_PERMISSIONS } from './permissions';
import { loadCallPipelineSource } from './call-pipeline';

let db: CallsDb;
const E = '11111111-1111-4111-8111-111111111111';   // the firm that runs the calls
const F = '22222222-2222-4222-8222-222222222222';   // another firm
const C1 = 'c1000000-0000-4000-8000-000000000001';
const C2 = 'c2000000-0000-4000-8000-000000000002';
const C3 = 'c3000000-0000-4000-8000-000000000003';
const CI = 'c4000000-0000-4000-8000-000000000004';
const S = (n: number) => `5${n}000000-0000-4000-8000-00000000000${n}`;
const src = (userId: string, entity: string | null = E) => loadCallPipelineSource(fakeCallsAdmin(db), userId, entity);
const tagsOf = (s: Awaited<ReturnType<typeof src>>, org: string) => (s.byOrg.get(org) ?? []).map((t) => `${t.callName}:${t.role}`);

beforeEach(() => {
  db = callsDb();
  const call = (id: string, name: string, extra: Record<string, unknown> = {}) => db.tables.calls.push({ id, name, promoter_kind: 'catalog_entity', catalog_entity_id: E, status: 'open', created_at: `2026-10-0${id.slice(1, 2)}T00:00:00Z`, ...extra });
  call(C1, 'Call One'); call(C2, 'Call Two'); call(C3, 'Other firm call', { catalog_entity_id: F });
  db.tables.calls.push({ id: CI, name: 'Incubator call', promoter_kind: 'incubator', incubator_id: 'i1', catalog_entity_id: null, status: 'open', created_at: '2026-10-04T00:00:00Z' });
  db.tables.call_team_categories.push({ id: 'cat-admin', name: 'Administrator', catalog_entity_id: E, permissions: { ...ALL_PERMISSIONS } }, { id: 'cat-eval', name: 'Evaluator', catalog_entity_id: E, permissions: { ...NO_PERMISSIONS, evaluate_assigned: true } });
  for (const c of [C1, C2]) db.tables.call_team_members.push({ call_id: c, user_id: 'ana', category_id: 'cat-admin' }, { call_id: c, user_id: 'eva', category_id: 'cat-eval' });
  for (const [u, e] of [['ana', E], ['eva', E], ['otto', F]]) db.tables.matchdeal_investor_members.push({ id: `m-${u}`, user_id: u, catalog_entity_id: e, status: 'active', role: 'member' });
  const app = (id: string, call: string, org: number, extra: Record<string, unknown> = {}) => db.tables.call_applications.push({ id, call_id: call, startup_org_id: S(org), status: 'submitted', pipeline_notice_at: '2026-11-03T10:00:00Z', ...extra });
  app('a1', C1, 1); app('a2', C1, 2, { pipeline_notice_at: null }); app('a3', C1, 3, { status: 'draft' }); app('a4', C2, 4); app('a5', C2, 1); app('a9', C3, 9);
  db.tables.call_applications.push({ id: 'ai', call_id: CI, startup_org_id: S(8), status: 'submitted', pipeline_notice_at: '2026-11-03T10:00:00Z' });
  for (const a of ['a1', 'a2', 'a4']) db.tables.call_eval_assignments.push({ call_id: a === 'a4' ? C2 : C1, application_id: a, evaluator_user_id: 'eva', status: 'assigned' });
  db.tables.call_eval_settings.push({ call_id: C2, blind: true });
});

describe('who sees which startup', () => {
  it('an administrator sees the submitted applications that were told about the deal flow, a tag per call; never a draft, an older application, another firm call or an incubator call', async () => {
    const s = await src('ana');
    expect(tagsOf(s, S(1)).sort()).toEqual(['Call One:admin', 'Call Two:admin']);       // the same startup in two calls: two tags, one entry
    expect(tagsOf(s, S(4))).toEqual(['Call Two:admin']);
    for (const n of [2, 3, 8, 9]) expect(s.byOrg.has(S(n)), `S${n}`).toBe(false);
    expect([...s.byOrg.keys()].sort()).toEqual([S(1), S(4)]);
    expect(s.calls.map((c) => c.name)).toEqual(['Call Two', 'Call One']);               // newest first, only this firm
  });

  it('an evaluator sees only the applications assigned to them, never in a blind call, never one that was not told about the deal flow', async () => {
    const s = await src('eva');
    expect(tagsOf(s, S(1))).toEqual(['Call One:evaluator']);
    for (const n of [2, 3, 4]) expect(s.byOrg.has(S(n)), `S${n}`).toBe(false);          // S2: no notice; S4: blind call; S3: not assigned (and a draft)
    expect(s.byOrg.get(S(1))![0]).toMatchObject({ state: null, canOpen: true });
  });

  it('an assignment that was removed takes the startup out; turning blind on takes it out too', async () => {
    db.tables.call_eval_assignments.find((r) => r.application_id === 'a1')!.status = 'removed';
    expect((await src('eva')).byOrg.size).toBe(0);
    db.tables.call_eval_assignments.find((r) => r.application_id === 'a1')!.status = 'assigned';
    db.tables.call_eval_settings.push({ call_id: C1, blind: true });
    expect((await src('eva')).byOrg.size).toBe(0);
    expect((await src('ana')).byOrg.has(S(1))).toBe(true);                               // an administrator is not evaluating blind
  });

  it('an investor of ANOTHER organisation gets nothing — not the tag, not the fact that the startup applied', async () => {
    const s = await src('otto', F);
    expect(tagsOf(s, S(9))).toEqual([]);                                                   // otto is on no team of their own firm call and evaluates nothing
    for (const n of [1, 2, 3, 4, 8]) expect(s.byOrg.has(S(n)), `S${n}`).toBe(false);
    const asOtherFirm = await src('otto', E);                                              // even asking as the other firm: no team, no assignment there
    expect(asOtherFirm.byOrg.size).toBe(0);
    expect((await src('nobody', null)).byOrg.size).toBe(0);
  });
});

describe('the older applications, and the state', () => {
  it('"Add applicants to my pipeline" brings the ones that predate the notice into THAT administrator pipeline only', async () => {
    db.tables.call_pipeline_backfills.push({ call_id: C1, user_id: 'ana' });
    expect(tagsOf(await src('ana'), S(2))).toEqual(['Call One:admin']);
    expect((await src('eva')).byOrg.has(S(2))).toBe(false);
    expect((await src('ana')).byOrg.has(S(3))).toBe(false);                                // a draft is never brought in
  });

  it('the state of the application is shown only to whoever may see the applications of the call', async () => {
    db.tables.call_application_eligibility.push({ application_id: 'a1', status: 'fit', is_current: true }, { application_id: 'a4', status: 'not_fit', is_current: true });
    const s = await src('ana');
    expect(s.byOrg.get(S(1))!.find((t) => t.callName === 'Call One')).toMatchObject({ state: 'Fit', canOpen: true });
    expect(s.byOrg.get(S(4))![0].state).toBe('Not a fit');
    expect(s.byOrg.get(S(1))!.find((t) => t.callName === 'Call Two')!.state).toBe('Submitted');
    // an administrator who may configure but not view the applications sees the tag without the state and cannot open it
    db.tables.call_team_categories.find((c) => c.id === 'cat-admin')!.permissions = { ...ALL_PERMISSIONS, view_all_applications: false };
    const limited = await src('ana');
    expect(limited.byOrg.get(S(1))![0]).toMatchObject({ state: null, canOpen: false });
  });
});
