// Prompt 922 (Adenda 1, C) — how the load is shared, through the real handlers and stores over the stateful fake database: Equal stays the default; Weighted (30/50/20 with 10 applications and one evaluator each gives
// 3/5/2); By rules (panels and rules over the answers, "first matching", the fallback and "Unassigned" which a person may assign even when the mode is automatic); what is incomplete is saved but cannot be applied
// (the server holds the line); a panel smaller than N must be chosen about; the rules freeze when the first evaluation is submitted and a change makes a new version after asking; an application that arrives later
// follows the same rules; a duplicated call gets the rules pointing to its own questions; only whoever configures the call.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at?: string } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, rpc: async () => ({ data: false }), from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', async (orig) => ({ ...(await orig<typeof import('@/lib/resend')>()), resendConfigured: true, sendTransactionalEmail: async () => ({ sent: true, id: 'em' }) }));

import { POST as createPost } from './route';
import { GET as distGet, POST as distPostRaw } from './[id]/distribution/route';
import { POST as duplicatePost } from './[id]/duplicate/route';
import { syncApplication } from '@/lib/calls/eval-assign-store';
import { rowToCall } from '@/lib/calls/mappers';
import { NO_PERMISSIONS, type ALL_PERMISSIONS } from '@/lib/calls/permissions';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: db.users.get(id)?.email ?? `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
const dist = (id: string, body: Record<string, unknown>) => distPostRaw(json('POST', body), { params: { id } }).then(read);
const view = (id = CALL) => distGet(json('GET'), { params: { id } }).then(read);

let CALL = '';
const SECTOR = 'f0000000-0000-4000-8000-000000000001';
const GRANT = 'f0000000-0000-4000-8000-000000000002';
const RAISED = 'f0000000-0000-4000-8000-000000000003';
const OPT = { health: 'sec-health', fintech: 'sec-fintech', energy: 'sec-energy' };
const callOf = (id = CALL) => rowToCall(db.tables.calls.find((c) => c.id === id)!);
const assigned = (callId = CALL) => db.tables.call_eval_assignments.filter((a) => a.call_id === callId && a.status === 'assigned');
const load = (u: string) => assigned().filter((a) => a.evaluator_user_id === u).length;

function firmMember(id: string) { db.users.set(id, { id, email: `${id}@${id}.test` }); db.tables.matchdeal_investor_members.push({ id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' }); }
const category = (name: string, perms: Partial<typeof ALL_PERMISSIONS>) => { const id = `cat-${name}-${db.tables.call_team_categories.length}`; db.tables.call_team_categories.push({ id, catalog_entity_id: FIRM, incubator_id: null, name, permissions: { ...NO_PERMISSIONS, ...perms }, created_at: '2026-01-01T00:00:00.000Z' }); return id; };
const onTeam = (callId: string, userId: string, categoryId: string, overrides: Record<string, boolean> = {}) => db.tables.call_team_members.push({ id: `tm-${callId.slice(0, 4)}-${userId}`, call_id: callId, user_id: userId, category_id: categoryId, permission_overrides: overrides, created_at: '2026-01-02T00:00:00.000Z' });
let seq = 0;
function application(callId: string, answers: Record<string, unknown> = {}) {
  seq++;
  const id = `aaaaaaaa-0000-4000-8000-${String(seq).padStart(12, '0')}`; const sub = `cccccccc-0000-4000-8000-${String(seq).padStart(12, '0')}`; const org = `bbbbbbbb-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  db.users.set(`ap-${seq}`, { id: `ap-${seq}`, email: `ap-${seq}@startup${seq}.com` }); db.tables.orgs.push({ id: org, name: `Startup ${seq}` });
  db.tables.call_applications.push({ id, call_id: callId, startup_org_id: org, applicant_user_id: `ap-${seq}`, status: 'submitted', reference: `REF-${String(seq).padStart(3, '0')}`, current_submission_id: sub, draft_answers: {}, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' });
  db.tables.call_application_eligibility.push({ id: `el-${id}`, call_id: callId, application_id: id, status: 'fit', is_current: true, source: 'engine', rule_results: [], overrides: {}, reason: '', created_at: '2026-10-11T00:00:00Z' });
  db.tables.call_application_submissions.push({ id: sub, application_id: id, version: 1, submitted_by: `ap-${seq}`, submitted_at: '2026-10-10T00:00:00Z', idempotency_key: `k${seq}`, form_snapshot: { fields: [] }, answers, documents: [] });
  return id;
}
const withSector = (s: string) => ({ [SECTOR]: OPT[s as keyof typeof OPT] });
const setN = (n: number) => db.tables.call_eval_settings.push({ call_id: CALL, evaluators_per_application: n, evaluators_all: false, blind: false, comment_required_all: false, divergence: { enabled: true, scalePct: 40, totalPct: 20 }, deadlines: [], distribution_mode: 'auto' });

const WEIGHTED = (percent: Record<string, number | null>, by = 'percent', max: Record<string, number | null> = {}) => ({ strategy: 'weighted', weighted: { by, percent, max }, panels: [], rules: [], multi: 'first', fallback: 'equal' });
const RULES = (over: Record<string, unknown> = {}) => ({
  strategy: 'rules', weighted: { by: 'percent', percent: {}, max: {} }, multi: 'first', fallback: 'equal',
  panels: [{ id: 'p-health', name: 'Health panel', members: ['u1', 'u2'], balance: 'equal', percent: {}, shortfall: null }, { id: 'p-other', name: 'Other panel', members: ['u3', 'u4'], balance: 'equal', percent: {}, shortfall: null }],
  rules: [{ id: 'r1', panelId: 'p-health', conditions: [{ fieldId: SECTOR, type: 'choice', optionIds: [OPT.health] }] }, { id: 'r2', panelId: 'p-other', conditions: [{ fieldId: SECTOR, type: 'choice', optionIds: [OPT.fintech] }] }],
  ...over,
});
const save = async (config: unknown, extra: Record<string, unknown> = {}) => { const v = await view(); return dist(CALL, { action: 'allocation', baseRev: v.body.allocation.rev, config, ...extra }); };

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; currentUser = null; seq = 0;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  firmMember('ana'); db.tables.matchdeal_investor_members.find((m) => m.user_id === 'ana')!.role = 'admin';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  as('ana');
  CALL = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Shared Call' })))).body.call.id as string;
  for (const m of db.tables.call_team_members.filter((x) => x.user_id === 'ana')) m.permission_overrides = { evaluate_assigned: false };
  const cat = category('Evaluator', { evaluate_assigned: true });
  for (const u of ['u1', 'u2', 'u3', 'u4']) { firmMember(u); onTeam(CALL, u, cat); }
  db.tables.call_form_fields.push(
    { id: SECTOR, call_id: CALL, kind: 'single_choice', label: 'Sector', page: 1, position: 0, required: false, options: [{ id: OPT.health, label: 'Health' }, { id: OPT.fintech, label: 'Fintech' }, { id: OPT.energy, label: 'Energy' }], validations: {}, condition: null, platform_mapping: null, instruction: null, expected_type: null, max_age_months: null },
    { id: GRANT, call_id: CALL, kind: 'yes_no', label: 'Grant?', page: 1, position: 1, required: false, options: [], validations: {}, condition: null, platform_mapping: null, instruction: null, expected_type: null, max_age_months: null },
    { id: RAISED, call_id: CALL, kind: 'number', label: 'Investment received', page: 2, position: 0, required: false, options: [], validations: {}, condition: null, platform_mapping: null, instruction: null, expected_type: null, max_age_months: null },
  );
});

describe('the screen', () => {
  it('Equal is the default; the screen carries what the editor needs: the people who can evaluate and the questions a rule can use', async () => {
    const v = await view();
    expect(v.body.allocation).toMatchObject({ config: { strategy: 'equal' }, version: 1, rev: 0, mode: 'edit', problems: [] });
    expect(v.body.allocation.people.map((p: { userId: string }) => p.userId).sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(v.body.allocation.fields.map((f: { label: string }) => f.label)).toEqual(['Sector', 'Grant?', 'Investment received']);
  });
  it('only whoever configures the call changes it (403 for an evaluator), and a call that is closed for evaluation accepts nothing', async () => {
    as('u1');
    expect((await dist(CALL, { action: 'allocation', baseRev: 0, config: WEIGHTED({}) })).status).toBe(403);
    as('ana');
    expect((await dist(CALL, { action: 'allocation', baseRev: 0, config: { strategy: 'nope' } })).status).toBe(400);
    db.tables.calls.find((c) => c.id === CALL)!.evaluation_closed_at = '2026-10-20T00:00:00Z';
    expect((await dist(CALL, { action: 'allocation', baseRev: 0, config: WEIGHTED({}) })).status).toBe(409);
  });
});

describe('weighted', () => {
  beforeEach(() => { setN(1); for (let i = 0; i < 10; i++) application(CALL); });
  it('30 / 50 / 20 with 10 applications and one evaluator each gives 3 / 5 / 2 — the preview says so before anything is applied, and applying does it', async () => {
    expect((await save(WEIGHTED({ u1: 30, u2: 50, u3: 20, u4: 0 }))).status).toBe(200);
    const pre = await dist(CALL, { action: 'preview' });
    expect(pre.body.add).toHaveLength(10);
    expect(pre.body.allocation.evaluators.filter((e: { got: number }) => e.got > 0).map((e: { requested: number; got: number }) => [e.requested, e.got])).toEqual([[30, 3], [50, 5], [20, 2]]);
    expect(assigned()).toHaveLength(0);                                                  // a preview writes nothing
    expect((await dist(CALL, { action: 'redistribute' })).status).toBe(200);
    expect([load('u1'), load('u2'), load('u3'), load('u4')]).toEqual([3, 5, 2, 0]);
  });
  it('percentages that do not add up to 100 are saved while built, said in words, and cannot be applied — not even by calling the server directly', async () => {
    const r = await save(WEIGHTED({ u1: 30, u2: 50, u3: 10, u4: 0 }));
    expect(r.status).toBe(200);
    expect(r.body.allocation.problems).toEqual(['Weighted: the percentages add up to 90 %, not 100 % (10 % missing).']);
    const applied = await dist(CALL, { action: 'redistribute' });
    expect(applied).toMatchObject({ status: 409, body: { code: 'rules_incomplete' } });
    expect(assigned()).toHaveLength(0);
    expect((await dist(CALL, { action: 'preview' })).body.allocation).toMatchObject({ blocked: true });
  });
  it('a maximum per evaluator is a hard limit', async () => {
    await save(WEIGHTED({}, 'max', { u1: 2, u2: 3, u3: 100, u4: 1 }));
    await dist(CALL, { action: 'redistribute' });
    expect([load('u1'), load('u2'), load('u3'), load('u4')]).toEqual([2, 3, 4, 1]);
  });
  it('a conflict of interest is still respected', async () => {
    const first = db.tables.call_applications[0].id as string;
    db.tables.call_eval_conflicts.push({ id: 'cf1', call_id: CALL, evaluator_user_id: 'u2', application_id: first, kind: 'declared', code: 'declared', note: null, created_at: '2026-10-12T00:00:00Z' });
    await save(WEIGHTED({ u1: 30, u2: 50, u3: 20, u4: 0 }));
    await dist(CALL, { action: 'redistribute' });
    expect(assigned().some((a) => a.application_id === first && a.evaluator_user_id === 'u2')).toBe(false);
    expect(assigned()).toHaveLength(10);
  });
});

describe('by rules', () => {
  beforeEach(() => { setN(1); });
  it('an application goes to the panel its answers point to; inside the panel the load is equal', async () => {
    const health = [1, 2, 3, 4].map(() => application(CALL, withSector('health')));
    const fin = [1, 2].map(() => application(CALL, withSector('fintech')));
    expect((await save(RULES())).body.allocation.problems).toEqual([]);
    const pre = await dist(CALL, { action: 'preview' });
    expect(pre.body.allocation.panels.map((p: { name: string; applications: number }) => [p.name, p.applications])).toEqual([['Health panel', 4], ['Other panel', 2]]);
    await dist(CALL, { action: 'redistribute' });
    for (const a of health) expect(['u1', 'u2']).toContain(assigned().find((x) => x.application_id === a)!.evaluator_user_id);
    for (const a of fin) expect(['u3', 'u4']).toContain(assigned().find((x) => x.application_id === a)!.evaluator_user_id);
    expect([load('u1'), load('u2')]).toEqual([2, 2]);
  });
  it('"Unassigned": an application that meets no rule is left for a person — who may assign it even though the mode is automatic, but not one the rules already placed', async () => {
    const placed = application(CALL, withSector('health')); const left = application(CALL, withSector('energy'));
    await save(RULES({ fallback: 'unassigned' }));
    const pre = await dist(CALL, { action: 'preview' });
    expect(pre.body.allocation.unassigned.map((u: { applicationId: string }) => u.applicationId)).toEqual([left]);
    await dist(CALL, { action: 'redistribute' });
    expect(assigned().some((a) => a.application_id === left)).toBe(false);
    const v = await view();
    expect(v.body.mode).toBe('auto');
    expect(v.body.applications.find((a: { applicationId: string }) => a.applicationId === left).byHand).toBe(true);
    expect(v.body.applications.find((a: { applicationId: string }) => a.applicationId === placed).byHand).toBe(false);
    expect((await dist(CALL, { action: 'assign', applicationId: left, userId: 'u4' })).status).toBe(200);
    expect((await dist(CALL, { action: 'assign', applicationId: placed, userId: 'u4' })).status).toBe(409);
    await dist(CALL, { action: 'redistribute' });
    expect(assigned().some((a) => a.application_id === left && a.evaluator_user_id === 'u4')).toBe(true);        // what a person assigned stays
  });
  it('the fallback can be everybody equally', async () => {
    application(CALL, withSector('energy')); application(CALL, withSector('energy'));
    await save(RULES({ fallback: 'equal' }));
    await dist(CALL, { action: 'redistribute' });
    expect(assigned()).toHaveLength(2);
    expect(new Set(assigned().map((a) => a.evaluator_user_id)).size).toBe(2);
  });
  it('a panel smaller than N must be chosen about before anything is applied; "lower" gives the whole panel', async () => {
    setN(2); db.tables.call_eval_settings.length = 0; setN(3);
    const a = application(CALL, withSector('health'));
    await save(RULES());
    const pre = await dist(CALL, { action: 'preview' });
    expect(pre.body.allocation.needsChoice).toEqual(['Health panel']);
    expect(pre.body.allocation.blocked).toBe(true);
    expect((await dist(CALL, { action: 'redistribute' })).status).toBe(409);
    const cfg = RULES(); for (const p of cfg.panels as { shortfall: string | null }[]) p.shortfall = 'lower';   // every panel is smaller than 3: the choice is asked for each
    await save(cfg);
    expect((await dist(CALL, { action: 'redistribute' })).status).toBe(200);
    expect(assigned().filter((x) => x.application_id === a).map((x) => x.evaluator_user_id).sort()).toEqual(['u1', 'u2']);
  });
  it('what is incomplete is said: a rule without a panel or a condition, a question that left the form', async () => {
    const r = await save(RULES({ rules: [{ id: 'r1', panelId: 'nope', conditions: [] }, { id: 'r2', panelId: 'p-health', conditions: [{ fieldId: 'f0000000-0000-4000-8000-0000000000ff', type: 'yes_no', yes: true }] }] }));
    expect(r.body.allocation.problems).toEqual(expect.arrayContaining(['Rule 1: choose the panel it sends the application to.', 'Rule 1: add a condition.', 'Rule 2: a condition is about a question that is not in the form any more.']));
  });
  it('an application that arrives later follows the same rules (and one that has no panel waits)', async () => {
    await save(RULES({ fallback: 'unassigned' }));
    const later = application(CALL, withSector('fintech'));
    await syncApplication(fakeCallsAdmin(db, storage) as never, callOf(), later);
    expect(['u3', 'u4']).toContain(assigned().find((a) => a.application_id === later)!.evaluator_user_id);
    const none = application(CALL, withSector('energy'));
    await syncApplication(fakeCallsAdmin(db, storage) as never, callOf(), none);
    expect(assigned().some((a) => a.application_id === none)).toBe(false);
  });
});

describe('the rules freeze with the first submitted evaluation', () => {
  it('a change then makes a NEW version, asked first; what was started is never moved; the earlier version stays', async () => {
    setN(1);
    const a1 = application(CALL, withSector('health')); const a2 = application(CALL, withSector('health'));
    expect((await save(RULES())).status).toBe(200);
    expect((await view()).body.allocation).toMatchObject({ version: 1, rev: 1, mode: 'edit' });
    await dist(CALL, { action: 'redistribute' });
    const mine = assigned().find((a) => a.application_id === a1)!.evaluator_user_id as string;
    db.tables.call_evaluations.push({ id: 'ev1', call_id: CALL, application_id: a1, evaluator_user_id: mine, grid_version: 1, status: 'submitted', revision: 1, grade_percent: 80 });
    const rev = (await view()).body.allocation.rev;
    const changed = RULES({ rules: [{ id: 'r1', panelId: 'p-other', conditions: [{ fieldId: SECTOR, type: 'choice', optionIds: [OPT.health] }] }] });
    const ask = await dist(CALL, { action: 'allocation', baseRev: rev, config: changed });
    expect(ask).toMatchObject({ status: 409, body: { code: 'needs_confirm', nextVersion: 2, evaluations: 1 } });
    expect(db.tables.call_eval_distribution_configs).toHaveLength(1);
    const ok = await dist(CALL, { action: 'allocation', baseRev: rev, config: changed, confirm: true });
    expect(ok.status).toBe(200);
    expect(ok.body.allocation).toMatchObject({ version: 2, mode: 'versioned' });
    expect(db.tables.call_eval_distribution_configs.map((r) => r.version)).toEqual([1, 2]);
    await dist(CALL, { action: 'redistribute' });
    expect(assigned().some((a) => a.application_id === a1 && a.evaluator_user_id === mine)).toBe(true);       // a1 was evaluated: it stays with who did it
    expect(['u3', 'u4']).toContain(assigned().find((a) => a.application_id === a2)!.evaluator_user_id);        // a2 had not started: it moves to the new panel
  });
  it('somebody else\'s change in between is refused, never overwritten', async () => {
    await save(WEIGHTED({ u1: 100 }));
    const r = await dist(CALL, { action: 'allocation', baseRev: 0, config: WEIGHTED({ u2: 100 }) });
    expect(r).toMatchObject({ status: 409, body: { code: 'conflict' } });
  });
});

describe('a duplicated call', () => {
  it('gets the rules as a copy of its own, pointing to the questions of the copy', async () => {
    await save(RULES());
    as('ana');
    const copy = (await read(await duplicatePost(json('POST'), { params: { id: CALL } }))).body.call.id as string;
    const newSector = db.tables.call_form_fields.find((f) => f.call_id === copy && f.label === 'Sector')!.id as string;
    expect(newSector).not.toBe(SECTOR);
    const v = await view(copy);
    expect(v.body.allocation.config.strategy).toBe('rules');
    expect(v.body.allocation.config.rules[0].conditions[0]).toMatchObject({ fieldId: newSector, optionIds: [OPT.health] });
    expect(v.body.allocation.config.panels.map((p: { name: string }) => p.name)).toEqual(['Health panel', 'Other panel']);
    // …and what is changed in one is not changed in the other
    expect((await view(CALL)).body.allocation.config.rules[0].conditions[0].fieldId).toBe(SECTOR);
  });
});
