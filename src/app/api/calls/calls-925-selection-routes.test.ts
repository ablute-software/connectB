// Prompt 925 — the selection through the real handlers over the stateful fake database: who may read and change the rules (versioned, optimistic), who may propose / apply / decide ties (403 without "Final decision"),
// the proposal and its explanations, "Apply proposal" writing decisions with origin "proposal", a person changing one only with a reason (and it is never overwritten by a recalculation), a tie blocking "Apply" until
// someone decides, the proposal going out of date, the selection fixed once the results are published, isolation per call, and the export carrying the proposal.
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
import { GET as boardGet, POST as boardPost } from './[id]/evaluation-board/route';
import { GET as exportGet } from './[id]/evaluation-board/export/route';
import { PUT as gridPut, GET as gridGet } from './[id]/eval-grid/route';
import { GET as rulesGet, PUT as rulesPut } from './[id]/selection/route';
import { GET as runGet, POST as runPost } from './[id]/selection/run/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: db.users.get(id)?.email ?? `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
let CALL = ''; let CALL_B = ''; let C: { team: string; market: string }; const A: Record<string, string> = {};
const P = (id: string) => ({ params: { id } });
const rules = (u: string | null, id = CALL) => { as(u); return rulesGet(json('GET'), P(id)).then(read); };
const saveRules = async (u: string, r: Record<string, unknown>, id = CALL) => { as(u); const cur = await rulesGet(json('GET'), P(id)).then(read); return rulesPut(json('PUT', { rules: r, baseVersion: cur.body.version }), P(id)).then(read); };
const run = (u: string, id = CALL) => { as(u); return runGet(json('GET'), P(id)).then(read); };
const act = (u: string, body: Record<string, unknown>, id = CALL) => { as(u); return runPost(json('POST', body), P(id)).then(read); };
const decide = (u: string, appId: string, decision: string | null, note?: string) => { as(u); return boardPost(json('POST', { action: 'decide', applicationId: appId, decision, note }), P(CALL)).then(read); };
const events = (name: string) => db.tables.call_events.filter((e) => e.event === name);
const decisionOf = (appId: string) => db.tables.call_eval_decisions.find((d) => d.application_id === appId && d.is_current);

function firmMember(id: string) { db.users.set(id, { id, email: `${id}@${id}.test` }); db.tables.matchdeal_investor_members.push({ id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role: 'member' }); }
const category = (name: string, perms: Record<string, boolean>) => { const id = `cat-${name}`; db.tables.call_team_categories.push({ id, catalog_entity_id: FIRM, incubator_id: null, name, permissions: perms }); return id; };
const onTeam = (callId: string, userId: string, categoryId: string) => db.tables.call_team_members.push({ id: `tm-${callId.slice(0, 4)}-${userId}`, call_id: callId, user_id: userId, category_id: categoryId });

function application(callId: string, tag: string, ref: string, name: string, sector: string, asked = '100000') {
  const id = `aaaaaaaa-0000-4000-8000-${tag.padStart(12, '0')}`; const org = `bbbbbbbb-0000-4000-8000-${tag.padStart(12, '0')}`; const sub = `cccccccc-0000-4000-8000-${tag.padStart(12, '0')}`;
  db.users.set(`ap-${tag}`, { id: `ap-${tag}`, email: `ap-${tag}@startup${tag}.com` });
  db.tables.orgs.push({ id: org, name });
  db.tables.call_applications.push({ id, call_id: callId, startup_org_id: org, applicant_user_id: `ap-${tag}`, status: 'submitted', reference: ref, draft_answers: {}, current_submission_id: sub, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' });
  db.tables.call_application_submissions.push({ id: sub, application_id: id, version: 1, answers: { [F.sector]: sector, [F.ask]: asked }, documents: [], form_snapshot: {}, submitted_by: `ap-${tag}`, submitted_at: '2026-10-10T00:00:00Z', idempotency_key: `k-${tag}` });
  db.tables.call_application_eligibility.push({ id: `el-${id}`, call_id: callId, application_id: id, status: 'fit', is_current: true, source: 'engine', rule_results: [], overrides: {}, reason: '', created_at: '2026-10-11T00:00:00Z' });
  return id;
}
function evaluation(callId: string, appId: string, who: string, scores: Record<string, number>, grade: number) {
  const id = `ev-${appId.slice(-4)}-${who}`;
  db.tables.call_evaluations.push({ id, call_id: callId, application_id: appId, evaluator_user_id: who, grid_version: 1, status: 'submitted', grade_percent: grade, overall_comment: '', private_note: '', revision: 1, submitted_at: '2026-10-20T00:00:00Z' });
  for (const [criterion, score] of Object.entries(scores)) db.tables.call_eval_scores.push({ evaluation_id: id, criterion_id: criterion, score, comment: '' });
  db.tables.call_eval_assignments.push({ id: `as-${id}`, call_id: callId, application_id: appId, evaluator_user_id: who, source: 'auto', status: 'assigned', created_at: '2026-10-20T00:00:00Z' });
}
const F = { sector: 'f0000000-0000-4000-8000-000000000001', ask: 'f0000000-0000-4000-8000-000000000002', name: 'f0000000-0000-4000-8000-000000000003' };
const HEALTH = 'opt-health'; const ENERGY = 'opt-energy';
/** The rules the tests start from: two places, a minimum of Health, a waiting list of one. */
const BASE = () => ({ slots: 2, waitlist: 1, quotas: [{ fieldId: F.sector, match: { kind: 'option', optionId: HEALTH }, minSeats: 1 }], tieBreak: [{ kind: 'manual' }] });

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; currentUser = null;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  firmMember('ana'); db.tables.matchdeal_investor_members.find((m) => m.user_id === 'ana')!.role = 'admin';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  as('ana');
  CALL = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Selected Call: 2027' })))).body.call.id as string;
  CALL_B = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Other Call' })))).body.call.id as string;
  firmMember('decider'); onTeam(CALL, 'decider', category('Decider', { final_decision: true }));
  firmMember('configurer'); onTeam(CALL, 'configurer', category('Configurer', { configure_call: true, manage_team: true }));
  firmMember('rita'); onTeam(CALL, 'rita', category('Evaluator', { evaluate_assigned: true }));
  db.tables.call_form_fields.push(
    { id: F.sector, call_id: CALL, kind: 'single_choice', label: 'Main sector', page: 1, position: 0, required: false, options: [{ id: HEALTH, label: 'Health' }, { id: ENERGY, label: 'Energy' }], validations: {}, condition: null },
    { id: F.ask, call_id: CALL, kind: 'number', label: 'Amount asked', page: 1, position: 1, required: false, options: [], validations: { currency: true }, condition: null },
    { id: F.name, call_id: CALL, kind: 'short_text', label: 'Name', page: 1, position: 2, required: false, options: [], validations: {}, condition: null });
  const v = await gridGet(json('GET'), P(CALL)).then(read);
  const g = await gridPut(json('PUT', { baseRev: v.body.rev, criteria: [{ name: 'Team', weight: 50, scaleMin: 1, scaleMax: 5 }, { name: 'Market', weight: 50, scaleMin: 1, scaleMax: 5 }], settings: v.body.settings }), P(CALL)).then(read);
  C = { team: g.body.criteria[0].id, market: g.body.criteria[1].id };
  // four evaluated applications, best first: Energy 90, Energy 80, Health 60, Health 40 (percent of the scale)
  A.e1 = application(CALL, '1', 'REF-001', 'Energy One', ENERGY); A.e2 = application(CALL, '2', 'REF-002', 'Energy Two', ENERGY);
  A.h1 = application(CALL, '3', 'REF-003', 'Health One', HEALTH); A.h2 = application(CALL, '4', 'REF-004', 'Health Two', HEALTH);
  evaluation(CALL, A.e1, 'rita', { [C.team]: 5, [C.market]: 4 }, 90); evaluation(CALL, A.e2, 'rita', { [C.team]: 4, [C.market]: 4 }, 80);
  evaluation(CALL, A.h1, 'rita', { [C.team]: 3, [C.market]: 3 }, 60); evaluation(CALL, A.h2, 'rita', { [C.team]: 2, [C.market]: 2 }, 40);
});

describe('the rules — who reads, who changes, versions', () => {
  it('"Configure call" or "Final decision" read them; an evaluator and the signed-out do not; only "Configure call" changes them', async () => {
    expect((await rules('ana')).status).toBe(200);
    expect((await rules('decider')).status).toBe(200);
    expect((await rules('configurer')).body).toMatchObject({ ok: true, canEdit: true, version: 0, rules: { slots: null, waitlist: 5 } });
    expect((await rules('decider')).body.canEdit).toBe(false);
    expect((await rules('rita')).status).toBe(403);
    expect((await rules(null)).status).toBe(401);
    expect((await saveRules('decider', BASE())).status).toBe(403);
    expect((await saveRules('rita', BASE())).status).toBe(403);
    expect((await rules('ana')).body.fields.map((f: { label: string }) => f.label)).toEqual(['Main sector', 'Amount asked']);      // only closed questions (a choice, Yes/No, a number)
  });

  it('a change is a NEW version (the old one stays), the same rules again change nothing, a stale save is refused, and it is recorded', async () => {
    const first = await saveRules('configurer', BASE());
    expect(first).toMatchObject({ status: 200, body: { ok: true, version: 1 } });
    expect((await saveRules('configurer', BASE())).body.version).toBe(1);                       // nothing changed
    const second = await saveRules('configurer', { ...BASE(), slots: 3 });
    expect(second.body.version).toBe(2);
    expect(db.tables.call_selection_rules.map((r) => [r.version, r.is_current])).toEqual([[1, false], [2, true]]);
    as('configurer');
    expect((await rulesPut(json('PUT', { rules: BASE(), baseVersion: 1 }), P(CALL)).then(read)).status).toBe(409);        // somebody saved since
    expect(events('selection_rules_changed')).toHaveLength(2);
    expect(events('selection_rules_changed')[1].detail).toMatchObject({ version: 2, after: { slots: 3 } });
  });

  it('the server refuses what points at nothing', async () => {
    for (const bad of [{ quotas: [{ fieldId: F.name, match: {}, minSeats: 1 }] }, { quotas: [{ fieldId: F.sector, match: { kind: 'option', optionId: 'zzz' }, minSeats: 1 }] }, { minPerCriterion: [{ criterionId: 'nope', min: 1 }] }, { budget: { total: 1000, per: 'asked', fieldId: F.name } }]) {
      expect((await saveRules('configurer', bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(db.tables.call_selection_rules).toHaveLength(0);
  });
});

describe('the proposal', () => {
  beforeEach(async () => { await saveRules('configurer', BASE()); });

  it('only "Final decision" calculates it; it needs rules; the places and the quota decide, and every application says why', async () => {
    expect((await act('configurer', { action: 'propose' })).status).toBe(403);
    expect((await act('rita', { action: 'propose' })).status).toBe(403);
    const r = await act('decider', { action: 'propose' });
    expect(r.status).toBe(200);
    const byRef = Object.fromEntries(r.body.run.items.map((i: { reference: string; outcome: string; explanation: string }) => [i.reference, [i.outcome, i.explanation]]));
    expect(byRef['REF-001']).toEqual(['selected', 'Selected: 1st place.']);
    expect(byRef['REF-003']).toEqual(['selected', 'Selected: 3rd place, Health quota.']);        // the reserved Health place, ahead of the 2nd Energy
    expect(byRef['REF-002']).toEqual(['waitlist', 'Waitlist: 2nd place, slots full.']);
    expect(byRef['REF-004'][0]).toBe('reject');
    expect(r.body.run.summary).toMatchObject({ selected: 2, waitlist: 1, rejected: 1, quotas: [{ label: 'Health', selected: 1, met: true }] });
    expect(r.body).toMatchObject({ rulesVersion: 1, missingEvaluations: 0, rulesStale: false, run: { stale: false, appliedAt: null } });
    expect(events('selection_proposed')).toHaveLength(1);
    expect(db.tables.call_eval_decisions).toHaveLength(0);                                       // nothing is decided by proposing
  });

  it('without rules there is nothing to propose', async () => {
    db.tables.call_selection_rules.length = 0;
    expect((await act('decider', { action: 'propose' })).status).toBe(400);
  });

  it('it goes out of date when the rules or the evaluations change, and calculating again makes a new run', async () => {
    const r1 = await act('decider', { action: 'propose' });
    await saveRules('configurer', { ...BASE(), slots: 3 });
    expect((await run('decider')).body).toMatchObject({ rulesStale: true, run: { stale: true } });
    const r2 = await act('decider', { action: 'propose' });
    expect(r2.body.run.id).not.toBe(r1.body.run.id);
    expect(r2.body).toMatchObject({ rulesStale: false, run: { stale: false, rulesVersion: 2 } });
    evaluation(CALL, A.h2, 'decider', { [C.team]: 5, [C.market]: 5 }, 100);                      // a new evaluation changes the numbers
    expect((await run('ana')).body.run.stale).toBe(true);
  });

  it('evaluations still missing are said (the proposal is provisional); an application with none is not considered', async () => {
    const extra = application(CALL, '5', 'REF-005', 'Not evaluated', ENERGY);
    db.tables.call_eval_assignments.push({ id: 'as-x', call_id: CALL, application_id: extra, evaluator_user_id: 'rita', source: 'auto', status: 'assigned', created_at: '2026-10-20T00:00:00Z' });
    const r = await act('decider', { action: 'propose' });
    expect(r.body.missingEvaluations).toBe(1);
    expect(r.body.run.items.find((i: { reference: string }) => i.reference === 'REF-005')).toMatchObject({ outcome: 'not_considered', rank: null });
  });
});

describe('apply, manual changes, ties', () => {
  beforeEach(async () => { await saveRules('configurer', BASE()); });

  it('"Apply proposal" fills the decisions with origin "proposal"; the board shows where each came from; the isolation holds', async () => {
    const proposed = await act('decider', { action: 'propose' });
    expect((await act('configurer', { action: 'apply', runId: proposed.body.run.id })).status).toBe(403);
    const applied = await act('decider', { action: 'apply', runId: proposed.body.run.id });
    expect(applied.body.applied).toEqual({ written: 4, keptManual: 0, locked: 0, unchanged: 0 });
    expect([A.e1, A.e2, A.h1, A.h2].map((a) => `${decisionOf(a)!.decision}:${decisionOf(a)!.origin}`)).toEqual(['advance:proposal', 'waitlist:proposal', 'advance:proposal', 'reject:proposal']);
    as('decider');
    const b = await boardGet(json('GET'), P(CALL)).then(read);
    expect(b.body.rows.find((r: { reference: string }) => r.reference === 'REF-001').decision).toMatchObject({ decision: 'advance', origin: 'proposal' });
    expect(applied.body.run).toMatchObject({ differing: 0 });
    expect(events('selection_applied')).toHaveLength(1);
    // another call never sees it, and cannot apply it
    expect((await rules('ana', CALL_B)).body.version).toBe(0);
    as('ana'); expect((await runPost(json('POST', { action: 'apply', runId: proposed.body.run.id }), P(CALL_B)).then(read)).status).not.toBe(200);
  });

  it('changing a proposed decision by hand needs a reason; with one it is kept as "manual"; confirming the same decision needs none', async () => {
    const proposed = await act('decider', { action: 'propose' });
    await act('decider', { action: 'apply', runId: proposed.body.run.id });
    expect((await decide('decider', A.e2, 'advance')).status).toBe(400);
    expect((await decide('decider', A.e2, 'advance', '   ')).status).toBe(400);
    expect((await decide('decider', A.e2, 'advance', 'Strategic for the programme')).status).toBe(200);
    expect(decisionOf(A.e2)).toMatchObject({ decision: 'advance', origin: 'manual', note: 'Strategic for the programme' });
    expect((await decide('decider', A.h2, 'reject')).status).toBe(200);                        // the same as the proposal: no reason needed
    expect(decisionOf(A.h2)!.origin).toBe('manual');
    expect(events('eval_decision').some((e) => (e.detail as { after?: { decision?: string } }).after?.decision === 'advance' && e.application_id === A.e2)).toBe(true);
  });

  it('calculating and applying again NEVER overwrites a decision a person made; the summary says how many differ from the new proposal', async () => {
    const proposed = await act('decider', { action: 'propose' });
    await act('decider', { action: 'apply', runId: proposed.body.run.id });
    await decide('decider', A.e2, 'advance', 'Strategic for the programme');
    await saveRules('configurer', { ...BASE(), slots: 3 });
    const again = await act('decider', { action: 'propose' });
    expect(again.body.run.differing).toBeGreaterThan(0);
    const applied = await act('decider', { action: 'apply', runId: again.body.run.id });
    expect(applied.body.applied.keptManual).toBe(1);
    expect(decisionOf(A.e2)).toMatchObject({ decision: 'advance', origin: 'manual' });          // untouched
    expect(decisionOf(A.e1)!.origin).toBe('proposal');
  });

  it('a tie that matters blocks "Apply" until someone decides the order; then the proposal is recalculated', async () => {
    const twin = application(CALL, '6', 'REF-006', 'Energy Twin', ENERGY);
    evaluation(CALL, twin, 'rita', { [C.team]: 4, [C.market]: 4 }, 80);                           // exactly like Energy Two
    await saveRules('configurer', { slots: 2, waitlist: 1, tieBreak: [{ kind: 'manual' }] });
    const proposed = await act('decider', { action: 'propose' });
    expect(proposed.body.run.summary.ties.sort()).toEqual([A.e2, twin].sort());
    expect(proposed.body.run.items.find((i: { applicationId: string }) => i.applicationId === twin).explanation).toMatch(/^Tie — decide/);
    const blocked = await act('decider', { action: 'apply', runId: proposed.body.run.id });
    expect(blocked.status).toBe(409); expect(blocked.body.error).toContain('tied');
    expect(db.tables.call_eval_decisions).toHaveLength(0);
    expect((await act('decider', { action: 'ties', order: [twin, twin] })).status).toBe(400);
    const decided = await act('decider', { action: 'ties', order: [twin, A.e2] });
    expect(decided.body.run.summary.ties).toEqual([]);
    expect(decided.body.run.items.find((i: { applicationId: string }) => i.applicationId === twin).outcome).toBe('selected');
    expect((await act('decider', { action: 'apply', runId: decided.body.run.id })).status).toBe(200);
    expect(events('selection_tie_decided')).toHaveLength(1);
  });
});

describe('fixed once published, and the export', () => {
  beforeEach(async () => { await saveRules('configurer', BASE()); });

  it('once the results are published the proposal cannot be recalculated or applied and the rules cannot change; it can still be read', async () => {
    const proposed = await act('decider', { action: 'propose' });
    db.tables.call_results.push({ id: 'res-1', call_id: CALL, application_id: A.e1, outcome: 'accepted', is_current: true, phase_id: null });
    expect((await act('decider', { action: 'propose' })).status).toBe(409);
    expect((await act('decider', { action: 'apply', runId: proposed.body.run.id })).status).toBe(409);
    expect((await saveRules('configurer', { ...BASE(), slots: 3 })).status).toBe(409);
    expect((await run('decider')).body).toMatchObject({ ok: true, locked: true });
    expect((await rules('configurer')).body).toMatchObject({ canEdit: false, lockedReason: 'The results were published: the selection rules are fixed.' });
  });

  it('the rules cannot change once the evaluation is closed', async () => {
    as('decider'); await boardPost(json('POST', { action: 'close' }), P(CALL));
    expect((await saveRules('configurer', { ...BASE(), slots: 3 })).body.code).toBe('locked');
  });

  it('the export carries the place, the proposal, its explanation and where the decision came from', async () => {
    const proposed = await act('decider', { action: 'propose' });
    await act('decider', { action: 'apply', runId: proposed.body.run.id });
    as('decider');
    const csv = await (await exportGet(json('GET'), P(CALL))).text();
    expect(csv).toContain('Selection place;Proposal;Explanation of the proposal;Decision origin');
    expect(csv).toContain('Selected: 3rd place, Health quota.');
    expect(csv).toContain('Proposal');
  });
});
