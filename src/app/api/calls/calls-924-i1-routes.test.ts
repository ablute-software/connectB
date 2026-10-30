// Prompt 924 (Etapa 4, I1) — preparing the results through the real handlers over the stateful fake database: only "Publish results" reads or writes (403 for anybody else, whatever their other permissions);
// the right result for each decision, a "Not a fit" without a decision counts as "Not selected", and nothing can be published while an application has no decision; the settings (names, messages with their
// fields, options) are saved and cleaned; the feedback is the administrator's own; the preview is a real application's message; and nothing an evaluator wrote ever appears in anything the routes answer.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';
import { NO_PERMISSIONS } from '@/lib/calls/permissions';

let db: CallsDb;
let currentUser: { id: string; email: string; email_confirmed_at?: string } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, rpc: async () => ({ data: false }), from: (t: string) => fakeCallsAdmin(db).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));

import { POST as createPost } from './route';
import { GET as resultsGet, PUT as resultsPut, POST as resultsPost } from './[id]/results/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, text: await res.clone().text(), body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: db.users.get(id)?.email ?? `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };

let CALL = ''; let OTHER = '';
const A: Record<string, string> = {};
const get = (u: string, callId = CALL) => { as(u); return resultsGet(json('GET'), { params: { id: callId } }).then(read); };
const put = (u: string, body: unknown, callId = CALL) => { as(u); return resultsPut(json('PUT', body), { params: { id: callId } }).then(read); };
const post = (u: string, body: unknown, callId = CALL) => { as(u); return resultsPost(json('POST', body), { params: { id: callId } }).then(read); };
const events = (name: string) => db.tables.call_events.filter((e) => e.event === name);

function member(id: string, role = 'member') { db.users.set(id, { id, email: `${id}@${id}.test` }); db.tables.matchdeal_investor_members.push({ id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role, created_at: '2026-01-01T00:00:00.000Z' }); }
const onTeam = (callId: string, userId: string, name: string, perms: Record<string, boolean>) => {
  const id = `cat-${name}`;
  if (!db.tables.call_team_categories.some((c) => c.id === id)) db.tables.call_team_categories.push({ id, catalog_entity_id: FIRM, incubator_id: null, name, permissions: { ...NO_PERMISSIONS, ...perms }, created_at: '2026-01-01T00:00:00.000Z' });
  db.tables.call_team_members.push({ id: `tm-${callId.slice(0, 4)}-${userId}`, call_id: callId, user_id: userId, category_id: id, permission_overrides: {}, created_at: '2026-01-02T00:00:00.000Z' });
};
function application(callId: string, tag: string, ref: string, name: string, over: { decision?: 'advance' | 'reject' | 'waitlist'; eligibility?: 'fit' | 'not_fit' | 'to_validate'; sentence?: string } = {}) {
  const id = `aaaaaaaa-0000-4000-8000-${tag.padStart(12, '0')}`; const org = `bbbbbbbb-0000-4000-8000-${tag.padStart(12, '0')}`;
  db.users.set(`ap-${tag}`, { id: `ap-${tag}`, email: `ap-${tag}@startup${tag}.com`, user_metadata: { full_name: `Founder ${tag}` } });
  db.tables.orgs.push({ id: org, name });
  db.tables.call_applications.push({ id, call_id: callId, startup_org_id: org, applicant_user_id: `ap-${tag}`, status: 'submitted', reference: ref, draft_answers: {}, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' });
  db.tables.call_application_eligibility.push({ id: `el-${id}`, call_id: callId, application_id: id, status: over.eligibility ?? 'fit', is_current: true, source: 'engine', rule_results: over.sentence ? [{ ruleId: 'r1', outcome: 'fail', reason: 'ENGINE-REASON-SECRET: value 2025 > 2024', sentence: over.sentence, kind: 'number', fieldId: 'f1' }] : [], overrides: {}, reason: over.sentence ? 'ENGINE-REASON-SECRET: value 2025 > 2024' : '', created_at: '2026-10-11T00:00:00Z' });
  if (over.decision) db.tables.call_eval_decisions.push({ id: `d-${id}`, call_id: callId, application_id: id, decision: over.decision, note: 'INTERNAL-DECISION-NOTE', decided_by: 'decider', is_current: true, decided_at: '2026-10-20T00:00:00Z' });
  // what an evaluator wrote about it — must never come out of these routes
  db.tables.call_evaluations.push({ id: `ev-${id}`, call_id: callId, application_id: id, evaluator_user_id: 'rita', grid_version: 1, status: 'submitted', grade_percent: 77, overall_comment: 'OVERALL-COMMENT-SECRET', private_note: 'PRIVATE-NOTE-SECRET', revision: 1, reopened_count: 0 });
  db.tables.call_eval_scores.push({ evaluation_id: `ev-${id}`, criterion_id: 'c1', score: 3, comment: 'CRITERION-COMMENT-SECRET' });
  return id;
}
const setStatus = (callId: string, status: string) => { Object.assign(db.tables.calls.find((c) => c.id === callId)!, { status, closed_at: status === 'closed' ? '2026-10-15T00:00:00Z' : null }); };

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); currentUser = null;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  member('ana', 'admin');
  as('ana');
  CALL = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Seed Call 2027' })))).body.call.id as string;
  OTHER = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Other Call' })))).body.call.id as string;
  member('pat'); onTeam(CALL, 'pat', 'Publisher', { publish_results: true });
  member('decider'); onTeam(CALL, 'decider', 'Decider', { final_decision: true });
  member('conf'); onTeam(CALL, 'conf', 'Configurer', { configure_call: true, manage_team: true, view_all_applications: true });
  member('rita'); onTeam(CALL, 'rita', 'Evaluator', { evaluate_assigned: true });
  member('hanna'); onTeam(CALL, 'hanna', 'Contestations', { handle_contestations: true });
  A.adv = application(CALL, '1', 'REF-001', 'Blue Health', { decision: 'advance' });
  A.rej = application(CALL, '2', 'REF-002', 'Cyan Labs', { decision: 'reject' });
  A.wl = application(CALL, '3', 'REF-003', 'Green Tech', { decision: 'waitlist' });
  A.none = application(CALL, '4', 'REF-004', 'Grey Co');                                                                  // Fit, no decision: pending
  // The rules of the call: r1 carries the sentence the entity wrote FOR the applicant, r2 has none.
  db.tables.call_eligibility_rules.push({ id: 'r1', call_id: CALL, version: 1, field_id: 'f1', kind: 'number', params: {}, note: null, applicant_text: 'This call is for companies founded in 2024 or earlier.', position: 0 }, { id: 'r2', call_id: CALL, version: 1, field_id: 'f2', kind: 'number', params: {}, note: null, applicant_text: null, position: 1 });
  A.nofit = application(CALL, '5', 'REF-005', 'Red Ltd', { eligibility: 'not_fit', sentence: 'The company was founded in 2024 or earlier.' });
  application(OTHER, '6', 'REF-006', 'Other Startup', { decision: 'advance' });
  setStatus(CALL, 'closed');
});

describe('who may prepare the results: only "Publish results"', () => {
  it('everybody else is refused with the permission named — an evaluator, a decider, somebody who may configure the call, one who handles contestations — on every method', async () => {
    for (const u of ['rita', 'decider', 'conf', 'hanna']) {
      for (const r of [await get(u), await put(u, { feedbackEnabled: true }), await post(u, { action: 'preview', applicationId: A.adv }), await post(u, { action: 'feedback', applicationId: A.adv, text: 'x' })]) {
        expect(r.status, u).toBe(403);
        expect(r.body, u).toMatchObject({ ok: false, error: 'You do not have the “Publish results” permission on this call.' });
      }
    }
    expect((await get('ana')).status).toBe(200);
    expect((await get('pat')).status).toBe(200);
    expect((await resultsGet(json('GET'), { params: { id: CALL } }).then(async (r) => { as(null); return r.status; }))).toBe(200);
    as(null);
    expect((await resultsGet(json('GET'), { params: { id: CALL } })).status).toBe(401);
  });
  it('nothing was changed by the refused attempts', async () => {
    await put('conf', { feedbackEnabled: true, retentionMonths: 6 });
    await put('rita', { labels: { advance: 'Hacked' } });
    expect(db.tables.call_result_settings).toHaveLength(0);
  });
});

describe('what the applicants will be told, from the decisions', () => {
  it('the counts per result, the "Not a fit" without a decision counted as "Not selected", and the pending application named', async () => {
    const { body } = await get('pat');
    expect(body.summary).toMatchObject({ total: 5, counts: { advance: 1, reject: 2, waitlist: 1 }, byEligibility: 1 });
    expect(body.summary.pending).toEqual([{ applicationId: A.none, reference: 'REF-004', startupName: 'Grey Co' }]);
    expect(body.labels).toEqual({ advance: 'Selected', reject: 'Not selected', waitlist: 'Waiting list' });
    const nofit = body.applications.find((a: { applicationId: string }) => a.applicationId === A.nofit);
    expect(nofit).toMatchObject({ result: 'reject', label: 'Not selected', source: 'eligibility' });
  });
  it('nothing can be published while an application has no decision — the blocker says how many; once everything is decided there is none', async () => {
    expect((await get('pat')).body.blockers).toEqual([{ code: 'pending', text: '1 application has no decision yet. Every application needs one before the results can be published.' }]);
    db.tables.call_eval_decisions.push({ id: 'd-none', call_id: CALL, application_id: A.none, decision: 'waitlist', note: null, decided_by: 'decider', is_current: true });
    const after = (await get('pat')).body;
    expect(after.blockers).toEqual([]);
    expect(after.summary.counts).toEqual({ advance: 1, reject: 2, waitlist: 2 });
  });
  it('a call still open cannot have its results published; the application of another call is never counted', async () => {
    setStatus(CALL, 'open');
    expect((await get('pat')).body.blockers.map((b: { code: string }) => b.code)).toContain('call_not_closed');
    expect((await get('pat')).body.summary.total).toBe(5);
  });
  it('the defaults Nuno decided: feedback off, contestations off (10 days), data kept 24 months, no reason sent', async () => {
    expect((await get('pat')).body.settings).toMatchObject({ feedbackEnabled: false, contestationsEnabled: false, contestationDays: 10, retentionMonths: 24, eligibilityReasonMode: 'none' });
  });
  it('the editor starts from the default text of each result (in the language of the call)', async () => {
    const en = (await get('pat')).body;
    expect(en.messages.reject).toContain('was not selected this time');
    Object.assign(db.tables.calls.find((c) => c.id === CALL)!, { content_language: 'pt' });
    expect((await get('pat')).body.messages.reject).toContain('não foi selecionada desta vez');
  });
});

describe('the settings', () => {
  it('names, messages and options are saved and come back; the message is cleaned and may use only the fields that exist; an event records who changed what', async () => {
    const r = await put('pat', { labels: { advance: 'Welcome aboard' }, messages: { advance: '<p>Hi {applicant_name}! <script>bad()</script></p>' }, feedbackEnabled: true, contestationsEnabled: true, contestationDays: 14, retentionMonths: 36, eligibilityReasonMode: 'general' });
    expect(r.status).toBe(200);
    expect(r.body.labels.advance).toBe('Welcome aboard');
    expect(r.body.messages.advance).toBe('<p>Hi {applicant_name}! </p>');
    expect(r.body.settings).toMatchObject({ feedbackEnabled: true, contestationsEnabled: true, contestationDays: 14, retentionMonths: 36, eligibilityReasonMode: 'general' });
    expect(db.tables.call_result_settings).toHaveLength(1);
    expect(events('results_settings_changed')).toMatchObject([{ actor_user_id: 'pat' }]);
    const bad = await put('pat', { messages: { reject: '<p>{applicant}</p>' } });
    expect(bad).toMatchObject({ status: 400 });
    expect(bad.body.error).toContain('{applicant} does not exist');
    expect((await put('pat', { contestationDays: 91 })).status).toBe(400);
    expect((await put('pat', { retentionMonths: 0 })).status).toBe(400);
    expect((await get('pat')).body.settings.contestationDays).toBe(14);                  // a refused change leaves the rest as it was
  });
  it('the next phase\'s text and date, and a change to one setting leaves the others alone', async () => {
    await put('pat', { retentionMonths: 12 });
    await put('pat', { nextStepsText: 'Pitch day', nextStepsDate: '2026-11-14' });
    expect((await get('pat')).body.settings).toMatchObject({ retentionMonths: 12, nextStepsText: 'Pitch day', nextStepsDate: '2026-11-14', contestationDays: 10 });
  });
  it('an archived call cannot be changed', async () => {
    setStatus(CALL, 'archived');
    expect((await put('pat', { retentionMonths: 6 })).status).toBe(409);
  });
});

describe('the feedback is the administrator\'s own', () => {
  it('refused while the option is off; once on it is saved for the application, replaced, and cleared with an empty text', async () => {
    expect(await post('pat', { action: 'feedback', applicationId: A.rej, text: 'Too early.' })).toMatchObject({ status: 409, body: { error: 'Feedback to applicants is switched off for this call.' } });
    await put('pat', { feedbackEnabled: true });
    const set = await post('pat', { action: 'feedback', applicationId: A.rej, text: '  Your plan lacked a second year.  ' });
    expect(set.status).toBe(200);
    expect(set.body.applications.find((a: { applicationId: string }) => a.applicationId === A.rej).feedback).toBe('Your plan lacked a second year.');
    await post('pat', { action: 'feedback', applicationId: A.rej, text: 'Rewritten.' });
    expect(db.tables.call_result_feedback).toHaveLength(1);
    expect(db.tables.call_result_feedback[0]).toMatchObject({ body: 'Rewritten.', updated_by: 'pat' });
    await post('pat', { action: 'feedback', applicationId: A.rej, text: '   ' });
    expect(db.tables.call_result_feedback).toHaveLength(0);
  });
  it('too long is refused; an application of another call, or one that does not exist, is not found', async () => {
    await put('pat', { feedbackEnabled: true });
    expect((await post('pat', { action: 'feedback', applicationId: A.rej, text: 'x'.repeat(2001) })).status).toBe(400);
    const otherApp = db.tables.call_applications.find((a) => a.call_id === OTHER)!.id as string;
    expect((await post('pat', { action: 'feedback', applicationId: otherApp, text: 'x' })).status).toBe(404);
    expect((await post('pat', { action: 'feedback', applicationId: 'nope', text: 'x' })).status).toBe(404);
  });
});

describe('the preview is a real application\'s message', () => {
  it('Selected, with the names filled in: the applicant, the startup, the call and the entity', async () => {
    const { status, body } = await post('pat', { action: 'preview', applicationId: A.adv });
    expect(status).toBe(200);
    expect(body.message).toMatchObject({ result: 'advance', label: 'Selected', subject: 'Seed Call 2027: Selected' });
    expect(body.message.html).toContain('Dear Founder 1,');
    expect(body.message.html).toContain('Blue Health has been selected in “Seed Call 2027”');
    expect(body.message.html).toContain('zz-test-firm');
  });
  it('the feedback shows up in it only once written; the reason of a "Not a fit" in the way the entity chose, and never the engine text', async () => {
    const html = async () => (await post('pat', { action: 'preview', applicationId: A.nofit })).body.message.html as string;
    expect(await html()).not.toContain('founded in 2024');
    expect(await html()).not.toContain('eligibility criteria');
    await put('pat', { eligibilityReasonMode: 'general', feedbackEnabled: true });
    expect(await html()).toContain('did not meet the eligibility criteria of this call.');
    expect(await html()).not.toContain('founded in 2024');
    await put('pat', { eligibilityReasonMode: 'rule' });
    expect(await html()).toContain('<p>This call is for companies founded in 2024 or earlier.</p>');
    expect(await html()).not.toContain('ENGINE-REASON-SECRET');
    expect(await html()).not.toContain('2025');
    // a rule with no sentence for the applicant, or a person's reclassification (no failing rule): the general sentence
    const rows = db.tables.call_application_eligibility.filter((x) => x.application_id === A.nofit);
    rows[0].rule_results = [{ ruleId: 'r2', outcome: 'fail', reason: 'ENGINE-REASON-SECRET: scanned file', sentence: 'internal' }];
    expect(await html()).toContain('did not meet the eligibility criteria of this call.');
    rows[0].rule_results = []; rows[0].source = 'human'; rows[0].reason = 'the file is not a pitch deck';
    expect(await html()).toContain('did not meet the eligibility criteria of this call.');
    expect(await html()).not.toContain('pitch deck');
    expect((await put('pat', { eligibilityReasonMode: 'whatever' })).status).toBe(400);
    expect((await post('pat', { action: 'preview', applicationId: A.rej })).body.message.html).not.toContain('Feedback');
    await post('pat', { action: 'feedback', applicationId: A.rej, text: 'Come back next year.' });
    expect((await post('pat', { action: 'preview', applicationId: A.rej })).body.message.html).toContain('<h3>Feedback</h3><p>Come back next year.</p>');
  });
  it('an application without a decision has no message to preview; one from another call is not found', async () => {
    expect((await post('pat', { action: 'preview', applicationId: A.none })).status).toBe(409);
    const otherApp = db.tables.call_applications.find((a) => a.call_id === OTHER)!.id as string;
    expect((await post('pat', { action: 'preview', applicationId: otherApp })).status).toBe(404);
  });
  it('an applicant\'s name is text, never markup', async () => {
    db.users.get('ap-1')!.user_metadata = { full_name: '<img src=x onerror=alert(1)>' };
    const html = (await post('pat', { action: 'preview', applicationId: A.adv })).body.message.html as string;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('what an evaluator wrote never comes out', () => {
  it('not their comments, their private notes, the comment of a criterion, the grade, nor the internal note of the decision — in any answer of these routes', async () => {
    await put('pat', { feedbackEnabled: true });
    await post('pat', { action: 'feedback', applicationId: A.rej, text: 'Written by the administrator.' });
    const answers = [await get('pat'), await put('pat', { retentionMonths: 24 }), await post('pat', { action: 'preview', applicationId: A.adv }), await post('pat', { action: 'preview', applicationId: A.rej }), await post('pat', { action: 'preview', applicationId: A.nofit })];
    for (const a of answers) for (const secret of ['OVERALL-COMMENT-SECRET', 'PRIVATE-NOTE-SECRET', 'CRITERION-COMMENT-SECRET', 'INTERNAL-DECISION-NOTE', 'grade_percent', '"gradePercent"']) expect(a.text, secret).not.toContain(secret);
  });
});
