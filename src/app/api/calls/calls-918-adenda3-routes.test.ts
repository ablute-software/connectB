// Prompt 918, Adenda 3 — through the real handlers over the stateful fake database:
//   1/2  "Reopen and extend" works for each way a call closes (deadline, early, deleted-and-restored), says the TRUE reason, and a restored call is reopenable;
//   3    a call closed before its deadline shows the day it closed (never the deadline still to come) on the public entry route;
//   5    restoring tells exactly the applicants who were told it was cancelled, and the "Cancelled" mark leaves "My applications";
//   6    whoever is on a call's team cannot start, save or submit an application to it (open or closed, even with a startup); another member of the same startup can.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at?: string } | null;
const emails: { to: string; subject: string; text?: string; html?: string }[] = [];

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
    rpc: async () => ({ data: false }),
    from: (t: string) => fakeCallsAdmin(db, storage).from(t),
  }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
vi.mock('@/lib/resend', async (orig) => ({
  ...(await orig<typeof import('@/lib/resend')>()),
  resendConfigured: true,
  sendTransactionalEmail: async (o: { to: string; subject: string; text?: string; html?: string }) => { emails.push({ to: o.to, subject: o.subject, text: o.text, html: o.html }); return { sent: true }; },
}));

import { POST as createPost } from './route';
import { POST as actionPost } from './[id]/action/route';
import { GET as oneGet } from './[id]/route';
import { POST as restorePost } from './[id]/restore/route';
import { GET as publicGet } from './public/[token]/route';
import { GET as sessionGet } from './public/[token]/session/route';
import { POST as startPost } from './apply/[token]/start/route';
import { GET as applicationGet, PUT as applicationPut } from './apply/applications/[id]/route';
import { POST as submitPost } from './apply/applications/[id]/submit/route';
import { GET as overviewGet } from './apply/overview/route';
import { ON_CALL_TEAM_CODE, ON_CALL_TEAM_MESSAGE } from '@/lib/calls/applicant/team-rule';
import { restoredNoticeText } from '@/lib/calls/deletion';

const FIRM = '11111111-1111-4111-8111-111111111111';
const STARTUP = '33333333-3333-4333-8333-333333333333';
const DAY = 86_400_000;
const TOKEN = 'tok-a3-0123456789abcdef';
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const as = (userId: string | null) => { currentUser = userId ? { id: userId, email: `${userId}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
function member(userId: string, role: string) {
  db.users.set(userId, { id: userId, email: `${userId}@example.com` });
  db.tables.matchdeal_investor_members.push({ id: `m-${userId}`, user_id: userId, catalog_entity_id: FIRM, status: 'active', role, created_at: '2026-01-01T00:00:00.000Z' });
}
async function newCall(name = 'INNOV-ID') {
  as('ana');
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name })));
  expect(created.status).toBe(200);
  return created.body.call as { id: string };
}
const row = (id: string) => db.tables.calls.find((c) => c.id === id)!;
const act = (id: string, body: Record<string, unknown>) => actionPost(json('POST', body), params(id)).then(read);
const publish = (id: string, over: Record<string, unknown> = {}) => {
  Object.assign(row(id), { status: 'open', opens_at: iso(-DAY), closes_at: iso(30 * DAY), link_token: TOKEN, ...over });
  db.tables.call_form_fields.push({ id: `f-${id}`, call_id: id, kind: 'short_text', label: 'Q', page: 1, position: 0, required: false, options: [], validations: {}, condition: null });
};
let nextApp = 1;
function application(callId: string, status: 'draft' | 'submitted', user: string, over: Record<string, unknown> = {}) {
  db.users.set(user, { id: user, email: `${user}@startup.test` });
  const id = `00000000-0000-4000-8000-${String(nextApp++).padStart(12, '0')}`;
  db.tables.call_applications.push({ id, call_id: callId, status, startup_org_id: STARTUP, applicant_user_id: user, draft_answers: {}, draft_revision: 0, reference: `REF-${nextApp}`, submitted_at: status === 'submitted' ? iso(-DAY) : null, unit_key: `org:${STARTUP}:${id}`, updated_at: iso(-DAY), ...over });
  return id;
}
const events = (callId: string, name: string) => db.tables.call_events.filter((e) => e.call_id === callId && e.event === name);
const notices = (user: string, kind: string) => db.tables.call_notices.filter((n) => n.user_id === user && n.kind === kind);

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; emails.length = 0; nextApp = 1;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  db.tables.orgs.push({ id: STARTUP, name: 'Startup One', is_test: false });
  member('ana', 'admin');
  currentUser = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('1 and 2 — reopen and extend, whichever way the call closed', () => {
  it('deleted while open, restored, then reopened: the button is there, no confirmation is asked, the status is open, the event is recorded and the drafts are told', async () => {
    const { id } = await newCall(); publish(id);
    application(id, 'draft', 'u1');
    expect((await act(id, { action: 'delete', confirmName: 'INNOV-ID' })).status).toBe(200);
    as('ana');
    expect((await restorePost(json('POST', {}), params(id))).status).toBe(200);
    expect(row(id).status).toBe('closed');

    const state = await read(await oneGet(json('GET'), params(id)));
    expect(state.body).toMatchObject({ effectiveStatus: 'closed', closedReason: 'restored', actions: { canReopen: true, reopenNeedsConfirm: false } });

    const newDeadline = iso(20 * DAY);
    const r = await act(id, { action: 'reopen', closesAt: newDeadline });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(row(id)).toMatchObject({ status: 'open', closed_at: null });
    expect(Date.parse(row(id).closes_at as string)).toBe(Date.parse(newDeadline));
    expect(events(id, 'call_reopened')).toHaveLength(1);
    expect(notices('u1', 'deadline_extended')).toHaveLength(1);
  });

  it('closed early: the reason is "early", and reopening asks for the explicit confirmation first', async () => {
    const { id } = await newCall(); publish(id);
    expect((await act(id, { action: 'close' })).status).toBe(200);
    const state = await read(await oneGet(json('GET'), params(id)));
    expect(state.body).toMatchObject({ closedReason: 'early', actions: { canReopen: true, reopenNeedsConfirm: true } });
    const asked = await act(id, { action: 'reopen', closesAt: iso(9 * DAY) });
    expect(asked).toMatchObject({ status: 409, body: { code: 'confirm_early' } });
    expect(row(id).status).toBe('closed');
    expect((await act(id, { action: 'reopen', closesAt: iso(9 * DAY), confirmEarly: true })).status).toBe(200);
    expect(row(id).status).toBe('open');
  });

  it('closed at its deadline: the reason is "deadline"', async () => {
    const { id } = await newCall(); publish(id, { closes_at: iso(-DAY) });
    const state = await read(await oneGet(json('GET'), params(id)));
    expect(state.body).toMatchObject({ effectiveStatus: 'closed', closedReason: 'deadline', actions: { canReopen: true, reopenNeedsConfirm: false } });
  });

  it('a restored call that was closed EARLY before being deleted comes back with the newest reason (restored), and still reopens', async () => {
    const { id } = await newCall(); publish(id);
    await act(id, { action: 'close' });
    await act(id, { action: 'delete', confirmName: 'INNOV-ID' });
    as('ana'); await restorePost(json('POST', {}), params(id));
    const state = await read(await oneGet(json('GET'), params(id)));
    expect(state.body.closedReason).toMatch(/early|restored/);
    expect((await act(id, { action: 'reopen', closesAt: iso(9 * DAY), confirmEarly: true })).status).toBe(200);
  });

  it('a past or missing date answers with a sentence the screen can show (and nothing changes)', async () => {
    const { id } = await newCall(); publish(id, { closes_at: iso(-DAY) });
    for (const bad of [iso(-DAY), '', 'next week']) {
      const r = await act(id, { action: 'reopen', closesAt: bad });
      expect(r.status, String(bad)).toBe(409);
      expect(typeof r.body.error).toBe('string');
      expect(r.body.error.length).toBeGreaterThan(5);
    }
    expect(Date.parse(row(id).closes_at as string)).toBeLessThan(Date.now());           // the deadline did not move
    expect(events(id, 'call_reopened')).toHaveLength(0);
  });
});

describe('3 — the entry page for a call closed before its deadline', () => {
  it('says the day it really closed, not the deadline still to come', async () => {
    const { id } = await newCall(); publish(id, { closes_at: iso(30 * DAY) });
    await act(id, { action: 'close' });
    const r = await read(await publicGet(json('GET'), { params: { token: TOKEN } }));
    expect(r.status).toBe(200);
    expect(r.body.phase).toBe('closed');
    expect(r.body.message).toMatch(/^Applications closed on /);
    expect(r.body.closedAt).toBeTruthy();
    expect(r.body.closedDay).toBeTruthy();
    expect(r.body.message).toContain(r.body.closedDay);
    expect(r.body.message).not.toContain(r.body.closesDay);
  });

  it('a call that closed at its deadline has no "closed early" date', async () => {
    const { id } = await newCall(); publish(id, { closes_at: iso(-DAY), closed_at: iso(-DAY) });
    const r = await read(await publicGet(json('GET'), { params: { token: TOKEN } }));
    expect(r.body).toMatchObject({ phase: 'closed', closedAt: null, closedDay: null });
  });
});

describe('5 — the restore notice', () => {
  it('goes exactly to the applicants who were told it was cancelled; their old notice is put away; "Cancelled" leaves My applications', async () => {
    const { id } = await newCall(); publish(id);
    application(id, 'submitted', 'u1'); application(id, 'draft', 'u2');
    db.tables.org_members.push({ org_id: STARTUP, user_id: 'u1', role: 'owner' });
    await act(id, { action: 'delete', confirmName: 'INNOV-ID' });
    expect(notices('u1', 'call_cancelled')).toHaveLength(1);
    expect(notices('u2', 'call_cancelled')).toHaveLength(1);
    db.users.set('stranger', { id: 'stranger', email: 'stranger@example.com' });

    as('u1');
    const during = await read(await overviewGet(json('GET')));
    expect(during.body.mine.every((m: { cancelledPurgeAfter?: string | null }) => !!m.cancelledPurgeAfter)).toBe(true);

    emails.length = 0;
    as('ana');
    const r = await read(await restorePost(json('POST', {}), params(id)));
    expect(r).toMatchObject({ status: 200, body: { restored: true, notified: 2 } });

    const text = restoredNoticeText('zz-test-firm', 'INNOV-ID');
    expect(text.body).toBe('zz-test-firm restored the call INNOV-ID. Your application is available again.');
    for (const u of ['u1', 'u2']) {
      const n = notices(u, 'call_restored');
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ call_id: id, title: text.title, body: text.body });
      expect(notices(u, 'call_cancelled').every((c) => !!c.seen_at)).toBe(true);
    }
    expect(notices('stranger', 'call_restored')).toHaveLength(0);
    expect(emails.map((e) => e.to).sort()).toEqual(['u1@startup.test', 'u2@startup.test']);
    expect(emails.every((e) => (e.text ?? '').includes('Your application is available again.'))).toBe(true);
    expect(events(id, 'call_restored_notified')[0].detail).toEqual({ applicants: 2 });

    as('u1');
    const after = await read(await overviewGet(json('GET')));
    expect(after.body.mine.length).toBeGreaterThan(0);
    expect(after.body.mine.every((m: { cancelledPurgeAfter?: string | null }) => !m.cancelledPurgeAfter)).toBe(true);
  });

  it('a call nobody applied to restores without telling anybody', async () => {
    const { id } = await newCall(); publish(id);
    await act(id, { action: 'delete', confirmName: 'INNOV-ID' });
    as('ana');
    const r = await read(await restorePost(json('POST', {}), params(id)));
    expect(r.body.notified).toBe(0);
    expect(db.tables.call_notices.filter((n) => n.kind === 'call_restored')).toHaveLength(0);
  });
});

describe('6 — whoever is on the call\'s team does not apply to it', () => {
  async function teamCall() {
    const { id } = await newCall(); publish(id);
    db.tables.call_team_categories.push({ id: 'cat-1', catalog_entity_id: FIRM, incubator_id: null, name: 'Reader', permissions: {} });
    db.tables.call_team_members.push({ id: 'tm-1', call_id: id, user_id: 'team-person', category_id: 'cat-1', permission_overrides: {} });
    db.users.set('team-person', { id: 'team-person', email: 'team-person@example.com' });
    // the team member is ALSO a member of a startup (a founder account)…
    db.tables.org_members.push({ org_id: STARTUP, user_id: 'team-person', role: 'owner' });
    // …and so is somebody else of the same startup, who is not on the team
    db.tables.org_members.push({ org_id: STARTUP, user_id: 'colleague', role: 'member' });
    db.users.set('colleague', { id: 'colleague', email: 'colleague@example.com' });
    return id;
  }

  it('cannot start an application, with the sentence the screen shows — open call', async () => {
    const id = await teamCall();
    as('team-person');
    const r = await read(await startPost(json('POST', {}), { params: { token: TOKEN } }));
    expect(r).toMatchObject({ status: 403, body: { ok: false, code: ON_CALL_TEAM_CODE, error: ON_CALL_TEAM_MESSAGE } });
    expect(db.tables.call_applications.filter((a) => a.call_id === id)).toHaveLength(0);
  });

  it('…nor on a closed call, nor with the call closed early', async () => {
    const id = await teamCall();
    await act(id, { action: 'close' }); as('team-person');
    expect((await startPost(json('POST', {}), { params: { token: TOKEN } })).status).toBe(403);
    row(id).closes_at = iso(-DAY); row(id).status = 'open';
    expect((await startPost(json('POST', {}), { params: { token: TOKEN } })).status).toBe(403);
  });

  it('cannot save or submit an application of theirs either (one started before they joined the team)', async () => {
    const id = await teamCall();
    const appId = application(id, 'draft', 'team-person');
    as('team-person');
    const put = await read(await applicationPut(json('PUT', { answers: { x: 'y' }, lastPage: 1, baseRevision: 0 }), params(appId)));
    expect(put).toMatchObject({ status: 403, body: { code: ON_CALL_TEAM_CODE } });
    const sub = await read(await submitPost(json('POST', { key: 'k-1', baseRevision: 0 }), params(appId)));
    expect(sub).toMatchObject({ status: 403, body: { code: ON_CALL_TEAM_CODE } });
    expect(db.tables.call_applications.find((a) => a.id === appId)).toMatchObject({ status: 'draft', draft_revision: 0 });
    expect((await applicationGet(json('GET'), params(appId))).status).toBe(200);           // reading what is already there stays possible
  });

  it('the startup is not blocked: another member of the same startup applies as usual', async () => {
    const id = await teamCall();
    as('colleague');
    const r = await read(await startPost(json('POST', {}), { params: { token: TOKEN } }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(db.tables.call_applications.filter((a) => a.call_id === id)).toHaveLength(1);
  });

  it('the session says onTeam for the team member, and not for the colleague', async () => {
    await teamCall();
    as('team-person');
    const t = await read(await sessionGet(json('GET'), { params: { token: TOKEN } }));
    expect(t.body).toMatchObject({ ok: true, authenticated: true, onTeam: true });
    expect(t.body.application).toBeUndefined();
    as('colleague');
    const c = await read(await sessionGet(json('GET'), { params: { token: TOKEN } }));
    expect(c.body).toMatchObject({ authenticated: true, hasStartup: true });
    expect(c.body.onTeam).toBeUndefined();
  });
});
