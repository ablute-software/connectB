// Prompt 922 (I2) — who evaluates what, through the real handlers and stores over the stateful fake database: only people with "Evaluate assigned applications" are evaluators; only submitted Fit applications are
// distributed; the load stays equal; a new Fit application joins by itself (unless the mode is manual) and one that stops being Fit is withdrawn (unless an evaluation was started); the automatic conflicts of
// interest (member of the startup, same company domain but never a generic mailbox, applicant of the same startup, a company declared up front) are never assigned and are recorded; "I have a conflict" removes,
// records (the reason is for the administrator only) and redistributes; the administrator's screen with a preview that writes nothing; the three modes; the evaluators are told once; the reminders go out once each;
// each call is isolated.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at?: string } | null;
const sent: { to: string; subject: string }[] = [];

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, rpc: async () => ({ data: false }), from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', async (orig) => ({
  ...(await orig<typeof import('@/lib/resend')>()), resendConfigured: true,
  sendTransactionalEmail: async (m: { to: string; subject: string }) => { sent.push({ to: m.to, subject: m.subject }); return { sent: true, id: 'em' }; },
}));

import { POST as createPost } from './route';
import { GET as distGet, POST as distPostRaw } from './[id]/distribution/route';
import { POST as conflictPost } from './[id]/evaluations/[applicationId]/conflict/route';
import { PUT as gridPut, GET as gridGet } from './[id]/eval-grid/route';
import { gather, plan, redistributeAll, saveMode, syncApplication, declareConflict, assignByHand } from '@/lib/calls/eval-assign-store';
import { reminderKind, sendEvaluationReminders } from '@/lib/calls/eval-reminders';
import { rowToCall } from '@/lib/calls/mappers';
import { ALL_PERMISSIONS, NO_PERMISSIONS } from '@/lib/calls/permissions';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: db.users.get(id)?.email ?? `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
const dist = (id: string, body: Record<string, unknown>) => distPostRaw(json('POST', body), params(id)).then(read);

let CALL = '';
let CALL_B = '';
const callOf = (id = CALL) => rowToCall(db.tables.calls.find((c) => c.id === id)!);
const assigned = (callId = CALL) => db.tables.call_eval_assignments.filter((a) => a.call_id === callId && a.status === 'assigned');
const perApp = () => { const m: Record<string, string[]> = {}; for (const a of assigned()) (m[a.application_id as string] ??= []).push(a.evaluator_user_id as string); return m; };
const load = (u: string) => assigned().filter((a) => a.evaluator_user_id === u).length;
const events = (name: string, callId = CALL) => db.tables.call_events.filter((e) => e.call_id === callId && e.event === name);

// Every person has a company domain of their own: a shared one would (correctly) read as "the same company domain as a member of the startup".
function person(id: string, email = `${id}@${id}.test`) { db.users.set(id, { id, email }); }
function firmMember(id: string, email?: string) {
  person(id, email);
  db.tables.matchdeal_investor_members.push({ id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' });
}
const category = (name: string, perms: Partial<typeof ALL_PERMISSIONS>) => {
  const id = `cat-${name}-${db.tables.call_team_categories.length}`;
  db.tables.call_team_categories.push({ id, catalog_entity_id: FIRM, incubator_id: null, name, permissions: { ...NO_PERMISSIONS, ...perms }, created_at: '2026-01-01T00:00:00.000Z' });
  return id;
};
function onTeam(callId: string, userId: string, categoryId: string, overrides: Record<string, boolean> = {}) {
  db.tables.call_team_members.push({ id: `tm-${callId.slice(0, 4)}-${userId}`, call_id: callId, user_id: userId, category_id: categoryId, permission_overrides: overrides, created_at: '2026-01-02T00:00:00.000Z' });
}
let n = 0;
function application(callId: string, opts: { status?: 'fit' | 'not_fit' | 'to_validate'; org?: string | null; applicant?: string; members?: { id: string; email: string }[]; reference?: string; orgName?: string } = {}) {
  n++;
  const id = `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const org = opts.org === undefined ? `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}` : opts.org;
  const applicant = opts.applicant ?? `ap-${n}`;
  if (!db.users.has(applicant)) db.users.set(applicant, { id: applicant, email: `${applicant}@startup${n}.com` });
  if (org && !db.tables.orgs.some((o) => o.id === org)) db.tables.orgs.push({ id: org, name: opts.orgName ?? `Startup ${n}` });
  for (const m of opts.members ?? []) { db.users.set(m.id, { id: m.id, email: m.email }); db.tables.org_members.push({ org_id: org, user_id: m.id }); }
  db.tables.call_applications.push({ id, call_id: callId, startup_org_id: org, applicant_user_id: applicant, status: 'submitted', reference: opts.reference ?? `REF-${String(n).padStart(3, '0')}`, draft_answers: {}, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' });
  db.tables.call_application_eligibility.push({ id: `el-${id}`, call_id: callId, application_id: id, status: opts.status ?? 'fit', is_current: true, source: 'engine', rule_results: [], overrides: {}, reason: '', created_at: '2026-10-11T00:00:00Z' });
  return id;
}
const setStatus = (appId: string, status: string) => { for (const e of db.tables.call_application_eligibility.filter((x) => x.application_id === appId)) e.is_current = false; db.tables.call_application_eligibility.push({ id: `el2-${appId}-${status}`, call_id: CALL, application_id: appId, status, is_current: true, source: 'human', rule_results: [], overrides: {}, reason: '', created_at: '2026-10-12T00:00:00Z' }); };

let EVALUATOR_CAT = '';
function evaluators(...ids: string[]) { for (const id of ids) { firmMember(id); onTeam(CALL, id, EVALUATOR_CAT); } }

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; currentUser = null; sent.length = 0; n = 0;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  firmMember('ana');
  db.tables.matchdeal_investor_members.find((m) => m.user_id === 'ana')!.role = 'admin';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  as('ana');
  CALL = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Evaluated Call' })))).body.call.id as string;
  CALL_B = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Other Call' })))).body.call.id as string;
  EVALUATOR_CAT = category('Evaluator', { evaluate_assigned: true });
  // The administrator holds every permission, "Evaluate assigned" included, so she would count as an evaluator: these tests are about the others, so she opts out.
  for (const m of db.tables.call_team_members.filter((x) => x.user_id === 'ana')) m.permission_overrides = { evaluate_assigned: false };
});

describe('who can evaluate and what is distributed', () => {
  it('only people with "Evaluate assigned applications" are evaluators — the category\'s, with the person\'s own adjustment on top; only submitted Fit applications are distributed', async () => {
    evaluators('u1', 'u2');
    firmMember('analyst'); onTeam(CALL, 'analyst', category('Analyst', { view_all_applications: true }));            // can read, cannot evaluate
    firmMember('adjusted'); onTeam(CALL, 'adjusted', category('Analyst 2', { view_all_applications: true }), { evaluate_assigned: true });   // an adjustment turns it on
    firmMember('muted'); onTeam(CALL, 'muted', EVALUATOR_CAT, { evaluate_assigned: false });                          // an adjustment turns it off
    const fit = [application(CALL), application(CALL), application(CALL)];
    application(CALL, { status: 'not_fit' }); application(CALL, { status: 'to_validate' });
    const g = await gather(fakeCallsAdmin(db, storage) as never, callOf());
    expect(g.evaluators.map((e) => e.userId).sort()).toEqual(['adjusted', 'u1', 'u2']);
    expect(g.apps.map((a) => a.applicationId).sort()).toEqual([...fit].sort());
    expect(g.n).toBe(2);
  });

  it('"Redistribute": each application gets N different evaluators, the load stays equal, the evaluators are told ONCE each, and the screen shows it', async () => {
    evaluators('u1', 'u2', 'u3');
    for (let i = 0; i < 6; i++) application(CALL);
    application(CALL, { status: 'not_fit' });
    const r = await dist(CALL, { action: 'redistribute' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ added: 12, removed: 0, mode: 'auto', unassigned: 0 });
    for (const list of Object.values(perApp())) { expect(list).toHaveLength(2); expect(new Set(list).size).toBe(2); }
    expect(Math.max(load('u1'), load('u2'), load('u3')) - Math.min(load('u1'), load('u2'), load('u3'))).toBeLessThanOrEqual(1);
    expect(db.tables.call_eval_assignments.filter((a) => a.source === 'auto').length).toBe(12);
    const notices = db.tables.call_notices.filter((x) => x.kind === 'eval_assigned');
    expect(notices.map((x) => x.user_id).sort()).toEqual(['u1', 'u2', 'u3']);
    expect(notices[0]).toMatchObject({ link_path: '/calls/evaluations' });
    expect(sent.map((s) => s.to).sort()).toEqual(['u1@u1.test', 'u2@u2.test', 'u3@u3.test']);
    expect(events('eval_redistributed')).toHaveLength(1);
    // doing it again changes nothing and tells nobody again
    const again = await dist(CALL, { action: 'redistribute' });
    expect(again.body).toMatchObject({ added: 0, removed: 0 });
    expect(sent).toHaveLength(3);
  });

  it('N larger than the team: everybody available is used and the screen says so; "all" assigns every evaluator to every application', async () => {
    evaluators('u1', 'u2');
    application(CALL); application(CALL);
    await gridPut(json('PUT', { baseRev: 0, criteria: [{ name: 'Team', weight: 100, scaleMin: 1, scaleMax: 5 }], settings: { evaluatorsPerApplication: 5, blind: false, commentRequiredForAll: false, divergence: { enabled: true, scalePct: 40, totalPct: 20 }, deadlines: [] } }), params(CALL));
    const r = await dist(CALL, { action: 'redistribute' });
    expect(r.body.warning).toBe('5 evaluators per application were asked for but only 2 people can evaluate: every application gets all 2.');
    expect(Object.values(perApp()).every((l) => l.length === 2)).toBe(true);
    const v = await gridGet(json('GET'), params(CALL)).then(read);
    await gridPut(json('PUT', { baseRev: v.body.rev, criteria: v.body.criteria, settings: { ...v.body.settings, evaluatorsPerApplication: 'all' } }), params(CALL));
    evaluators('u3');
    await dist(CALL, { action: 'redistribute' });
    expect(Object.values(perApp()).every((l) => l.length === 3)).toBe(true);
  });
});

describe('a new application, and one that stops being Fit', () => {
  it('a new Fit application is distributed by itself (auto and mixed), not in manual; one that stops being Fit loses the assignments nobody started', async () => {
    evaluators('u1', 'u2', 'u3');
    const a1 = application(CALL);
    await syncApplication(fakeCallsAdmin(db, storage) as never, callOf(), a1);
    expect(perApp()[a1]).toHaveLength(2);
    // manual: nothing by itself
    await saveMode(fakeCallsAdmin(db, storage) as never, CALL, 'manual', 'ana');
    const a2 = application(CALL);
    await syncApplication(fakeCallsAdmin(db, storage) as never, callOf(), a2);
    expect(perApp()[a2]).toBeUndefined();
    await saveMode(fakeCallsAdmin(db, storage) as never, CALL, 'mixed', 'ana');
    const a3 = application(CALL);
    await syncApplication(fakeCallsAdmin(db, storage) as never, callOf(), a3);
    expect(perApp()[a3]).toHaveLength(2);
    // a1 becomes Not a fit: the assignments nobody has started are withdrawn; one with a started evaluation stays
    const [first] = perApp()[a1];
    db.tables.call_evaluations.push({ id: 'ev-1', call_id: CALL, application_id: a1, evaluator_user_id: first, grid_version: 1, status: 'in_progress' });
    setStatus(a1, 'not_fit');
    await syncApplication(fakeCallsAdmin(db, storage) as never, callOf(), a1);
    expect(perApp()[a1]).toEqual([first]);
    expect(events('eval_unassigned').length).toBe(1);
  });

  it('the eligibility result itself triggers it: saving a Fit result distributes the application', async () => {
    evaluators('u1', 'u2');
    const a = application(CALL, { status: 'to_validate' });
    expect(perApp()[a]).toBeUndefined();
    const { saveEvaluation } = await import('@/lib/calls/eligibility-engine');
    await saveEvaluation(fakeCallsAdmin(db, storage) as never, { call: callOf(), applicationId: a, submissionId: 'sub-1', rulesVersion: 1, evaluation: { status: 'fit', reason: '', results: [] }, source: 'human', actor: 'ana' });
    expect(perApp()[a]).toHaveLength(2);
  });
});

describe('conflicts of interest', () => {
  it('a member of the applying startup, the same company domain, an applicant of the same startup, a company declared up front: never assigned, and recorded with who and why', async () => {
    evaluators('u1', 'u2', 'u3', 'u4', 'u5');
    db.users.set('u2', { id: 'u2', email: 'rita@acme.pt' });
    db.users.set('u4', { id: 'u4', email: 'nina@gmail.com' });
    firmMember('u6'); onTeam(CALL, 'u6', EVALUATOR_CAT);
    const app1 = application(CALL, { org: 'bbbbbbbb-1111-4111-8111-111111111111', orgName: 'Acme Robotics', members: [{ id: 'm1', email: 'ana@acme.pt' }, { id: 'u1', email: 'u1@u1.test' }] });
    db.users.set('ap-x', { id: 'ap-x', email: 'x@startupx.com' });
    // u3 is the applicant of ANOTHER application of the same startup, in this call
    const app2 = application(CALL, { org: 'bbbbbbbb-1111-4111-8111-111111111111', applicant: 'u3' });
    // u5 declared before the call that they have a conflict with this company
    db.tables.call_declared_conflicts.push({ id: 'dc-1', call_id: CALL, user_id: 'u5', company_name: 'ACME robotics', note: null, created_at: '2026-10-01T00:00:00Z' });
    // u4 shares only a generic mailbox domain with a member of the startup: no conflict
    db.users.set('m2', { id: 'm2', email: 'bob@gmail.com' }); db.tables.org_members.push({ org_id: 'bbbbbbbb-1111-4111-8111-111111111111', user_id: 'm2' });
    await dist(CALL, { action: 'redistribute' });
    for (const a of [app1, app2]) {
      const list = perApp()[a] ?? [];
      expect(list).not.toContain('u1'); expect(list).not.toContain('u2'); expect(list).not.toContain('u3'); expect(list).not.toContain('u5');
    }
    expect(perApp()[app1]).toEqual(expect.arrayContaining(['u4']));                                  // the generic mailbox did not block u4
    const recorded = db.tables.call_eval_conflicts.filter((c) => c.application_id === app1).map((c) => `${c.evaluator_user_id}:${c.code}`).sort();
    expect(recorded).toEqual(['u1:member_of_applicant_org', 'u2:same_domain', 'u3:also_applicant']);
    expect(db.tables.call_eval_conflicts.some((c) => c.application_id === app2 && c.evaluator_user_id === 'u3' && c.code === 'also_applicant')).toBe(true);
    expect(events('eval_conflict_found').length).toBeGreaterThanOrEqual(3);
    const screen = await read(await distGet(json('GET'), params(CALL)));
    expect(screen.body.conflicts.map((c: { evaluator: string; text: string }) => `${c.evaluator ?? ''}|${c.text}`)).toEqual(expect.arrayContaining([expect.stringContaining('is a member of the applying startup'), expect.stringContaining('declared, before the call')]));
  });

  it('a conflict found AFTER the assignment: the pair is removed and the application filled in again with someone else — but an evaluation already started is kept and reported', async () => {
    evaluators('u1', 'u2', 'u3', 'u4');
    const a = application(CALL, { org: 'bbbbbbbb-2222-4222-8222-222222222222' });
    await syncApplication(fakeCallsAdmin(db, storage) as never, callOf(), a);
    const [x, y] = perApp()[a];
    db.tables.org_members.push({ org_id: 'bbbbbbbb-2222-4222-8222-222222222222', user_id: x });          // x joins the startup later
    const pre = await dist(CALL, { action: 'preview' });
    expect(pre.body.remove).toMatchObject([{ userId: x, why: 'conflict of interest' }]);
    expect(pre.body.add).toHaveLength(1);
    expect(assigned().filter((r) => r.evaluator_user_id === x)).toHaveLength(1);                         // the preview wrote nothing
    const done = await dist(CALL, { action: 'redistribute' });
    expect(done.body).toMatchObject({ removed: 1, added: 1 });
    expect(perApp()[a]).toHaveLength(2); expect(perApp()[a]).not.toContain(x); expect(perApp()[a]).toContain(y);
    // now y also joins, but y already started evaluating: kept, and said so
    db.tables.org_members.push({ org_id: 'bbbbbbbb-2222-4222-8222-222222222222', user_id: y });
    db.tables.call_evaluations.push({ id: 'ev-y', call_id: CALL, application_id: a, evaluator_user_id: y, grid_version: 1, status: 'in_progress' });
    const pre2 = await dist(CALL, { action: 'preview' });
    expect(pre2.body.keptWithConflict).toMatchObject([{ userId: y }]);
    expect(pre2.body.remove).toEqual([]);
  });

  it('"I have a conflict": recorded with the optional reason (only the administrator sees it), the assignment and the unsent draft removed, the application given to someone else', async () => {
    evaluators('u1', 'u2', 'u3');
    const a = application(CALL);
    await syncApplication(fakeCallsAdmin(db, storage) as never, callOf(), a);
    const [mine] = perApp()[a];
    db.tables.call_evaluations.push({ id: 'ev-draft', call_id: CALL, application_id: a, evaluator_user_id: mine, grid_version: 1, status: 'in_progress' });
    as(mine);
    const r = await read(await conflictPost(json('POST', { note: 'I advised this startup last year.' }), { params: { id: CALL, applicationId: a } }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(perApp()[a]).toHaveLength(2); expect(perApp()[a]).not.toContain(mine);
    expect(db.tables.call_evaluations.some((e) => e.id === 'ev-draft')).toBe(false);
    expect(db.tables.call_eval_conflicts.find((c) => c.evaluator_user_id === mine)).toMatchObject({ kind: 'declared', note: 'I advised this startup last year.', declared_by: mine });
    expect(events('eval_conflict_declared')).toHaveLength(1);
    // the reason is shown to the administrator only
    as('ana');
    const screen = await read(await distGet(json('GET'), params(CALL)));
    expect(screen.body.conflicts.find((c: { kind: string }) => c.kind === 'declared')).toMatchObject({ note: 'I advised this startup last year.', resolved: true });
    as(mine);
    expect((await distGet(json('GET'), params(CALL))).status).toBe(403);
  });

  it('a conflict cannot be declared on an application that is not yours, nor after submitting; and only an evaluator can try', async () => {
    evaluators('u1', 'u2', 'u3');
    const a = application(CALL); await syncApplication(fakeCallsAdmin(db, storage) as never, callOf(), a);
    const [mine] = perApp()[a]; const outsider = ['u1', 'u2', 'u3'].find((u) => !perApp()[a].includes(u))!;
    as(outsider);
    expect((await read(await conflictPost(json('POST', {}), { params: { id: CALL, applicationId: a } }))).status).toBe(404);
    db.tables.call_evaluations.push({ id: 'ev-s', call_id: CALL, application_id: a, evaluator_user_id: mine, grid_version: 1, status: 'submitted' });
    as(mine);
    expect(await read(await conflictPost(json('POST', {}), { params: { id: CALL, applicationId: a } }))).toMatchObject({ status: 409, body: { error: expect.stringContaining('already submitted') } });
    firmMember('plain'); onTeam(CALL, 'plain', category('Reader', { view_all_applications: true }));
    as('plain');
    expect((await read(await conflictPost(json('POST', {}), { params: { id: CALL, applicationId: a } }))).status).toBe(403);
    as(null);
    expect((await read(await conflictPost(json('POST', {}), { params: { id: CALL, applicationId: a } }))).status).toBe(401);
  });
});

describe('the modes and the administrator\'s screen', () => {
  it('manual assigns nothing by itself; by hand (mixed/manual) refuses a conflict, a non-evaluator and a double assignment; automatic refuses hand moves; a started evaluation cannot be unassigned', async () => {
    evaluators('u1', 'u2');
    const a = application(CALL, { org: 'bbbbbbbb-3333-4333-8333-333333333333', members: [{ id: 'm9', email: 'm9@startup.com' }] });
    expect((await dist(CALL, { action: 'assign', applicationId: a, userId: 'u1' })).body.error).toContain('The distribution is automatic');
    expect((await dist(CALL, { action: 'mode', mode: 'nope' })).status).toBe(400);
    expect((await dist(CALL, { action: 'mode', mode: 'manual' })).body.mode).toBe('manual');
    expect((await dist(CALL, { action: 'redistribute' })).body).toMatchObject({ added: 0 });
    expect(assigned()).toHaveLength(0);
    expect((await dist(CALL, { action: 'assign', applicationId: a, userId: 'ana' })).body.error).toContain('cannot evaluate');
    db.tables.org_members.push({ org_id: 'bbbbbbbb-3333-4333-8333-333333333333', user_id: 'u2' });
    expect((await dist(CALL, { action: 'assign', applicationId: a, userId: 'u2' })).body.error).toContain('is a member of the applying startup');
    const ok = await dist(CALL, { action: 'assign', applicationId: a, userId: 'u1' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(db.tables.call_eval_assignments[0]).toMatchObject({ source: 'manual', assigned_by: 'ana', evaluator_user_id: 'u1' });
    expect((await dist(CALL, { action: 'assign', applicationId: a, userId: 'u1' })).body.error).toContain('already assigned');
    expect(db.tables.call_notices.filter((x) => x.kind === 'eval_assigned')).toHaveLength(1);
    db.tables.call_evaluations.push({ id: 'ev', call_id: CALL, application_id: a, evaluator_user_id: 'u1', grid_version: 1, status: 'in_progress' });
    expect((await dist(CALL, { action: 'unassign', applicationId: a, userId: 'u1' })).body.error).toContain('already started');
    db.tables.call_evaluations.length = 0;
    expect((await dist(CALL, { action: 'unassign', applicationId: a, userId: 'u1' })).status).toBe(200);
    expect(assigned()).toHaveLength(0);
  });

  it('the screen: the load of each evaluator, applications still short of evaluators, who may open it (Configure call only) and nothing for a closed evaluation', async () => {
    evaluators('u1');
    application(CALL); application(CALL);
    await dist(CALL, { action: 'redistribute' });
    const v = (await read(await distGet(json('GET'), params(CALL)))).body;
    expect(v).toMatchObject({ mode: 'auto', evaluatorsPerApplication: 2, effectiveN: 1, warning: expect.stringContaining('only 1 person can evaluate') });
    expect(v.evaluators).toMatchObject([{ userId: 'u1', assigned: 2, started: 0, submitted: 0 }]);
    expect(v.applications).toHaveLength(2);
    expect(v.applications.every((a: { short: boolean; evaluators: unknown[] }) => !a.short && a.evaluators.length === 1)).toBe(true);
    as('u1');
    expect((await distGet(json('GET'), params(CALL))).status).toBe(403);
    expect((await distPostRaw(json('POST', { action: 'redistribute' }), params(CALL))).status).toBe(403);
    as('ana');
    Object.assign(db.tables.calls.find((c) => c.id === CALL)!, { evaluation_closed_at: '2026-10-20T00:00:00Z' });
    expect((await dist(CALL, { action: 'redistribute' })).status).toBe(409);
  });

  it('each call is isolated: distributing one never touches another; the other call\'s team and applications are not read', async () => {
    evaluators('u1', 'u2');
    onTeam(CALL_B, 'u1', EVALUATOR_CAT);
    const a = application(CALL);
    const b = application(CALL_B);
    await dist(CALL, { action: 'redistribute' });
    expect(Object.keys(perApp())).toEqual([a]);
    expect(db.tables.call_eval_assignments.some((r) => r.application_id === b)).toBe(false);
    expect(assigned(CALL_B)).toHaveLength(0);
    const g = await gather(fakeCallsAdmin(db, storage) as never, callOf(CALL_B));
    expect(g.evaluators.map((e) => e.userId)).toEqual(['u1']);
    expect(g.apps.map((x) => x.applicationId)).toEqual([b]);
  });

  it('nothing is distributed twice by two quick moves (the unique assignment), and the plan is stable', async () => {
    evaluators('u1', 'u2', 'u3');
    for (let i = 0; i < 4; i++) application(CALL);
    const g = await gather(fakeCallsAdmin(db, storage) as never, callOf());
    expect(JSON.stringify(plan(g))).toBe(JSON.stringify(plan(g)));
    await redistributeAll(fakeCallsAdmin(db, storage) as never, callOf(), 'ana');
    const pairs = assigned().map((r) => `${r.application_id}:${r.evaluator_user_id}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(await assignByHand(fakeCallsAdmin(db, storage) as never, callOf(), Object.keys(perApp())[0], 'u1', 'ana')).toMatchObject({ ok: false });
    void declareConflict;
  });
});

describe('reminders to the evaluators', () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  async function withDeadline(offset: number) {
    evaluators('u1', 'u2');
    application(CALL);
    await dist(CALL, { action: 'redistribute' });
    const v = await gridGet(json('GET'), params(CALL)).then(read);
    const phaseId = db.tables.call_phases.find((p) => p.call_id === CALL)!.id as string;
    const put = await gridPut(json('PUT', { baseRev: v.body.rev, criteria: v.body.criteria, settings: { ...v.body.settings, deadlines: [{ phaseId, day: day(offset) }] } }), params(CALL)).then(read);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    sent.length = 0;
  }

  it('which reminder is due: 3 days (3 or 2 away), 1 day (1 away or the day itself), none before and none after', () => {
    expect([5, 4, 3, 2, 1, 0, -1].map(reminderKind)).toEqual([null, null, '3d', '3d', '1d', '1d', null]);
  });

  it('three days before the deadline: every evaluator with something pending is reminded once, by notice and email; the same day again sends nothing; the next day the 1-day one goes', async () => {
    await withDeadline(3);
    const run = await sendEvaluationReminders(fakeCallsAdmin(db, storage) as never, new Date());
    expect(run).toMatchObject({ calls: 1, reminded: 2 });
    expect(db.tables.call_notices.filter((x) => x.kind === 'eval_reminder').map((x) => x.title)).toEqual(Array(2).fill('Evaluation due in 3 days — Evaluated Call'));
    expect(sent.map((s) => s.to).sort()).toEqual(['u1@u1.test', 'u2@u2.test']);
    expect((await sendEvaluationReminders(fakeCallsAdmin(db, storage) as never, new Date())).reminded).toBe(0);
    const tomorrow = await sendEvaluationReminders(fakeCallsAdmin(db, storage) as never, new Date(Date.now() + 2 * 86_400_000));
    expect(tomorrow.reminded).toBe(2);
    expect(db.tables.call_notices.filter((x) => x.kind === 'eval_reminder' && String(x.title).startsWith('Evaluation due tomorrow'))).toHaveLength(2);
    expect(db.tables.call_eval_reminders).toHaveLength(4);
  });

  it('whoever already submitted is not reminded; a closed evaluation, an archived call and a deadline far away send nothing', async () => {
    await withDeadline(3);
    const a = assigned()[0];
    db.tables.call_evaluations.push({ id: 'ev', call_id: CALL, application_id: a.application_id, evaluator_user_id: a.evaluator_user_id, grid_version: 1, status: 'submitted' });
    expect((await sendEvaluationReminders(fakeCallsAdmin(db, storage) as never, new Date())).reminded).toBe(1);
    db.tables.call_eval_reminders.length = 0; db.tables.call_notices.length = 0;
    Object.assign(db.tables.calls.find((c) => c.id === CALL)!, { evaluation_closed_at: '2026-10-20T00:00:00Z' });
    expect((await sendEvaluationReminders(fakeCallsAdmin(db, storage) as never, new Date())).reminded).toBe(0);
    Object.assign(db.tables.calls.find((c) => c.id === CALL)!, { evaluation_closed_at: null });
    expect((await sendEvaluationReminders(fakeCallsAdmin(db, storage) as never, new Date(Date.now() - 10 * 86_400_000))).reminded).toBe(0);
  });
});
