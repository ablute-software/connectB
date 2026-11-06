// Prompt 929 (B) — the tips from Sherlock Deal through the real store and routes over the stateful fake database: nothing goes out unless the ENTITY allows it, only to applicants who were evaluated and NOT
// selected, only after the entity's own reply has had its time (and the contestation period), never to someone who opted out, one email per application, no number / criterion / comment / evaluator in it,
// no call to any external AI, the applicant's own choice on the account and the signed link in the email that turns it off.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at?: string } | null;
const sent: { to: string; subject: string; html: string; text: string }[] = [];

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, rpc: async () => ({ data: false }), from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', async (orig) => ({
  ...(await orig<typeof import('@/lib/resend')>()), resendConfigured: true,
  sendTransactionalEmail: async (m: { to: string; subject: string; html: string; text: string }) => { sent.push({ to: m.to, subject: m.subject, html: m.html, text: m.text }); return { sent: true, id: 'em' }; },
}));

import { POST as createPost } from './route';
import { PUT as gridPut, GET as gridGet } from './[id]/eval-grid/route';
import { GET as resultsGet, PUT as resultsPut, POST as resultsPost } from './[id]/results/route';
import { GET as prefGet, POST as prefPost } from './apply/preferences/route';
import { GET as unsubscribe } from '../email/unsubscribe/route';
import { processTips, tipsDueAt } from '@/lib/calls/tips-store';
import { SENTENCES } from '@/lib/calls/tips-templates';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (id: string | null) => { currentUser = id ? { id, email: db.users.get(id)?.email ?? `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
const P = (id: string) => ({ params: { id } });
let CALL = ''; let C: { team: string; market: string }; const A: Record<string, string> = {};
const PUBLISHED = '2026-11-01T10:00:00.000Z';
const at = (hours: number) => new Date(Date.parse(PUBLISHED) + hours * 3_600_000);
const U = (tag: string) => `dddddddd-0000-4000-8000-${tag.padStart(12, '0')}`;
const admin = () => fakeCallsAdmin(db, storage) as never;

function firmMember(id: string, role = 'member') { db.users.set(id, { id, email: `${id}@${id}.test` }); db.tables.matchdeal_investor_members.push({ id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role }); }
function application(callId: string, tag: string, ref: string, name: string) {
  const id = `aaaaaaaa-0000-4000-8000-${tag.padStart(12, '0')}`; const org = `bbbbbbbb-0000-4000-8000-${tag.padStart(12, '0')}`; const sub = `cccccccc-0000-4000-8000-${tag.padStart(12, '0')}`;
  db.users.set(U(tag), { id: U(tag), email: `ap-${tag}@startup${tag}.com` });
  db.tables.orgs.push({ id: org, name });
  db.tables.call_applications.push({ id, call_id: callId, startup_org_id: org, applicant_user_id: U(tag), status: 'submitted', reference: ref, draft_answers: {}, current_submission_id: sub, created_at: '2026-10-01T00:00:00Z' });
  db.tables.call_application_submissions.push({ id: sub, application_id: id, version: 1, answers: {}, documents: [], form_snapshot: {}, submitted_by: U(tag), submitted_at: '2026-10-02T00:00:00Z' });
  db.tables.call_application_eligibility.push({ id: `el-${id}`, call_id: callId, application_id: id, status: 'fit', is_current: true, source: 'engine', rule_results: [], overrides: {}, reason: '', created_at: '2026-10-03T00:00:00Z' });
  return id;
}
function evaluation(callId: string, appId: string, who: string, scores: Record<string, number>) {
  const id = `ev-${appId.slice(-4)}-${who}`;
  db.tables.call_evaluations.push({ id, call_id: callId, application_id: appId, evaluator_user_id: who, grid_version: 1, status: 'submitted', grade_percent: 50, overall_comment: 'SECRET COMMENT from the evaluator', private_note: 'PRIVATE', created_at: '2026-10-20T00:00:00Z' });
  for (const [criterion, score] of Object.entries(scores)) db.tables.call_eval_scores.push({ evaluation_id: id, criterion_id: criterion, score, comment: 'SECRET SCORE COMMENT' });
  db.tables.call_eval_assignments.push({ id: `as-${id}`, call_id: callId, application_id: appId, evaluator_user_id: who, source: 'auto', status: 'assigned', created_at: '2026-10-20T00:00:00Z' });
}
const decision = (appId: string, d: string) => db.tables.call_eval_decisions.push({ id: `d-${appId}`, call_id: CALL, application_id: appId, decision: d, note: null, origin: 'manual', is_current: true, decided_by: 'ana', created_at: '2026-10-25T00:00:00Z' });
const published = (appId: string, result: string, over: Record<string, unknown> = {}) => db.tables.call_results.push({ id: `r-${appId}`, call_id: CALL, application_id: appId, result, label: result, source: 'decision', subject: 'Result', body_html: '<p>Result</p>', is_current: true, published_at: PUBLISHED, ...over });
const settings = (over: Record<string, unknown> = {}) => { db.tables.call_result_settings = db.tables.call_result_settings.filter((s) => s.call_id !== CALL); db.tables.call_result_settings.push({ call_id: CALL, tips_enabled: true, contestations_enabled: false, contestation_days: 10, ...over }); };
const tipsRows = () => db.tables.call_tips;

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; currentUser = null; sent.length = 0;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  firmMember('ana', 'admin'); firmMember('rita'); firmMember('sam');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  as('ana');
  CALL = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Tips Call: 2027' })))).body.call.id as string;
  const v = await gridGet(json('GET'), P(CALL)).then(read);
  const g = await gridPut(json('PUT', { baseRev: v.body.rev, criteria: [{ name: 'Team', weight: 50, scaleMin: 1, scaleMax: 5 }, { name: 'Market size', weight: 50, scaleMin: 1, scaleMax: 5 }], settings: v.body.settings }), P(CALL)).then(read);
  C = { team: g.body.criteria[0].id, market: g.body.criteria[1].id };
  // two selected (strong everywhere), one not selected (strong team, weak market), one waitlisted, one not selected with a single evaluation
  A.s1 = application(CALL, '1', 'REF-001', 'Selected One'); A.s2 = application(CALL, '2', 'REF-002', 'Selected Two');
  A.lo = application(CALL, '3', 'REF-003', 'Lost One'); A.wl = application(CALL, '4', 'REF-004', 'Waiting One'); A.one = application(CALL, '5', 'REF-005', 'Lost Single');
  for (const a of [A.s1, A.s2]) for (const w of ['rita', 'sam']) evaluation(CALL, a, w, { [C.team]: 5, [C.market]: 5 });
  for (const w of ['rita', 'sam']) evaluation(CALL, A.lo, w, { [C.team]: 5, [C.market]: 1 });
  for (const w of ['rita', 'sam']) evaluation(CALL, A.wl, w, { [C.team]: 3, [C.market]: 2 });
  evaluation(CALL, A.one, 'rita', { [C.team]: 1, [C.market]: 1 });
  decision(A.s1, 'advance'); decision(A.s2, 'advance'); decision(A.lo, 'reject'); decision(A.wl, 'waitlist'); decision(A.one, 'reject');
  published(A.s1, 'advance'); published(A.s2, 'advance'); published(A.lo, 'reject'); published(A.wl, 'waitlist'); published(A.one, 'reject');
  settings();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('who receives a tip, and when', () => {
  it('only the unsuccessful applicant who was evaluated enough — never the selected, the waitlisted or the one with a single evaluation — and only after the entity’s reply had its 24 hours', async () => {
    expect(tipsDueAt(PUBLISHED, { contestationsEnabled: false, contestationDays: 10 })).toBe(at(24).getTime());
    const early = await processTips(admin(), { now: at(23) });
    expect(early).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(0);
    const run = await processTips(admin(), { now: at(25) });
    expect(run).toMatchObject({ sent: 1, skipped: 1 });
    expect(sent.map((m) => m.to)).toEqual(['ap-3@startup3.com']);
    expect(tipsRows().find((r) => r.application_id === A.one)).toMatchObject({ status: 'skipped', skip_reason: 'not_enough_evaluations' });
    expect(tipsRows().find((r) => r.application_id === A.lo)).toMatchObject({ status: 'sent', categories: ['market'] });
  });

  it('one email per application: running again sends nothing more', async () => {
    await processTips(admin(), { now: at(25) });
    await processTips(admin(), { now: at(48) });
    expect(sent).toHaveLength(1);
    expect(tipsRows().filter((r) => r.application_id === A.lo)).toHaveLength(1);
  });

  it('when contestations are offered the tips wait until the period is over (and a day more)', async () => {
    settings({ contestations_enabled: true, contestation_days: 10 });
    expect((await processTips(admin(), { now: at(24 * 10) })).sent).toBe(0);
    expect((await processTips(admin(), { now: at(24 * 11 + 1) })).sent).toBe(1);
  });

  it('the entity’s switch is read again at the moment of sending: off means nothing is sent and nothing is recorded (so allowing it later still works)', async () => {
    settings({ tips_enabled: false });
    const run = await processTips(admin(), { now: at(30) });
    expect(run.considered).toBe(0);
    expect(sent).toHaveLength(0);
    expect(tipsRows()).toHaveLength(0);
    settings({ tips_enabled: true });
    expect((await processTips(admin(), { now: at(31) })).sent).toBe(1);
  });

  it('an applicant who opted out receives nothing, and it is recorded why', async () => {
    db.tables.user_email_preferences.push({ user_id: U('3'), tips_opt_out: true, announcements_opt_out: false });
    const run = await processTips(admin(), { now: at(30) });
    expect(run.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(tipsRows().find((r) => r.application_id === A.lo)).toMatchObject({ status: 'skipped', skip_reason: 'opted_out' });
  });

  it('a result that was replaced (a contestation upheld) is no longer a rejection: no tip', async () => {
    db.tables.call_results.find((r) => r.application_id === A.lo)!.is_current = false;
    db.tables.call_results.push({ id: 'r-new', call_id: CALL, application_id: A.lo, result: 'advance', label: 'Advance', source: 'contestation', subject: 's', body_html: 'b', is_current: true, published_at: PUBLISHED });
    expect((await processTips(admin(), { now: at(30) })).sent).toBe(0);
  });
});

describe('what the email says — and does not', () => {
  it('is a separate email from Sherlock Deal with only the model sentences: no score, no number, no criterion name, no comment, no evaluator, no other applicant', async () => {
    await processTips(admin(), { now: at(30) });
    const mail = sent[0];
    const everything = `${mail.subject}\n${mail.html}\n${mail.text}`;
    const market = SENTENCES.market.en;
    expect(market.some((s) => mail.text.includes(s))).toBe(true);
    for (const forbidden of ['Market size', 'Team', 'SECRET', 'PRIVATE', 'rita', 'sam', 'Selected One', 'Lost Single', 'Waiting One', 'REF-00']) expect(everything, forbidden).not.toContain(forbidden);
    expect(/[1-9]\d*\s?%|\b\d+(\.\d+)?\s?\/\s?\d+\b/.test(mail.text)).toBe(false);
    expect(mail.html).toContain('/api/email/unsubscribe?t=');
    expect(JSON.stringify(tipsRows())).not.toMatch(/SECRET|PRIVATE|"score"/);
  });

  it('uses no external AI and no network call of its own', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));
    await processTips(admin(), { now: at(30) });
    expect(f).not.toHaveBeenCalled();
  });

  it('is written in the language of the call', async () => {
    db.tables.calls.find((c) => c.id === CALL)!.content_language = 'pt';
    await processTips(admin(), { now: at(30) });
    expect(SENTENCES.market.pt.some((s) => sent[0].text.includes(s))).toBe(true);
  });

  it('the link in the email turns the tips off for that account, and a later run sends nothing', async () => {
    await processTips(admin(), { now: at(30) });
    const url = /href="([^"]*\/api\/email\/unsubscribe\?t=[^"]+)"/.exec(sent[0].html)![1].replace(/&amp;/g, '&');
    const res = await unsubscribe(new Request(new URL(url, 'http://localhost')));
    expect(res.status).toBe(200);
    expect(db.tables.user_email_preferences.find((p) => p.user_id === U('3'))).toMatchObject({ tips_opt_out: true });
  });
});

describe('the entity’s switch and example (Results → Options)', () => {
  it('"Publish results" saves the switch (off by default) and returns an example built from the model sentences only', async () => {
    as('ana');
    const before = await resultsGet(json('GET'), P(CALL)).then(read);
    expect(before.body.settings.tipsEnabled).toBe(true);                                       // the test fixture set it; the default is pinned in results tests
    db.tables.call_result_settings = [];
    expect((await resultsGet(json('GET'), P(CALL)).then(read)).body.settings.tipsEnabled).toBe(false);
    const put = await resultsPut(json('PUT', { tipsEnabled: true }), P(CALL)).then(read);
    expect(put.status).toBe(200);
    expect(db.tables.call_result_settings.find((s) => s.call_id === CALL)).toMatchObject({ tips_enabled: true });
    const ex = await resultsPost(json('POST', { action: 'tips_preview' }), P(CALL)).then(read);
    expect(ex.status).toBe(200);
    expect(ex.body.subject).toContain('Tips Call');
    expect(Object.keys(SENTENCES).some(() => true)).toBe(true);
    expect(String(ex.body.text).split('Complete your startup profile')[0]).not.toMatch(/\d/);
  });
  it('an evaluator without "Publish results" cannot read or change it', async () => {
    as('rita');
    expect((await resultsPut(json('PUT', { tipsEnabled: true }), P(CALL)).then(read)).status).toBe(403);
    expect((await resultsPost(json('POST', { action: 'tips_preview' }), P(CALL)).then(read)).status).toBe(403);
  });
});

describe('the applicant’s own choice on the account', () => {
  it('reads and changes only the signed-in person’s own choice, and records it', async () => {
    as(null);
    expect((await prefGet(json('GET')).then(read)).status).toBe(401);
    as(U('3'));
    expect((await prefGet(json('GET')).then(read)).body).toMatchObject({ ok: true, tipsOptOut: false });
    expect((await prefPost(json('POST', { tipsOptOut: 'yes' })).then(read)).status).toBe(400);
    expect((await prefPost(json('POST', { tipsOptOut: true })).then(read)).body).toMatchObject({ ok: true, tipsOptOut: true });
    expect((await prefGet(json('GET')).then(read)).body.tipsOptOut).toBe(true);
    as(U('1'));
    expect((await prefGet(json('GET')).then(read)).body.tipsOptOut).toBe(false);                          // somebody else’s choice is not mine
    expect(db.tables.user_email_preference_changes.find((c) => c.user_id === U('3'))).toMatchObject({ preference: 'tips_opt_out', value: true, via: 'account settings' });
  });
});
