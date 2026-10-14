// Prompt 907, I4 — the startup's "Calls" area and the entity's read-only "Submissions": the real handlers over the stateful fake database.
// What this pins above all: the entity NEVER sees a draft (not its answers, not its startup, not even a count).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at: string | null } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));

import { GET as overviewGet } from './apply/overview/route';
import { GET as noticesGet, POST as noticesPost } from './apply/notices/route';
import { GET as listGet } from './[id]/submissions/route';
import { GET as detailGet } from './[id]/submissions/[applicationId]/route';
import { GET as docGet } from './[id]/submissions/[applicationId]/documents/[fileId]/route';
import { GET as stateGet } from './[id]/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const OTHER_FIRM = '33333333-3333-4333-8333-333333333333';
const CALL = '22222222-2222-4222-8222-222222222222';
const OTHER_CALL = '44444444-4444-4444-8444-444444444444';
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DAY = 86_400_000;
const FIELD = 'f0000000-0000-4000-8000-000000000001';
const DECK = 'f0000000-0000-4000-8000-000000000002';

const req = (url = 'http://localhost/api/calls') => new NextRequest(url, { method: 'GET' });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})), res });
const as = (userId: string | null) => { currentUser = userId ? { id: userId, email: `${userId}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function call(id: string, over: Record<string, unknown> = {}) {
  db.tables.calls.push({ id, promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, incubator_id: null, name: `Call ${id.slice(0, 4)}`, description: 'Summary', status: 'open', opens_at: iso(-2), closes_at: iso(5),
    timezone: 'Europe/Lisbon', visibility: 'listed', limit_unit: 'project', allow_multiple: false, currency: 'EUR', link_token: `tok-${id.slice(0, 4)}-0123456789abcd`, config_version: 1, created_by: 'owner', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over });
  db.tables.call_form_fields.push({ id: `${id.slice(0, 8)}-field`, call_id: id, kind: 'short_text', label: 'Q', page: 1, position: 0, required: false });
}
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() };
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false }, { id: OTHER_FIRM, name: 'Other Fund', is_test: false });
  db.tables.orgs.push({ id: ORG_A, name: 'Acme Robotics', is_test: false }, { id: ORG_B, name: 'Other Co', is_test: false });
  db.tables.org_members.push({ org_id: ORG_A, user_id: 'founder-a', role: 'owner' }, { org_id: ORG_B, user_id: 'founder-b', role: 'owner' });
  for (const [u, e] of [['ana', FIRM], ['zed', OTHER_FIRM]] as const) {
    db.users.set(u, { id: u, email: `${u}@example.com` });
    db.tables.matchdeal_investor_members.push({ id: `m-${u}`, user_id: u, catalog_entity_id: e, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' });
  }
  as('founder-a');
});

describe('the startup\'s Calls area', () => {
  it('lists the open calls, my applications and past applications — only this startup\'s own', async () => {
    call(CALL); call(OTHER_CALL, { catalog_entity_id: OTHER_FIRM, name: 'Other call' });
    db.tables.call_applications.push(
      { id: 'a-mine', call_id: CALL, startup_org_id: ORG_A, applicant_user_id: 'founder-a', status: 'draft', reference: 'APP-AAAA-1111', updated_at: iso(-1) },
      { id: 'a-theirs', call_id: CALL, startup_org_id: ORG_B, applicant_user_id: 'founder-b', status: 'submitted', reference: 'APP-BBBB-2222', updated_at: iso(-1), submitted_at: iso(-1) },
    );
    const r = await overviewGet(req());
    const { status, body } = await read(r);
    expect(status).toBe(200);
    expect(body.openCalls.map((c: { name: string; action: string }) => [c.name, c.action]).sort()).toEqual([['Call 2222', 'continue'], ['Other call', 'apply']]);
    expect(body.mine).toMatchObject([{ applicationId: 'a-mine', stage: 'in_progress', reference: 'APP-AAAA-1111' }]);
    expect(JSON.stringify(body)).not.toContain('APP-BBBB-2222'); // the other startup's application is nowhere
  });

  it('an unlisted ("closed — link only") call appears once this startup reached it by its link; a test organisation\'s call only to a test account', async () => {
    call(CALL, { visibility: 'unlisted' });
    expect((await read(await overviewGet(req()))).body.openCalls).toEqual([]);
    db.tables.call_link_access.push({ call_id: CALL, org_id: ORG_A, user_id: 'founder-a' });
    expect((await read(await overviewGet(req()))).body.openCalls.map((c: { linkOnly: boolean }) => c.linkOnly)).toEqual([true]);
    db.tables.calls.length = 0; db.tables.call_link_access.length = 0;
    call(CALL); db.tables.catalog_entities.find((e) => e.id === FIRM)!.is_test = true;
    expect((await read(await overviewGet(req()))).body.openCalls).toEqual([]);
    db.tables.orgs.find((o) => o.id === ORG_A)!.is_test = true;
    expect((await read(await overviewGet(req()))).body.openCalls).toHaveLength(1);
  });

  it('answers 401 when not signed in, 404 when Calls are switched off, and an empty area for an account with no startup', async () => {
    as(null);
    expect((await overviewGet(req())).status).toBe(401);
    as('investor-only');
    expect((await read(await overviewGet(req()))).body).toMatchObject({ ok: true, startup: false, openCalls: [] });
    process.env.CALLS_MODE = 'off';
    as('founder-a');
    expect((await overviewGet(req())).status).toBe(404);
  });

  it('notices: only my own, until I dismiss them; dismissing marks them seen and nobody else\'s', async () => {
    call(CALL);
    db.tables.call_notices.push(
      { id: 'n1', user_id: 'founder-a', call_id: CALL, kind: 'submission_received', title: 'Application received', body: 'b', link_path: '/call/x', created_at: iso(-1), seen_at: null, dedupe_key: 'k1' },
      { id: 'n2', user_id: 'founder-b', call_id: CALL, kind: 'draft_reminder', title: 'Not mine', body: 'b', link_path: null, created_at: iso(-1), seen_at: null, dedupe_key: 'k2' },
    );
    expect((await read(await noticesGet(req()))).body.notices.map((n: { id: string }) => n.id)).toEqual(['n1']);
    await noticesPost(new NextRequest('http://localhost/api/calls/apply/notices', { method: 'POST', body: JSON.stringify({ ids: ['n1', 'n2'] }), headers: { 'content-type': 'application/json' } }));
    expect(db.tables.call_notices.find((n) => n.id === 'n1')!.seen_at).toBeTruthy();
    expect(db.tables.call_notices.find((n) => n.id === 'n2')!.seen_at).toBeNull(); // someone else's: untouched
    expect((await read(await noticesGet(req()))).body.notices).toEqual([]);
  });
});

describe('the entity\'s Submissions (read-only)', () => {
  function submitted(appId: string, orgId: string, answers: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const sid = `sub-${appId}`;
    db.tables.call_applications.push({ id: appId, call_id: CALL, startup_org_id: orgId, applicant_user_id: 'x', status: 'submitted', reference: `REF-${appId}`, current_submission_id: sid, submitted_at: iso(-1), ...extra });
    db.tables.call_application_submissions.push({ id: sid, application_id: appId, version: 1, answers, documents: [{ fieldId: DECK, fileId: `file-${appId}`, source: 'upload', fileName: 'deck.pdf', size: 1000, sha256: 'x', frozenPath: `calls/${CALL}/applications/${appId}/frozen/file-${appId}.pdf`, documentId: null, versionId: null, versionNumber: null }],
      form_snapshot: { fields: [{ id: FIELD, page: 1, position: 0, kind: 'short_text', label: 'Startup name', required: true, options: [], validations: {}, condition: null }, { id: DECK, page: 1, position: 1, kind: 'file', label: 'Pitch deck', required: true, options: [], validations: {}, condition: null }] },
      submitted_by: 'x', submitted_at: iso(-1), idempotency_key: `k-${appId}` });
    storage.objects.set(`calls/${CALL}/applications/${appId}/frozen/file-${appId}.pdf`, { bytes: new Uint8Array([37, 80, 68, 70]) });
  }
  const ids = (a: string) => ({ params: { id: CALL, applicationId: a } });

  it('lists ONLY submitted applications — a draft is not there, nor its startup, nor its answers, nor even a count', async () => {
    call(CALL);
    submitted('s1', ORG_A, { [FIELD]: 'Acme Robotics' });
    db.tables.call_applications.push({ id: 'draft-1', call_id: CALL, startup_org_id: ORG_B, applicant_user_id: 'founder-b', status: 'draft', reference: 'REF-DRAFT', draft_answers: { [FIELD]: 'SECRET DRAFT ANSWER' }, updated_at: iso(-1) });
    as('ana');
    const list = await read(await listGet(req(), { params: { id: CALL } }));
    expect(list.status).toBe(200);
    expect(list.body.submissions).toMatchObject([{ applicationId: 's1', startup: 'Acme Robotics', reference: 'REF-s1' }]);
    const everything = JSON.stringify(list.body);
    for (const leak of ['REF-DRAFT', 'Other Co', 'SECRET DRAFT ANSWER', 'draft']) expect(everything, leak).not.toContain(leak);
    // The editor's own state tells the entity "something was submitted" and a total — never how many are still being filled in.
    const state = await read(await stateGet(req(), { params: { id: CALL } }));
    expect(state.body.applications).toEqual({ submitted: 1, total: 2 });
    expect(JSON.stringify(state.body)).not.toMatch(/inProgress|draft_answers|SECRET/);
  });

  it('a draft cannot be opened either: it is a 404, as if it did not exist', async () => {
    call(CALL);
    db.tables.call_applications.push({ id: 'draft-1', call_id: CALL, startup_org_id: ORG_B, applicant_user_id: 'founder-b', status: 'draft', draft_answers: { [FIELD]: 'SECRET DRAFT ANSWER' } });
    as('ana');
    expect((await detailGet(req(), ids('draft-1'))).status).toBe(404);
    expect((await docGet(req(), { params: { id: CALL, applicationId: 'draft-1', fileId: 'x' } })).status).toBe(404);
  });

  it('opens a submitted application as it was submitted: its answers, the form as it was, and the frozen documents', async () => {
    call(CALL);
    submitted('s1', ORG_A, { [FIELD]: 'Acme Robotics', [DECK]: { fileName: 'deck.pdf', size: 1000, fileId: 'file-s1' } });
    db.tables.call_applications.find((a) => a.id === 's1')!.draft_answers = { [FIELD]: 'EDITED LATER IN THE WORKING COPY' };
    as('ana');
    const d = await read(await detailGet(req(), ids('s1')));
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ startup: 'Acme Robotics', reference: 'REF-s1', version: 1, answers: { [FIELD]: 'Acme Robotics' } });
    expect(d.body.fields.map((f: { label: string }) => f.label)).toEqual(['Startup name', 'Pitch deck']);
    expect(JSON.stringify(d.body)).not.toContain('EDITED LATER');
    expect(d.body.documents).toMatchObject([{ fileName: 'deck.pdf', url: `/api/calls/${CALL}/submissions/s1/documents/file-s1` }]);
    const dl = await docGet(req(), { params: { id: CALL, applicationId: 's1', fileId: 'file-s1' } });
    expect(dl.status).toBe(302);
    expect(dl.headers.get('location')).toContain(`calls/${CALL}/applications/s1/frozen/file-s1.pdf`);
    expect((await docGet(req(), { params: { id: CALL, applicationId: 's1', fileId: 'not-a-document-of-this-version' } })).status).toBe(404);
  });

  it('another organisation\'s call is a 404; a member without "View all applications" gets a 403; nobody signed in a 401', async () => {
    call(CALL);
    submitted('s1', ORG_A, { [FIELD]: 'Acme' });
    as('zed'); // admin of ANOTHER firm
    expect((await listGet(req(), { params: { id: CALL } })).status).toBe(404);
    expect((await detailGet(req(), ids('s1'))).status).toBe(404);
    // A plain member of the firm, in a category that does not have the permission (the call has a team already).
    db.users.set('eve', { id: 'eve', email: 'eve@example.com' });
    db.tables.matchdeal_investor_members.push({ id: 'm-eve', user_id: 'eve', catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' });
    db.tables.call_team_categories.push({ id: 'cat-1', catalog_entity_id: FIRM, incubator_id: null, name: 'Reader', permissions: { view_all_applications: false } });
    db.tables.call_team_members.push({ id: 'tm-1', call_id: CALL, user_id: 'eve', category_id: 'cat-1', permission_overrides: {} });
    as('eve');
    expect(await read(await listGet(req(), { params: { id: CALL } }))).toMatchObject({ status: 403, body: { error: expect.stringContaining('View all applications') } });
    db.tables.call_team_members[0].permission_overrides = { view_all_applications: true }; // an individual adjustment gives it
    expect((await listGet(req(), { params: { id: CALL } })).status).toBe(200);
    as(null);
    expect((await listGet(req(), { params: { id: CALL } })).status).toBe(401);
  });
});
