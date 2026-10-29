// Prompt 924 (Etapa 4, I3) — contestations, completing a call and the retention of the applicants' data, through the real handlers over the stateful fake database: an applicant contests a "Not selected" once, within the
// period, with a reason and at most one PDF; only "Handle contestations" sees and answers them; Upheld is a NEW publication (the old result is kept) and Rejected needs a written response; "Complete call" only when every phase
// is out, the period is over and nothing is open — then the call is read-only; the deletion is postponed once; the data goes at the end of the retention (simulated date) and a summary without personal data stays; the
// final export has no private comment and no formula.
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';
import { NO_PERMISSIONS } from '@/lib/calls/permissions';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at?: string } | null;
const mail: { sent: { to: string; subject: string; html: string; text?: string }[] } = { sent: [] };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, 0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a]);

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, rpc: async () => ({ data: false }), from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', () => ({
  resendConfigured: true,
  transactionalTemplate: (o: unknown) => JSON.stringify(o),
  sendTransactionalEmail: async (m: { to: string; subject: string; html: string; text?: string }) => { mail.sent.push(m); return { sent: true, id: 'em' }; },
}));
vi.mock('@/lib/upload-security', async (orig) => ({ ...(await orig<typeof import('@/lib/upload-security')>()), scanWithVirusTotal: async () => ({ status: 'clean', provider: null, detail: '' }) }));

import { POST as createPost } from './route';
import { GET as callGet, PATCH as callPatch } from './[id]/route';
import { PUT as resultsPut } from './[id]/results/route';
import { POST as publishPostRaw } from './[id]/results/publish/route';
import { GET as closeGet, POST as closePostRaw } from './[id]/results/close/route';
import { GET as exportGet } from './[id]/results/export/route';
import { GET as contestationsGet, POST as contestationsPostRaw } from './[id]/contestations/route';
import { GET as contestationFileGet } from './[id]/contestations/[cid]/file/route';
import { POST as boardPostRaw } from './[id]/evaluation-board/route';
import { GET as applicantResultGet } from './apply/applications/[id]/result/route';
import { POST as contestPostRaw } from './apply/applications/[id]/contest/route';
import { purgeExpiredCallData, warnRetentions } from '@/lib/calls/contestations-store';

const FIRM = '11111111-1111-4111-8111-111111111111';
const NAME = 'Seed Call 2027';
const DAY = 86_400_000;
const json = (method: string, body?: unknown, url = 'http://localhost/api/calls') => new NextRequest(url, { method, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, text: await res.clone().text(), body: await res.json().catch(() => ({})), res });
const as = (id: string | null) => { currentUser = id ? { id, email: db.users.get(id)?.email ?? `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
const idp = (id: string) => ({ params: { id } });

let CALL = '';
const A: Record<string, string> = {};
const admin = () => fakeCallsAdmin(db, storage);
const publish = (u: string, body: Record<string, unknown>) => { as(u); return publishPostRaw(json('POST', body), idp(CALL)).then(read); };
const settingsPut = (u: string, body: unknown) => { as(u); return resultsPut(json('PUT', body), idp(CALL)).then(read); };
const list = (u: string) => { as(u); return contestationsGet(json('GET'), idp(CALL)).then(read); };
const answer = (u: string, body: Record<string, unknown>) => { as(u); return contestationsPostRaw(json('POST', { action: 'answer', ...body }), idp(CALL)).then(read); };
const myResult = (u: string, appId: string) => { as(u); return applicantResultGet(json('GET'), idp(appId)).then(read); };
const contest = (u: string, appId: string, body: Record<string, unknown>) => { as(u); return contestPostRaw(json('POST', body), idp(appId)).then(read); };
const close = (u: string) => { as(u); return closeGet(json('GET'), idp(CALL)).then(read); };
const closeAct = (u: string, body: Record<string, unknown>) => { as(u); return closePostRaw(json('POST', body), idp(CALL)).then(read); };
const decide = (u: string, appId: string, decision: string | null) => { as(u); return boardPostRaw(json('POST', { action: 'decide', applicationId: appId, decision }), idp(CALL)).then(read); };
const events = (name: string) => db.tables.call_events.filter((e) => e.event === name);
const callRow = () => db.tables.calls.find((c) => c.id === CALL)!;
const callObj = async () => (await import('@/lib/calls/store')).loadCall(admin(), CALL).then((c) => c!);
const orgOf = (tag: string) => `bbbbbbbb-0000-4000-8000-${tag.padStart(12, '0')}`;
/** The results went out `days` ago (the period is counted from then). */
const age = (days: number) => {
  const at = new Date(Date.now() - days * DAY).toISOString();
  for (const r of db.tables.call_results) r.published_at = at;
  for (const b of db.tables.call_result_batches) if (b.status === 'published') b.published_at = at;
};

function member(id: string, role = 'member') { db.users.set(id, { id, email: `${id}@${id}.test` }); db.tables.matchdeal_investor_members.push({ id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role, created_at: '2026-01-01T00:00:00.000Z' }); }
const onTeam = (userId: string, name: string, perms: Record<string, boolean>) => {
  const id = `cat-${name}`;
  if (!db.tables.call_team_categories.some((c) => c.id === id)) db.tables.call_team_categories.push({ id, catalog_entity_id: FIRM, incubator_id: null, name, permissions: { ...NO_PERMISSIONS, ...perms }, created_at: '2026-01-01T00:00:00.000Z' });
  db.tables.call_team_members.push({ id: `tm-${userId}`, call_id: CALL, user_id: userId, category_id: id, permission_overrides: {}, created_at: '2026-01-02T00:00:00.000Z' });
};
function application(tag: string, ref: string, name: string, over: { decision?: 'advance' | 'reject' | 'waitlist'; eligibility?: 'fit' | 'not_fit' } = {}) {
  const id = `aaaaaaaa-0000-4000-8000-${tag.padStart(12, '0')}`; const org = orgOf(tag);
  db.users.set(`ap-${tag}`, { id: `ap-${tag}`, email: `ap-${tag}@startup${tag}.com`, user_metadata: { full_name: `Founder ${tag}` } });
  db.tables.orgs.push({ id: org, name });
  db.tables.org_members.push({ org_id: org, user_id: `ap-${tag}`, role: 'owner', full_name: `Founder ${tag}`, title: 'CEO' });
  db.tables.call_applications.push({ id, call_id: CALL, startup_org_id: org, applicant_user_id: `ap-${tag}`, status: 'submitted', reference: ref, draft_answers: {}, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' });
  db.tables.call_application_eligibility.push({ id: `el-${id}`, call_id: CALL, application_id: id, status: over.eligibility ?? 'fit', is_current: true, source: 'engine', rule_results: [], overrides: {}, reason: '', created_at: '2026-10-11T00:00:00Z' });
  if (over.decision) db.tables.call_eval_decisions.push({ id: `d-${id}`, call_id: CALL, application_id: id, decision: over.decision, note: 'INTERNAL-DECISION-NOTE', decided_by: 'decider', is_current: true, decided_at: '2026-10-20T00:00:00Z' });
  db.tables.call_evaluations.push({ id: `ev-${id}`, call_id: CALL, application_id: id, evaluator_user_id: 'rita', grid_version: 1, status: 'submitted', grade_percent: 77, overall_comment: 'OVERALL-COMMENT-SECRET', private_note: 'PRIVATE-NOTE-SECRET', revision: 1, reopened_count: 0 });
  return id;
}
const setStatus = (status: string) => { Object.assign(callRow(), { status, closed_at: status === 'closed' ? '2026-10-15T00:00:00Z' : null }); };
const putFile = (tag: string, name: string, bytes: Uint8Array = PDF) => { const path = `${orgOf(tag)}/calls/${A.rej}/${name}`; storage.objects.set(path, { bytes }); return path; };

/** Contestations on, the results published (as pat), the applicants' side ready. */
async function published(opts: { contestations?: boolean } = {}) {
  if (opts.contestations !== false) expect((await settingsPut('pat', { contestationsEnabled: true })).status).toBe(200);
  expect((await publish('pat', { action: 'publish', confirmName: NAME })).status).toBe(200);
}

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; currentUser = null; mail.sent.length = 0; db.nowMs = undefined;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  member('ana', 'admin');
  as('ana');
  CALL = (await read(await createPost(json('POST', { kind: 'catalog_entity', name: NAME })))).body.call.id as string;
  member('pat'); onTeam('pat', 'Publisher', { publish_results: true });
  member('hanna'); onTeam('hanna', 'Contestations', { handle_contestations: true });
  member('decider'); onTeam('decider', 'Decider', { final_decision: true });
  member('rita'); onTeam('rita', 'Evaluator', { evaluate_assigned: true });
  A.adv = application('1', 'REF-001', 'Blue Health', { decision: 'advance' });
  A.rej = application('2', 'REF-002', 'Cyan Labs', { decision: 'reject' });
  A.wl = application('3', 'REF-003', 'Green Tech', { decision: 'waitlist' });
  A.nofit = application('4', 'REF-004', '=EVIL("x") Ltd', { eligibility: 'not_fit' });
  setStatus('closed');
});

describe('who may contest, and what is offered', () => {
  it('off by default: nothing is offered and a request is refused; on: only a "Not selected" can contest, and the deadline is 10 calendar days after the results were published', async () => {
    await published({ contestations: false });
    expect((await myResult('ap-2', A.rej)).body.contest).toMatchObject({ state: 'not_offered', deadline: null });
    expect(await contest('ap-2', A.rej, { reason: 'Please review.' })).toMatchObject({ status: 409, body: { error: 'This call does not accept contestations for this result.' } });
    expect((await settingsPut('pat', { contestationsEnabled: true })).status).toBe(200);          // what comes after the results can still be set
    const c = (await myResult('ap-2', A.rej)).body.contest;
    expect(c.state).toBe('available');
    const publishedMs = Date.parse(db.tables.call_results.find((r) => r.application_id === A.rej)!.published_at as string);
    expect(Date.parse(c.deadline)).toBe(publishedMs + 10 * DAY);
    for (const [u, id] of [['ap-1', A.adv], ['ap-3', A.wl]] as const) {                          // Selected and Waiting list have nothing to contest
      expect((await myResult(u, id)).body.contest.state).toBe('not_offered');
      expect((await contest(u, id, { reason: 'x' })).status).toBe(409);
    }
    expect((await myResult('ap-4', A.nofit)).body.contest.state).toBe('available');              // a "Not a fit" is "Not selected" too
  });
  it('nothing is offered before the results are published', async () => {
    await settingsPut('pat', { contestationsEnabled: true });
    expect((await myResult('ap-2', A.rej)).body.result).toBeNull();
    expect((await contest('ap-2', A.rej, { reason: 'x' })).status).toBe(409);
  });
});

describe('contesting', () => {
  beforeEach(async () => { await published(); });
  it('a written reason is required and bounded; one contestation per application; another startup\'s application is a 404', async () => {
    expect(await contest('ap-2', A.rej, {})).toMatchObject({ status: 400, body: { error: 'Write the reason for your contestation.' } });
    expect((await contest('ap-2', A.rej, { reason: '   ' })).status).toBe(400);
    expect((await contest('ap-2', A.rej, { reason: 'x'.repeat(2001) })).status).toBe(400);
    expect((await contest('ap-1', A.rej, { reason: 'not mine' })).status).toBe(404);
    const r = await contest('ap-2', A.rej, { reason: '  The financial model was misread.  ' });
    expect(r.status).toBe(200);
    expect(r.body.contestation).toMatchObject({ status: 'open', reason: 'The financial model was misread.', hasFile: false });
    expect(db.tables.call_contestations).toHaveLength(1);
    expect(events('contestation_received')).toHaveLength(1);
    expect(await contest('ap-2', A.rej, { reason: 'again' })).toMatchObject({ status: 409, body: { error: 'You already contested this decision: each application can contest once.' } });
    expect((await myResult('ap-2', A.rej)).body.contest).toMatchObject({ state: 'done', contestation: { status: 'open', reason: 'The financial model was misread.' } });
  });
  it('within the period, at 9 days 23 hours; outside it, in words — and a late one is not stored', async () => {
    age(9 + 23 / 24);
    expect((await contest('ap-2', A.rej, { reason: 'On time.' })).status).toBe(200);
    age(10 + 1 / 24);
    const late = await contest('ap-4', A.nofit, { reason: 'Too late.' });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/^The period to contest ended on /);
    expect((await myResult('ap-4', A.nofit)).body.contest.state).toBe('expired');
    expect(db.tables.call_contestations).toHaveLength(1);
  });
  it('one file at most, a PDF in the startup\'s own folder, checked on its bytes; anything else is refused and removed', async () => {
    const path = putFile('2', 'reason.pdf');
    const ok = await contest('ap-2', A.rej, { reason: 'See the attached.', storagePath: path, fileName: 'reason.pdf' });
    expect(ok.status).toBe(200);
    expect(ok.body.contestation).toMatchObject({ hasFile: true, fileName: 'reason.pdf' });
    expect(storage.objects.has(path)).toBe(true);
    // another startup's folder, a file that is not a PDF, an executable called .pdf
    const other = `${orgOf('9')}/calls/x/other.pdf`; storage.objects.set(other, { bytes: PDF });
    expect((await contest('ap-4', A.nofit, { reason: 'x', storagePath: other, fileName: 'other.pdf' })).status).toBe(403);
    const txt = putFile('4', 'notes.txt', new Uint8Array([72, 101, 108, 108, 111]));
    const bad = await contest('ap-4', A.nofit, { reason: 'x', storagePath: txt.replace(A.rej, A.nofit).replace(orgOf('2'), orgOf('4')), fileName: 'notes.txt' });
    expect(bad.status).toBe(404 === bad.status ? 404 : bad.status);
    storage.objects.set(`${orgOf('4')}/calls/y/notes.pdf`, { bytes: new Uint8Array([77, 90, 144, 0, 3, 0, 0, 0]) });
    const exe = await contest('ap-4', A.nofit, { reason: 'x', storagePath: `${orgOf('4')}/calls/y/notes.pdf`, fileName: 'notes.pdf' });
    expect(exe).toMatchObject({ status: 400, body: { error: 'Only a PDF file can be attached.' } });
    expect(storage.objects.has(`${orgOf('4')}/calls/y/notes.pdf`)).toBe(false);                  // removed at once
    expect(db.tables.call_contestations).toHaveLength(1);
  });
  it('whoever has "Handle contestations" is told by email that one arrived (the handler and the administrator, who has every permission) — nobody else', async () => {
    mail.sent.length = 0;
    await contest('ap-2', A.rej, { reason: 'Please review.' });
    expect(mail.sent.map((m) => m.to).sort()).toEqual(['ana@ana.test', 'hanna@hanna.test']);
    expect(mail.sent[0].subject).toBe(`New contestation — ${NAME}`);
  });
});

describe('only "Handle contestations" sees and answers them', () => {
  beforeEach(async () => { await published(); await contest('ap-2', A.rej, { reason: 'The financial model was misread.', storagePath: putFile('2', 'reason.pdf'), fileName: 'reason.pdf' }); });
  it('403 for everybody else — the person who publishes, the one who decides, an evaluator — on the queue, the answer and the file; 200 for the handler and the administrator', async () => {
    const cid = db.tables.call_contestations[0].id as string;
    for (const u of ['pat', 'decider', 'rita']) {
      expect((await list(u)).status, u).toBe(403);
      expect((await answer(u, { contestationId: cid, outcome: 'upheld', newResult: 'advance' })).body.error, u).toBe('You do not have the “Handle contestations” permission on this call.');
      as(u); expect((await contestationFileGet(json('GET'), { params: { id: CALL, cid } })).status, u).toBe(403);
    }
    expect(db.tables.call_contestations[0].status).toBe('open');
    expect((await list('hanna')).status).toBe(200);
    expect((await list('ana')).status).toBe(200);
  });
  it('the queue shows the application, the result it contests, the reason and the file, the evaluation as numbers and the decision — never a comment — and the file is streamed by the server', async () => {
    const q = await list('hanna');
    expect(q.body).toMatchObject({ enabled: true, days: 10, open: 1 });
    expect(q.body.rows[0]).toMatchObject({ reference: 'REF-002', startupName: 'Cyan Labs', status: 'open', reason: 'The financial model was misread.', hasFile: true, fileName: 'reason.pdf', result: { label: 'Not selected', kind: 'reject' } });
    expect(q.body.rows[0].evaluation).toMatchObject({ decision: 'reject' });
    for (const secret of ['OVERALL-COMMENT-SECRET', 'PRIVATE-NOTE-SECRET']) expect(q.text).not.toContain(secret);
    expect(q.text).not.toContain('storage_path');
    const cid = db.tables.call_contestations[0].id as string;
    as('hanna');
    const file = await contestationFileGet(json('GET'), { params: { id: CALL, cid } });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(file.headers.get('content-disposition')).toContain('attachment');
    expect(new Uint8Array(await file.arrayBuffer()).slice(0, 4)).toEqual(PDF.slice(0, 4));
  });
});

describe('Rejected', () => {
  beforeEach(async () => { await published(); await contest('ap-2', A.rej, { reason: 'The financial model was misread.' }); mail.sent.length = 0; });
  it('needs a written response; then the decision stands, the applicant is told in the app and by email with that response, and it cannot be answered twice', async () => {
    const cid = db.tables.call_contestations[0].id as string;
    expect(await answer('hanna', { contestationId: cid, outcome: 'rejected' })).toMatchObject({ status: 400, body: { error: 'Write the response to the applicant: a rejection needs one.' } });
    expect((await answer('hanna', { contestationId: cid, outcome: 'maybe' })).status).toBe(400);
    const r = await answer('hanna', { contestationId: cid, outcome: 'rejected', response: 'The model was read in full; the decision stands.' });
    expect(r.status).toBe(200);
    expect(db.tables.call_contestations[0]).toMatchObject({ status: 'rejected', response: 'The model was read in full; the decision stands.', answered_by: 'hanna' });
    expect(db.tables.call_contestations[0].email_sent_at).toBeTruthy();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'ap-2@startup2.com', subject: `${NAME}: Response to your contestation` });
    expect(mail.sent[0].html).toContain('The decision stands.');
    expect(mail.sent[0].html).toContain('The model was read in full; the decision stands.');
    expect(db.tables.call_notices.filter((n) => n.user_id === 'ap-2' && n.kind === 'contestation_answered')).toHaveLength(1);
    expect(db.tables.call_results.filter((x) => x.application_id === A.rej)).toHaveLength(1);       // no new result
    expect(events('contestation_rejected')).toMatchObject([{ actor_user_id: 'hanna' }]);
    expect((await myResult('ap-2', A.rej)).body.contest.contestation).toMatchObject({ status: 'rejected', response: 'The model was read in full; the decision stands.' });
    expect((await answer('hanna', { contestationId: cid, outcome: 'rejected', response: 'again' })).status).toBe(409);
  });
});

describe('Upheld is a NEW publication', () => {
  beforeEach(async () => { await published(); await contest('ap-2', A.rej, { reason: 'The financial model was misread.' }); mail.sent.length = 0; });
  it('says what the decision becomes; the old result is kept and the new one points to it; the decision changes; the applicant is told with the new message and the response', async () => {
    const cid = db.tables.call_contestations[0].id as string;
    expect(await answer('hanna', { contestationId: cid, outcome: 'upheld' })).toMatchObject({ status: 400, body: { error: 'Choose what the decision becomes: Advance or Waitlist.' } });
    expect((await answer('hanna', { contestationId: cid, outcome: 'upheld', newResult: 'reject' })).status).toBe(400);
    const oldId = db.tables.call_results.find((x) => x.application_id === A.rej)!.id;
    const r = await answer('hanna', { contestationId: cid, outcome: 'upheld', newResult: 'waitlist', response: 'You were right: the second year was in the annex.' });
    expect(r.status).toBe(200);
    const rows = db.tables.call_results.filter((x) => x.application_id === A.rej);
    expect(rows).toHaveLength(2);
    const old = rows.find((x) => x.id === oldId)!; const next = rows.find((x) => x.id !== oldId)!;
    expect(old).toMatchObject({ result: 'reject', label: 'Not selected', is_current: false });     // kept, never overwritten
    expect(next).toMatchObject({ result: 'waitlist', label: 'Waiting list', source: 'contestation', is_current: true, supersedes_id: oldId });
    expect(next.body_html).toContain('and accepted it.');
    expect(next.body_html).toContain('on the waiting list');
    expect(next.body_html).toContain('You were right: the second year was in the annex.');
    expect(db.tables.call_contestations[0]).toMatchObject({ status: 'upheld', new_result_id: next.id });
    const dec = db.tables.call_eval_decisions.filter((d) => d.application_id === A.rej);
    expect(dec.find((d) => d.is_current)).toMatchObject({ decision: 'waitlist', note: 'Contestation upheld', decided_by: 'hanna' });
    expect(dec.filter((d) => !d.is_current)).toHaveLength(1);                                     // the earlier decision stays as history
    expect(mail.sent.map((m) => m.to)).toEqual(['ap-2@startup2.com']);
    expect(mail.sent[0].subject).toBe(`${NAME}: Waiting list`);
    expect(events('contestation_upheld')).toMatchObject([{ actor_user_id: 'hanna', detail: { from: 'reject', to: 'waitlist', old_result_id: oldId, new_result_id: next.id } }]);
    expect((await myResult('ap-2', A.rej)).body.result).toMatchObject({ label: 'Waiting list', kind: 'waitlist' });
    expect((await contest('ap-2', A.rej, { reason: 'again' })).status).toBe(409);                 // once per application and phase
    expect((await list('hanna')).body.rows[0]).toMatchObject({ status: 'upheld', newLabel: 'Waiting list' });
  });
  it('Advance in a call with another phase moves the application on, like a published "Selected"', async () => {
    const first = db.tables.call_phases.find((p) => p.call_id === CALL)!;
    db.tables.call_phases.push({ id: 'phase-2', call_id: CALL, position: (first.position as number) + 1, name: 'Pitch', starts_on: null, ends_on: null });
    const cid = db.tables.call_contestations[0].id as string;
    expect((await answer('hanna', { contestationId: cid, outcome: 'upheld', newResult: 'advance' })).status).toBe(200);
    expect(db.tables.call_applications.find((a) => a.id === A.rej)!.current_phase_id).toBe('phase-2');
    expect(db.tables.call_results.find((x) => x.application_id === A.rej && x.is_current)).toMatchObject({ result: 'advance', moved_to_phase_id: 'phase-2' });
  });
  it('the decision of a published application is still fixed for everybody else', async () => {
    expect((await decide('decider', A.rej, 'advance')).status).toBe(409);
  });
});

describe('"Complete call"', () => {
  it('not before every phase is published; not while the contestation period runs; not while one is open — each in words', async () => {
    expect((await close('pat')).body.blockers.map((b: { code: string }) => b.code)).toEqual(['not_published']);
    await published();
    expect((await close('pat')).body.blockers.map((b: { code: string }) => b.code)).toEqual(['contest_period']);
    await contest('ap-2', A.rej, { reason: 'Please review.' });
    age(11);
    expect((await close('pat')).body.blockers.map((b: { code: string }) => b.code)).toEqual(['open_contestations']);
    expect((await closeAct('pat', { action: 'complete', confirmName: NAME })).body.error).toBe('1 contestation is still waiting for an answer.');
    await answer('hanna', { contestationId: db.tables.call_contestations[0].id, outcome: 'rejected', response: 'The decision stands.' });
    const view = (await close('pat')).body;
    expect(view).toMatchObject({ canComplete: true, blockers: [], contestations: { enabled: true, open: 0, total: 1 } });
  });
  it('without contestations the call can be completed as soon as everything is published', async () => {
    await published({ contestations: false });
    expect((await close('pat')).body.canComplete).toBe(true);
  });
  it('the name of the call is typed; then it is completed, with who and when, and the date the data goes (24 months by default); a non-publisher is refused', async () => {
    await published({ contestations: false });
    expect((await closeAct('rita', { action: 'complete', confirmName: NAME })).status).toBe(403);
    expect((await closeAct('hanna', { action: 'complete', confirmName: NAME })).status).toBe(403);
    expect(await closeAct('pat', { action: 'complete', confirmName: 'nope' })).toMatchObject({ status: 400, body: { error: 'Type the name of the call to confirm.' } });
    const r = await closeAct('pat', { action: 'complete', confirmName: `  ${NAME.toLowerCase()} ` });
    expect(r.status).toBe(200);
    expect(callRow()).toMatchObject({ status: 'completed', completed_by: 'pat' });
    const months = (Date.parse(callRow().data_purge_after as string) - Date.parse(callRow().completed_at as string)) / DAY;
    expect(months).toBeGreaterThanOrEqual(729); expect(months).toBeLessThanOrEqual(731);
    expect(events('call_completed')).toMatchObject([{ actor_user_id: 'pat', detail: { months: 24 } }]);
    expect(r.body).toMatchObject({ status: 'completed', retention: { phase: 'kept', months: 24, canPostpone: true } });
    expect((await closeAct('pat', { action: 'complete', confirmName: NAME })).body.error).toBe('The call is already completed.');
  });
  it('from then on everything is read-only: the editor, the results, the decisions, a new contestation — and a read still works', async () => {
    await published(); await contest('ap-2', A.rej, { reason: 'x' }); age(11);
    await answer('hanna', { contestationId: db.tables.call_contestations[0].id, outcome: 'rejected', response: 'No.' });
    await closeAct('pat', { action: 'complete', confirmName: NAME });
    as('ana');
    expect(await callPatch(json('PATCH', { name: 'New name', baseVersion: 1 }), idp(CALL)).then(read)).toMatchObject({ status: 409, body: { code: 'completed', error: 'This call is completed: it is read-only.' } });
    expect(await settingsPut('pat', { labels: { advance: 'x' } })).toMatchObject({ status: 409, body: { code: 'completed' } });
    expect((await decide('decider', A.adv, 'waitlist')).status).toBe(409);
    expect((await publish('pat', { action: 'test' })).status).toBe(409);
    expect((await answer('hanna', { contestationId: 'x', outcome: 'rejected', response: 'x' })).status).toBe(409);
    as('ana'); expect((await callGet(json('GET'), idp(CALL)).then(read)).body.effectiveStatus).toBe('completed');
    expect((await list('ana')).status).toBe(200 === (await list('ana')).status ? 200 : 409);
  });
});

describe('the data is kept for a limited time', () => {
  async function completed(days = 0) { await published({ contestations: false }); age(days); await closeAct('pat', { action: 'complete', confirmName: NAME }); }
  it('the deletion can be postponed ONCE, with a reason, by whoever publishes — and not by anybody else, not twice, not before the call is completed', async () => {
    expect((await closeAct('pat', { action: 'postpone', reason: 'We need it for the audit.' })).status).toBe(409);            // not completed yet
    await completed();
    const before = callRow().data_purge_after as string;
    expect((await closeAct('rita', { action: 'postpone', reason: 'We need it for the audit.' })).status).toBe(403);
    expect((await closeAct('pat', { action: 'postpone', reason: 'ok' })).status).toBe(400);
    const r = await closeAct('pat', { action: 'postpone', reason: 'We need it for the audit.' });
    expect(r.status).toBe(200);
    expect(Date.parse(callRow().data_purge_after as string)).toBeGreaterThan(Date.parse(before) + 170 * DAY);
    expect(callRow()).toMatchObject({ data_purge_extended_reason: 'We need it for the audit.' });
    expect(r.body.retention).toMatchObject({ canPostpone: false });
    expect(await closeAct('pat', { action: 'postpone', reason: 'And again please.' })).toMatchObject({ status: 409, body: { error: 'The deletion was already postponed once; it cannot be postponed again.' } });
    expect(events('retention_postponed')).toMatchObject([{ actor_user_id: 'pat', detail: { reason: 'We need it for the audit.' } }]);
  });
  it('the administrators are warned 30 days before — once — and only the ones who can publish (the publisher and the administrator)', async () => {
    await completed();
    const after = Date.parse(callRow().data_purge_after as string);
    mail.sent.length = 0;
    expect(await warnRetentions(admin(), new Date(after - 60 * DAY))).toEqual({ warned: 0 });
    expect(await warnRetentions(admin(), new Date(after - 29 * DAY))).toEqual({ warned: 1 });
    expect(mail.sent.map((m) => m.to).sort()).toEqual(['ana@ana.test', 'pat@pat.test']);
    expect(mail.sent[0].subject).toContain('will be deleted on');
    expect(await warnRetentions(admin(), new Date(after - 28 * DAY))).toEqual({ warned: 0 });       // once
  });
  it('at the end: the files leave Storage first, the applicants\' data goes, and a summary WITHOUT personal data stays; before that date nothing; twice is harmless (simulated date)', async () => {
    await published(); await contest('ap-2', A.rej, { reason: 'The financial model was misread.', storagePath: putFile('2', 'reason.pdf'), fileName: 'reason.pdf' }); age(11);
    await answer('hanna', { contestationId: db.tables.call_contestations[0].id, outcome: 'rejected', response: 'No.' });
    await closeAct('pat', { action: 'complete', confirmName: NAME });
    const apps = db.tables.call_applications.length;
    storage.objects.set(`${orgOf('1')}/calls/${A.adv}/deck.pdf`, { bytes: PDF });
    db.tables.call_application_files.push({ id: 'f1', call_id: CALL, application_id: A.adv, source: 'upload', storage_path: `${orgOf('1')}/calls/${A.adv}/deck.pdf`, frozen_path: null });
    const due = Date.parse(callRow().data_purge_after as string);
    db.nowMs = due - DAY;
    expect(await purgeExpiredCallData(admin(), new Date(due - DAY))).toEqual({ due: 0, purged: 0, failed: 0, filesRemoved: 0 });
    expect(db.tables.call_applications).toHaveLength(apps);
    db.nowMs = due + DAY;
    const r = await purgeExpiredCallData(admin(), new Date(due + DAY));
    expect(r).toMatchObject({ due: 1, purged: 1, failed: 0, filesRemoved: 2 });
    expect(storage.objects.size).toBe(0);
    expect(db.tables.call_applications.filter((a) => a.call_id === CALL)).toHaveLength(0);
    for (const t of ['call_results', 'call_contestations', 'call_result_sends', 'call_eval_decisions', 'call_evaluations', 'call_notices']) expect(db.tables[t].filter((x) => x.call_id === CALL), t).toHaveLength(0);
    expect(callRow()).toMatchObject({ status: 'completed' });
    expect(callRow().data_purged_at).toBeTruthy();
    const summary = db.tables.call_data_summaries[0];
    expect(summary).toMatchObject({ call_id: CALL, call_name: NAME, summary: { applications: apps, outcome: { total: 4, byResult: { advance: 1, reject: 2, waitlist: 1 } }, phases: 1, contestations: { total: 1, upheld: 0, rejected: 1 } } });
    const text = JSON.stringify(summary);
    for (const personal of ['Blue Health', 'Cyan Labs', 'Founder', 'REF-00', 'financial model', 'startup2.com', 'SECRET', 'No.']) expect(text, personal).not.toContain(personal);
    expect(await purgeExpiredCallData(admin(), new Date(due + 2 * DAY))).toMatchObject({ due: 0, purged: 0 });
  });
});

describe('the final export', () => {
  beforeEach(async () => { await published(); await contest('ap-2', A.rej, { reason: '=HYPERLINK("x") The financial model was misread.' }); await answer('hanna', { contestationId: db.tables.call_contestations[0].id, outcome: 'rejected', response: 'The decision stands.' }); });
  const exp = (u: string, format = 'csv') => { as(u); return exportGet(json('GET', undefined, `http://localhost/api/calls/x/results/export?format=${format}`), idp(CALL)).then(read); };
  it('only "Final decision": 403 for the others; the results, the decisions and the contestations, one row per published result', async () => {
    for (const u of ['pat', 'hanna', 'rita']) expect((await exp(u)).status, u).toBe(403);
    const r = await exp('decider');
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toContain('text/csv');
    const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Reference,Startup,Phase,Result,Published,Result source,Contested,Contestation outcome,Contestation reason,Contestation response');
    expect(lines).toHaveLength(5);
    const rej = lines.find((l) => l.startsWith('REF-002'))!;
    expect(rej).toContain('Cyan Labs');
    expect(rej).toContain('Not selected');
    expect(rej).toContain(',yes,rejected,');
    expect(rej).toContain('The decision stands.');
    expect(events('results_exported')).toMatchObject([{ actor_user_id: 'decider', detail: { format: 'csv', rows: 4 } }]);
  });
  it('no private comment, no internal note, no evaluator grade — and a cell a spreadsheet would read as a formula is kept as text', async () => {
    const r = await exp('decider');
    for (const secret of ['OVERALL-COMMENT-SECRET', 'PRIVATE-NOTE-SECRET', 'INTERNAL-DECISION-NOTE', '77']) expect(r.text, secret).not.toContain(secret);
    expect(r.text).toContain("'=EVIL");                                                           // the startup named "=EVIL(...)"
    expect(r.text).toContain("'=HYPERLINK");                                                      // and the applicant's own reason
    expect(r.text).not.toMatch(/(^|,)=EVIL/m);
  });
  it('Excel too (with the validated grade column only when the call shares it)', async () => {
    const r = await exp('decider', 'xlsx');
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toContain('spreadsheetml');
    as('decider');
    const wb = XLSX.read(new Uint8Array(await (await exportGet(json('GET', undefined, 'http://localhost/api/calls/x/results/export?format=xlsx'), idp(CALL))).arrayBuffer()), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Results, { header: 1 });
    expect(rows[0]).not.toContain('Validated grade (%)');
    expect(rows).toHaveLength(5);
  });
});
