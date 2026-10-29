// Prompt 924 (Etapa 4, I2) — publishing the results through the real handlers over the stateful fake database: only "Publish results" publishes (403 otherwise); NOTHING reaches an applicant before that (no result,
// no notice, no email, the applicant's endpoint answers null); the name of the call is typed to confirm; every application of the phase goes out at once, each with its message, its notice and its email; a publication
// is done once and a half-finished one is finished, never doubled; the decisions become fixed (also while a publication is scheduled); "Selected" moves to the next phase; a schedule waits for its time; the emails go from
// a queue — retried, bounced, failed, sent again — and a failed email never keeps the result out of the app; the test goes to the administrator only; the grade is shared only if the call says so, and only the validated one.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';
import { NO_PERMISSIONS } from '@/lib/calls/permissions';

let db: CallsDb;
let currentUser: { id: string; email: string; email_confirmed_at?: string } | null;
const mail: { sent: { to: string; subject: string; html: string; text?: string }[]; behaviour: (to: string, n: number) => { sent: boolean; error?: string }; calls: number } = { sent: [], behaviour: () => ({ sent: true }), calls: 0 };

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, rpc: async () => ({ data: false }), from: (t: string) => fakeCallsAdmin(db).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', () => ({
  resendConfigured: true,
  transactionalTemplate: (o: unknown) => JSON.stringify(o),
  sendTransactionalEmail: async (m: { to: string; subject: string; html: string; text?: string }) => {
    const r = mail.behaviour(m.to, ++mail.calls);
    if (r.sent) mail.sent.push(m);
    return r.sent ? { sent: true, id: 'em' } : { sent: false, error: r.error ?? 'provider timeout' };
  },
}));

import { POST as createPost } from './route';
import { GET as resultsGet, PUT as resultsPut, POST as resultsPost } from './[id]/results/route';
import { GET as publishGet, POST as publishPostRaw } from './[id]/results/publish/route';
import { POST as boardPostRaw } from './[id]/evaluation-board/route';
import { GET as applicantResultGet } from './apply/applications/[id]/result/route';
import { GET as overviewGet } from './apply/overview/route';
import { cancelSchedule, processSends, publishNow, runDueBatches, schedule } from '@/lib/calls/results-publish';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, text: await res.clone().text(), body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: db.users.get(id)?.email ?? `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
const idp = (id: string) => ({ params: { id } });

let CALL = ''; let OTHER = '';
const A: Record<string, string> = {};
const admin = () => fakeCallsAdmin(db);
const getPub = (u: string, callId = CALL) => { as(u); return publishGet(json('GET'), idp(callId)).then(read); };
const act = (u: string, body: Record<string, unknown>, callId = CALL) => { as(u); return publishPostRaw(json('POST', body), idp(callId)).then(read); };
const prep = (u: string, callId = CALL) => { as(u); return resultsGet(json('GET'), idp(callId)).then(read); };
const putSettings = (u: string, body: unknown) => { as(u); return resultsPut(json('PUT', body), idp(CALL)).then(read); };
const postResults = (u: string, body: unknown) => { as(u); return resultsPost(json('POST', body), idp(CALL)).then(read); };
const decide = (u: string, applicationId: string, decision: string | null) => { as(u); return boardPostRaw(json('POST', { action: 'decide', applicationId, decision }), idp(CALL)).then(read); };
const myResult = (u: string, applicationId: string) => { as(u); return applicantResultGet(json('GET'), idp(applicationId)).then(read); };
const callRow = () => db.tables.calls.find((c) => c.id === CALL)!;
const callObj = async () => (await import('@/lib/calls/store')).loadCall(admin(), CALL).then((c) => c!);
const events = (name: string) => db.tables.call_events.filter((e) => e.event === name);
const resultsOf = (callId = CALL) => db.tables.call_results.filter((r) => r.call_id === callId);
const NAME = 'Seed Call 2027';

function member(id: string, role = 'member') { db.users.set(id, { id, email: `${id}@${id}.test` }); db.tables.matchdeal_investor_members.push({ id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role, created_at: '2026-01-01T00:00:00.000Z' }); }
const onTeam = (callId: string, userId: string, name: string, perms: Record<string, boolean>) => {
  const id = `cat-${name}`;
  if (!db.tables.call_team_categories.some((c) => c.id === id)) db.tables.call_team_categories.push({ id, catalog_entity_id: FIRM, incubator_id: null, name, permissions: { ...NO_PERMISSIONS, ...perms }, created_at: '2026-01-01T00:00:00.000Z' });
  db.tables.call_team_members.push({ id: `tm-${callId.slice(0, 4)}-${userId}`, call_id: callId, user_id: userId, category_id: id, permission_overrides: {}, created_at: '2026-01-02T00:00:00.000Z' });
};
function application(callId: string, tag: string, ref: string, name: string, over: { decision?: 'advance' | 'reject' | 'waitlist'; eligibility?: 'fit' | 'not_fit' } = {}) {
  const id = `aaaaaaaa-0000-4000-8000-${tag.padStart(12, '0')}`; const org = `bbbbbbbb-0000-4000-8000-${tag.padStart(12, '0')}`;
  db.users.set(`ap-${tag}`, { id: `ap-${tag}`, email: `ap-${tag}@startup${tag}.com`, user_metadata: { full_name: `Founder ${tag}` } });
  db.tables.orgs.push({ id: org, name });
  db.tables.org_members.push({ org_id: org, user_id: `ap-${tag}`, role: 'owner', full_name: `Founder ${tag}`, title: 'CEO' });
  db.tables.call_applications.push({ id, call_id: callId, startup_org_id: org, applicant_user_id: `ap-${tag}`, status: 'submitted', reference: ref, draft_answers: {}, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' });
  db.tables.call_application_eligibility.push({ id: `el-${id}`, call_id: callId, application_id: id, status: over.eligibility ?? 'fit', is_current: true, source: 'engine', rule_results: [], overrides: {}, reason: '', created_at: '2026-10-11T00:00:00Z' });
  if (over.decision) db.tables.call_eval_decisions.push({ id: `d-${id}`, call_id: callId, application_id: id, decision: over.decision, note: 'INTERNAL-DECISION-NOTE', decided_by: 'decider', is_current: true, decided_at: '2026-10-20T00:00:00Z' });
  db.tables.call_evaluations.push({ id: `ev-${id}`, call_id: callId, application_id: id, evaluator_user_id: 'rita', grid_version: 1, status: 'submitted', grade_percent: 77, overall_comment: 'OVERALL-COMMENT-SECRET', private_note: 'PRIVATE-NOTE-SECRET', revision: 1, reopened_count: 0 });
  return id;
}
const setStatus = (callId: string, status: string) => { Object.assign(db.tables.calls.find((c) => c.id === callId)!, { status, closed_at: status === 'closed' ? '2026-10-15T00:00:00Z' : null }); };
const noticesOf = (user: string) => db.tables.call_notices.filter((n) => n.user_id === user && n.kind === 'result_published');

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); currentUser = null; mail.sent.length = 0; mail.calls = 0; mail.behaviour = () => ({ sent: true });
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  member('ana', 'admin');
  as('ana');
  CALL = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: NAME })))).body.call.id as string;
  OTHER = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Other Call' })))).body.call.id as string;
  member('pat'); onTeam(CALL, 'pat', 'Publisher', { publish_results: true });
  member('decider'); onTeam(CALL, 'decider', 'Decider', { final_decision: true });
  member('conf'); onTeam(CALL, 'conf', 'Configurer', { configure_call: true, manage_team: true });
  member('rita'); onTeam(CALL, 'rita', 'Evaluator', { evaluate_assigned: true });
  A.adv = application(CALL, '1', 'REF-001', 'Blue Health', { decision: 'advance' });
  A.rej = application(CALL, '2', 'REF-002', 'Cyan Labs', { decision: 'reject' });
  A.wl = application(CALL, '3', 'REF-003', 'Green Tech', { decision: 'waitlist' });
  A.nofit = application(CALL, '4', 'REF-004', 'Red Ltd', { eligibility: 'not_fit' });
  application(OTHER, '9', 'REF-009', 'Other Startup', { decision: 'advance' });
  setStatus(CALL, 'closed');
});

describe('only "Publish results" publishes', () => {
  it('403 for everybody else, on every action, and nothing happens', async () => {
    for (const u of ['rita', 'decider', 'conf']) {
      expect((await getPub(u)).status, u).toBe(403);
      for (const action of ['test', 'publish', 'schedule', 'cancel_schedule', 'process_sends', 'resend']) {
        const r = await act(u, { action, confirmName: NAME, at: new Date(Date.now() + 3_600_000).toISOString(), sendId: 'x' });
        expect(r.status, `${u} ${action}`).toBe(403);
        expect(r.body.error, `${u} ${action}`).toBe('You do not have the “Publish results” permission on this call.');
      }
    }
    expect(resultsOf()).toHaveLength(0); expect(mail.sent).toHaveLength(0); expect(db.tables.call_result_batches).toHaveLength(0);
  });
});

describe('nothing reaches an applicant before the results are published', () => {
  it('no result, no notice, no email — and what the applicant reads is empty', async () => {
    await getPub('pat'); await prep('pat'); await putSettings('pat', { feedbackEnabled: true });
    await postResults('pat', { action: 'preview', applicationId: A.adv });
    await act('pat', { action: 'test' });                                               // a test goes to the administrator, never to an applicant
    expect(resultsOf()).toHaveLength(0);
    expect(db.tables.call_notices.filter((n) => n.kind === 'result_published')).toHaveLength(0);
    expect(db.tables.call_result_sends).toHaveLength(0);
    expect(mail.sent.every((m) => m.to === 'pat@pat.test')).toBe(true);
    expect(await myResult('ap-1', A.adv)).toMatchObject({ status: 200, body: { ok: true, result: null } });
  });
});

describe('what stops a publication', () => {
  it('an application without a decision, a call that is still open, a wrong confirmation, an archived call — each in words, and nothing is written', async () => {
    const pend = application(CALL, '5', 'REF-005', 'Grey Co');
    expect(await act('pat', { action: 'publish', confirmName: NAME })).toMatchObject({ status: 409, body: { error: '1 application has no decision yet. Every application needs one before the results can be published.' } });
    db.tables.call_eval_decisions.push({ id: 'd-pend', call_id: CALL, application_id: pend, decision: 'waitlist', note: null, decided_by: 'decider', is_current: true });
    expect(await act('pat', { action: 'publish', confirmName: 'something else' })).toMatchObject({ status: 400, body: { error: 'Type the name of the call to confirm.' } });
    expect(await act('pat', { action: 'publish' })).toMatchObject({ status: 400 });
    setStatus(CALL, 'open');
    expect((await act('pat', { action: 'publish', confirmName: NAME })).body.error).toContain('not closed yet');
    setStatus(CALL, 'archived');
    expect(await act('pat', { action: 'publish', confirmName: NAME })).toMatchObject({ status: 409, body: { error: 'An archived call cannot be changed.' } });
    expect(resultsOf()).toHaveLength(0); expect(db.tables.call_result_batches).toHaveLength(0); expect(mail.sent).toHaveLength(0);
  });
});

describe('publishing now', () => {
  it('every application of the phase gets its result, its notice and its email at once; the batch records who and when; the confirmation ignores capitals and spaces', async () => {
    const r = await act('pat', { action: 'publish', confirmName: `  ${NAME.toUpperCase()}  ` });
    expect(r.status).toBe(200);
    expect(r.body.published).toBe(4);
    expect(resultsOf().map((x) => [x.application_id, x.result, x.label, x.source]).sort()).toEqual([
      [A.adv, 'advance', 'Selected', 'decision'], [A.nofit, 'reject', 'Not selected', 'eligibility'], [A.rej, 'reject', 'Not selected', 'decision'], [A.wl, 'waitlist', 'Waiting list', 'decision'],
    ].sort());
    expect(db.tables.call_result_batches).toMatchObject([{ status: 'published', published_by: 'pat', total: 4, counts: { advance: 1, reject: 2, waitlist: 1 } }]);
    expect(events('results_published')).toMatchObject([{ actor_user_id: 'pat', detail: { total: 4, counts: { advance: 1, reject: 2, waitlist: 1 }, scheduled: false } }]);
    for (const u of ['ap-1', 'ap-2', 'ap-3', 'ap-4']) expect(noticesOf(u), u).toHaveLength(1);
    expect(mail.sent.map((m) => m.to).sort()).toEqual(['ap-1@startup1.com', 'ap-2@startup2.com', 'ap-3@startup3.com', 'ap-4@startup4.com']);
    expect(db.tables.call_result_sends.every((s) => s.status === 'sent')).toBe(true);
    // not another startup's applicant, not another call
    expect(db.tables.call_notices.filter((n) => n.kind === 'result_published' && n.user_id === 'ap-9')).toHaveLength(0);
    expect(resultsOf(OTHER)).toHaveLength(0);
  });

  it('the email carries the header of the call (the entity and the title), the label and the message with the names filled in — and nothing an evaluator wrote', async () => {
    await act('pat', { action: 'publish', confirmName: NAME });
    const m = mail.sent.find((x) => x.to === 'ap-1@startup1.com')!;
    expect(m.subject).toBe(`${NAME}: Selected`);
    expect(m.html).toContain(`<h1 style="font-size: 18px; font-weight: 600; margin: 0 0 4px;">${NAME}</h1>`);
    expect(m.html).toContain('>Selected</p>');
    expect(m.html).toContain('Dear Founder 1,');
    expect(m.html).toContain('Blue Health has been selected in “Seed Call 2027”');
    expect(m.html).toContain('zz-test-firm');
    for (const secret of ['OVERALL-COMMENT-SECRET', 'PRIVATE-NOTE-SECRET', 'INTERNAL-DECISION-NOTE']) { expect(m.html).not.toContain(secret); expect(m.text ?? '').not.toContain(secret); }
  });

  it('the applicant reads their result on their application: the label and the message — and only their own', async () => {
    await act('pat', { action: 'publish', confirmName: NAME });
    const mine = await myResult('ap-2', A.rej);
    expect(mine.body.result).toMatchObject({ label: 'Not selected', kind: 'reject', grade: null });
    expect(mine.body.result.html).toContain('Cyan Labs was not selected this time');
    expect((await myResult('ap-2', A.adv)).status).toBe(404);                           // another startup's application: not found, never "forbidden"
    expect((await myResult('ap-1', A.adv)).body.result.label).toBe('Selected');
  });

  it('it is done once: a second attempt is refused, and a batch that was left half way is FINISHED, never doubled', async () => {
    await act('pat', { action: 'publish', confirmName: NAME });
    expect((await act('pat', { action: 'publish', confirmName: NAME })).status).toBe(409);
    expect(resultsOf()).toHaveLength(4);
    // a request that died after saving two results and before the rest
    db.tables.call_results.splice(2); db.tables.call_notices.splice(0); db.tables.call_result_sends.splice(0);
    Object.assign(db.tables.call_result_batches[0], { status: 'publishing', published_at: null });
    const resumed = await act('pat', { action: 'publish', confirmName: NAME });
    expect(resumed.status).toBe(200);
    expect(resultsOf()).toHaveLength(4);
    expect(new Set(resultsOf().map((x) => x.application_id)).size).toBe(4);
    expect(db.tables.call_result_batches).toHaveLength(1);
    expect(db.tables.call_result_batches[0].status).toBe('published');
    expect(db.tables.call_result_sends).toHaveLength(4);
    expect(db.tables.call_notices.filter((n) => n.kind === 'result_published')).toHaveLength(4);
  });
});

describe('My applications', () => {
  const mine = async (u: string) => { as(u); return (await overviewGet(json('GET'))).json().then((b: { mine: { applicationId: string; stage: string; resultLabel: string | null }[] }) => b.mine); };
  it('shows no result before the entity publishes, and the label — with the stage "Result available" — after', async () => {
    expect((await mine('ap-1'))[0]).toMatchObject({ applicationId: A.adv, stage: 'submitted', resultLabel: null });
    await act('pat', { action: 'publish', confirmName: NAME });
    expect((await mine('ap-1'))[0]).toMatchObject({ applicationId: A.adv, stage: 'result_available', resultLabel: 'Selected' });
    expect((await mine('ap-2'))[0]).toMatchObject({ stage: 'result_available', resultLabel: 'Not selected' });
    expect(JSON.stringify(await mine('ap-2'))).not.toContain('Selected"');                    // never another applicant's result
  });
  it('a schedule whose time has passed goes out when an applicant opens their applications (the daily job may be hours away)', async () => {
    await schedule(admin(), await callObj(), 'pat', new Date(Date.now() + 3 * 3_600_000).toISOString(), NAME);
    Object.assign(db.tables.call_result_batches[0], { scheduled_at: new Date(Date.now() - 60_000).toISOString() });    // its time has come
    expect(resultsOf()).toHaveLength(0);
    expect((await mine('ap-1'))[0]).toMatchObject({ stage: 'result_available', resultLabel: 'Selected' });
    expect(resultsOf()).toHaveLength(4);
  });
});

describe('the decisions become fixed', () => {
  it('after publishing, an Advance/Reject/Waitlist cannot be changed (409, with why); before, it can', async () => {
    expect((await decide('decider', A.wl, 'advance')).status).toBe(200);
    expect((await decide('decider', A.wl, 'waitlist')).status).toBe(200);
    await act('pat', { action: 'publish', confirmName: NAME });
    const r = await decide('decider', A.wl, 'advance');
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('The result of this application was already published, so its decision is fixed. Only an accepted contestation can change it.');
    expect((await decide('decider', A.rej, null)).status).toBe(409);
  });
  it('and also while a publication is scheduled: nothing under it can move; cancelling the schedule frees it', async () => {
    const at = new Date(Date.now() + 3 * 3_600_000).toISOString();
    expect((await act('pat', { action: 'schedule', at, confirmName: NAME })).status).toBe(200);
    expect((await decide('decider', A.wl, 'advance')).status).toBe(409);
    expect((await putSettings('pat', { labels: { advance: 'Welcome' } })).status).toBe(409);
    expect((await postResults('pat', { action: 'feedback', applicationId: A.wl, text: 'x' })).status).toBe(409);
    expect((await act('pat', { action: 'cancel_schedule' })).status).toBe(200);
    expect((await decide('decider', A.wl, 'advance')).status).toBe(200);
    expect((await putSettings('pat', { labels: { advance: 'Welcome' } })).status).toBe(200);
  });
  it('what comes after the results — how long the data is kept, contestations — can still be set once published', async () => {
    await act('pat', { action: 'publish', confirmName: NAME });
    expect((await putSettings('pat', { retentionMonths: 36 })).status).toBe(200);
    expect((await putSettings('pat', { labels: { advance: 'Changed afterwards' } })).status).toBe(409);
    expect((await prep('pat')).body.locked).toBe(true);
  });
});

describe('scheduling', () => {
  it('a time in the past (or a few seconds away) is refused; a time ahead is kept, with nothing sent until it comes', async () => {
    expect((await act('pat', { action: 'schedule', at: new Date(Date.now() - 1000).toISOString(), confirmName: NAME })).status).toBe(400);
    expect((await act('pat', { action: 'schedule', at: 'tomorrow', confirmName: NAME })).status).toBe(400);
    const at = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const r = await act('pat', { action: 'schedule', at, confirmName: NAME });
    expect(r.status).toBe(200);
    expect(r.body.batch).toMatchObject({ status: 'scheduled', scheduledAt: at });
    expect(resultsOf()).toHaveLength(0); expect(mail.sent).toHaveLength(0);
    expect(events('results_scheduled')).toMatchObject([{ actor_user_id: 'pat' }]);
    expect((await act('pat', { action: 'publish', confirmName: NAME })).body.error).toContain('already scheduled');
    expect((await act('pat', { action: 'schedule', at, confirmName: NAME })).status).toBe(409);
  });
  it('the schedule goes out when its time has come — once, even if two people open the app at the same moment — and not before', async () => {
    const at = new Date(Date.now() + 3 * 3_600_000);
    await schedule(admin(), await callObj(), 'pat', at.toISOString(), NAME);
    expect(await runDueBatches(admin(), new Date(at.getTime() - 60_000))).toEqual({ due: 0, published: 0 });
    expect(resultsOf()).toHaveLength(0);
    const [one, two] = await Promise.all([runDueBatches(admin(), new Date(at.getTime() + 60_000)), runDueBatches(admin(), new Date(at.getTime() + 60_000))]);
    expect(one.published + two.published).toBe(1);
    expect(resultsOf()).toHaveLength(4);
    expect(db.tables.call_result_batches).toMatchObject([{ status: 'published', published_by: 'pat' }]);
    expect(events('results_published')).toMatchObject([{ detail: { scheduled: true } }]);
    expect(mail.sent).toHaveLength(4);
    expect(await runDueBatches(admin(), new Date(at.getTime() + 120_000))).toEqual({ due: 0, published: 0 });
  });
  it('a schedule that can no longer hold (the call was archived) is cancelled with the reason, and nothing goes out', async () => {
    const at = new Date(Date.now() + 3 * 3_600_000);
    await schedule(admin(), await callObj(), 'pat', at.toISOString(), NAME);
    setStatus(CALL, 'archived');
    expect(await runDueBatches(admin(), new Date(at.getTime() + 60_000))).toEqual({ due: 1, published: 0 });
    expect(resultsOf()).toHaveLength(0);
    expect(db.tables.call_result_batches[0].status).toBe('cancelled');
    expect(events('results_schedule_failed')).toHaveLength(1);
  });
  it('cancelling a schedule that is not there says so', async () => {
    expect((await act('pat', { action: 'cancel_schedule' })).status).toBe(409);
    expect((await cancelSchedule(admin(), await callObj(), 'pat')).ok).toBe(false);
  });
});

describe('"Selected" in a call with another phase moves the application on', () => {
  it('Advance → the next phase (a new decision is needed there); Reject and Waitlist stay; the label says "Moves to the next phase"', async () => {
    const first = db.tables.call_phases.find((p) => p.call_id === CALL)!;
    db.tables.call_phases.push({ id: 'phase-2', call_id: CALL, position: (first.position as number) + 1, name: 'Pitch', starts_on: null, ends_on: null });
    const before = (await prep('pat')).body;
    expect(before.phase).toMatchObject({ id: first.id, hasNext: true });
    expect(before.labels.advance).toBe('Moves to the next phase');
    const r = await act('pat', { action: 'publish', confirmName: NAME });
    expect(r.status).toBe(200);
    const app = (id: string) => db.tables.call_applications.find((a) => a.id === id)!;
    expect(app(A.adv).current_phase_id).toBe('phase-2');
    expect(app(A.rej).current_phase_id ?? null).toBeNull();
    expect(app(A.wl).current_phase_id ?? null).toBeNull();
    expect(resultsOf().find((x) => x.application_id === A.adv)).toMatchObject({ label: 'Moves to the next phase', phase_id: first.id, moved_to_phase_id: 'phase-2' });
    // its earlier decision is history; in the next phase the application has none yet
    expect(db.tables.call_eval_decisions.find((d) => d.application_id === A.adv)!.is_current).toBe(false);
    const next = (await prep('pat')).body;
    expect(next.phase).toMatchObject({ id: 'phase-2', name: 'Pitch', hasNext: false });
    expect(next.summary.total).toBe(1);
    expect(next.summary.pending).toHaveLength(1);
    expect((await getPub('pat')).body.blockers.map((b: { code: string }) => b.code)).toEqual(['pending']);
    // the applicant sees "Moves to the next phase", and the next phase can be decided and published by itself
    expect((await myResult('ap-1', A.adv)).body.result).toMatchObject({ label: 'Moves to the next phase', movedOn: true });
    expect((await decide('decider', A.adv, 'advance')).status).toBe(200);
    expect((await act('pat', { action: 'publish', confirmName: NAME })).status).toBe(200);
    expect(db.tables.call_result_batches.filter((b) => b.status === 'published')).toHaveLength(2);
    expect(resultsOf().filter((x) => x.application_id === A.adv && x.is_current)).toHaveLength(2);
    expect(app(A.adv).current_phase_id).toBe('phase-2');                                  // the last phase has nowhere to move to
  });
  it('a call with one phase moves nobody', async () => {
    await act('pat', { action: 'publish', confirmName: NAME });
    expect(db.tables.call_applications.every((a) => !a.current_phase_id)).toBe(true);
    expect(resultsOf().find((x) => x.application_id === A.adv)!.label).toBe('Selected');
  });
});

describe('the emails leave from a queue', () => {
  it('a temporary failure is tried again with a growing wait — and the result is in the app all the while', async () => {
    mail.behaviour = (to) => (to === 'ap-2@startup2.com' ? { sent: false, error: 'provider timeout' } : { sent: true });
    await act('pat', { action: 'publish', confirmName: NAME });
    const send = db.tables.call_result_sends.find((s) => s.user_id === 'ap-2')!;
    expect(send).toMatchObject({ status: 'queued', attempts: 1, last_error: 'provider timeout' });
    expect(Date.parse(String(send.next_attempt_at)) - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(noticesOf('ap-2')).toHaveLength(1);
    expect((await myResult('ap-2', A.rej)).body.result.label).toBe('Not selected');       // a failed email never keeps the result out of the app
    expect(db.tables.call_result_sends.filter((s) => s.status === 'sent')).toHaveLength(3);
    // not yet due: nothing is sent; once the wait is over it goes
    expect((await processSends(admin(), { callId: CALL })).tried).toBe(0);
    mail.behaviour = () => ({ sent: true });
    const later = await processSends(admin(), { callId: CALL, now: new Date(Date.now() + 10 * 60_000) });
    expect(later).toMatchObject({ tried: 1, sent: 1 });
    expect(db.tables.call_result_sends.find((s) => s.user_id === 'ap-2')).toMatchObject({ status: 'sent', attempts: 2, last_error: null });
  });
  it('an address the provider rejects is "bounced" (not retried); after five temporary failures it is "failed"', async () => {
    mail.behaviour = (to) => (to === 'ap-1@startup1.com' ? { sent: false, error: 'Invalid recipient address' } : to === 'ap-3@startup3.com' ? { sent: false, error: 'rate limit' } : { sent: true });
    await act('pat', { action: 'publish', confirmName: NAME });
    expect(db.tables.call_result_sends.find((s) => s.user_id === 'ap-1')).toMatchObject({ status: 'bounced', attempts: 1 });
    let t = Date.now();
    for (let i = 0; i < 6; i++) { t += 13 * 3_600_000; await processSends(admin(), { callId: CALL, now: new Date(t) }); }
    expect(db.tables.call_result_sends.find((s) => s.user_id === 'ap-3')).toMatchObject({ status: 'failed', attempts: 5 });
    expect(db.tables.call_result_sends.find((s) => s.user_id === 'ap-1')!.attempts).toBe(1);
  });
  it('the administrator sees every email with its state and sends one again; "send the waiting ones" takes the rest', async () => {
    mail.behaviour = (to) => (to === 'ap-4@startup4.com' ? { sent: false, error: 'Invalid recipient address' } : { sent: true });
    await act('pat', { action: 'publish', confirmName: NAME });
    const view = (await getPub('pat')).body;
    expect(view.sends.counts).toEqual({ queued: 0, sent: 3, bounced: 1, failed: 0 });
    const bounced = view.sends.rows.find((r: { status: string }) => r.status === 'bounced');
    expect(bounced).toMatchObject({ reference: 'REF-004', startupName: 'Red Ltd', label: 'Not selected', error: 'Invalid recipient address' });
    expect(JSON.stringify(view)).not.toContain('@startup');                              // the entity never sees an address
    mail.behaviour = () => ({ sent: true });
    const again = await act('pat', { action: 'resend', sendId: bounced.sendId });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('sent');
    expect(again.body.sends.counts).toMatchObject({ sent: 4, bounced: 0 });
    expect((await act('pat', { action: 'resend', sendId: 'nope' })).status).toBe(404);
    expect(events('result_email_resent')).toHaveLength(1);
  });
  it('an applicant with no email address fails in words and the rest still go', async () => {
    db.users.get('ap-3')!.email = '';
    await act('pat', { action: 'publish', confirmName: NAME });
    expect(db.tables.call_result_sends.find((s) => s.user_id === 'ap-3')).toMatchObject({ status: 'failed', last_error: 'The applicant has no email address.' });
    expect(db.tables.call_result_sends.filter((s) => s.status === 'sent')).toHaveLength(3);
  });
});

describe('"Send me a test"', () => {
  it('one email of each result, with example data, to the administrator who asked and nobody else; nothing is written for any applicant; it is limited per hour', async () => {
    db.clock = Date.now();                                                               // the fake database stamps its events with this clock; the limit looks at the last hour
    const r = await act('pat', { action: 'test' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sent: 3, to: 'p•••@pat.test' });
    expect(mail.sent.map((m) => m.to)).toEqual(['pat@pat.test', 'pat@pat.test', 'pat@pat.test']);
    expect(mail.sent.map((m) => m.subject)).toEqual([`[Test] ${NAME}: Selected`, `[Test] ${NAME}: Not selected`, `[Test] ${NAME}: Waiting list`]);
    expect(mail.sent[0].html).toContain('Dear Alex Example,');
    expect(mail.sent[0].html).toContain('Acme Robotics');
    expect(resultsOf()).toHaveLength(0); expect(db.tables.call_notices).toHaveLength(0); expect(db.tables.call_result_sends).toHaveLength(0);
    for (let i = 0; i < 5; i++) expect((await act('pat', { action: 'test' })).status).toBe(200);   // six in the hour are allowed
    expect((await act('pat', { action: 'test' })).status).toBe(429);
  });
});

describe('the grade is shared only if the call says so, and only the validated one', () => {
  it('off by default: a published message never carries a grade, whatever was validated', async () => {
    await postResults('pat', { action: 'grade', applicationId: A.adv, grade: '90' });                 // refused: the option is off
    expect((await postResults('pat', { action: 'grade', applicationId: A.adv, grade: '90' })).status).toBe(409);
    await act('pat', { action: 'publish', confirmName: NAME });
    expect(mail.sent.every((m) => !m.html.includes('Score'))).toBe(true);
    expect((await myResult('ap-1', A.adv)).body.result.grade).toBeNull();
  });
  it('on: every evaluated application needs the grade an administrator validates before publishing; the message carries exactly that — never the average, never a score of an evaluator', async () => {
    expect((await putSettings('pat', { shareGrade: true })).status).toBe(200);
    const pub = await getPub('pat');
    expect(pub.body.blockers.map((b: { code: string }) => b.code)).toEqual(['missing_grade']);
    expect(pub.body.blockers[0].text).toBe('3 applications have no validated grade yet. The grade is shared with the applicants, so each one needs it before the results can be published.');
    expect((await act('pat', { action: 'publish', confirmName: NAME })).status).toBe(409);
    for (const [id, g] of [[A.adv, '91,5'], [A.rej, '48'], [A.wl, '70.25']] as const) expect((await postResults('pat', { action: 'grade', applicationId: id, grade: g })).status).toBe(200);
    expect((await postResults('pat', { action: 'grade', applicationId: A.adv, grade: '101' })).status).toBe(400);
    expect((await postResults('pat', { action: 'grade', applicationId: A.adv, grade: 'high' })).status).toBe(400);
    expect((await postResults('pat', { action: 'grade', applicationId: A.nofit, grade: '10' })).body.error).toContain('not evaluated');   // a "Not a fit" was never evaluated
    expect((await getPub('pat')).body.blockers).toEqual([]);
    expect((await act('pat', { action: 'publish', confirmName: NAME })).status).toBe(200);
    const m = (to: string) => mail.sent.find((x) => x.to === to)!;
    expect(m('ap-1@startup1.com').html).toContain('<strong>Score:</strong> 91.5%');
    expect(m('ap-2@startup2.com').html).toContain('<strong>Score:</strong> 48%');
    expect(m('ap-3@startup3.com').html).toContain('<strong>Score:</strong> 70.25%');
    expect(m('ap-4@startup4.com').html).not.toContain('Score');                                       // never evaluated: no score
    for (const x of mail.sent) { expect(x.html).not.toContain('77'); expect(x.html).not.toContain('SECRET'); }   // 77 is the evaluator's grade_percent
    expect((await myResult('ap-1', A.adv)).body.result.grade).toBe(91.5);
    expect(resultsOf().find((r) => r.application_id === A.nofit)!.grade).toBeNull();
  });
  it('the grade of a published application is fixed like everything else', async () => {
    await putSettings('pat', { shareGrade: true });
    for (const id of [A.adv, A.rej, A.wl]) await postResults('pat', { action: 'grade', applicationId: id, grade: '60' });
    await act('pat', { action: 'publish', confirmName: NAME });
    expect((await postResults('pat', { action: 'grade', applicationId: A.adv, grade: '99' })).status).toBe(409);
  });
});

describe('the library calls behave like the routes', () => {
  it('publishNow refuses without the typed name and publishes with it', async () => {
    expect(await publishNow(admin(), await callObj(), 'pat', 'nope')).toMatchObject({ ok: false, status: 400 });
    expect(await publishNow(admin(), await callObj(), 'pat', NAME)).toMatchObject({ ok: true, published: 4 });
  });
});
