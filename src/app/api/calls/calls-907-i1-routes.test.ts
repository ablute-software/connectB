// Prompt 907, I1 — the call's link: the public header, the regulation PDF, and "who am I on this link" (registration box, startup
// step, or my application). The real handlers over the stateful fake database.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));

import { POST as createPost } from './route';
import { GET as publicGet } from './public/[token]/route';
import { GET as regulationGet } from './public/[token]/regulation/route';
import { GET as sessionGet } from './public/[token]/session/route';
import { PATCH as sourcePatch } from './[id]/source-documents/[docId]/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'tok-907-i1-0123456789abcd';
const DAY = 86_400_000;
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const tokenParams = (token = TOKEN) => ({ params: { token } });
const as = (userId: string | null) => { currentUser = userId ? { id: userId, email: `${userId}@example.com` } : null; };
function member(userId: string, role: string) {
  db.users.set(userId, { id: userId, email: `${userId}@example.com` });
  db.tables.matchdeal_investor_members.push({ id: `m-${userId}`, user_id: userId, catalog_entity_id: FIRM, status: 'active', role, created_at: '2026-01-01T00:00:00.000Z' });
}
async function newCall(name = 'Seed Call'): Promise<string> {
  as('ana');
  return (await read(await createPost(json('POST', { kind: 'catalog_entity', name })))).body.call.id as string;
}
const row = (id: string) => db.tables.calls.find((c) => c.id === id)!;
function addField(callId: string) {
  db.tables.call_form_fields.push({ id: `f-${db.seq++}`, call_id: callId, kind: 'short_text', label: 'Startup name', page: 1, position: 0, required: true });
}
/** An OPEN, published call with a form. */
async function openCall(name = 'Seed Call', over: Record<string, unknown> = {}): Promise<string> {
  const id = await newCall(name);
  Object.assign(row(id), { status: 'open', opens_at: new Date(Date.now() - DAY).toISOString(), closes_at: new Date(Date.now() + 5 * DAY).toISOString(), link_token: TOKEN, description: 'Funding for early-stage health startups.', ...over });
  addField(id);
  return id;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() };
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm' });
  member('ana', 'admin');
  as(null);
});

describe('the public header of a call', () => {
  it('shows what an applicant needs: who promotes it, name, deadline with its zone, summary — and nothing else', async () => {
    await openCall('Seed Call 2027');
    const res = await read(await publicGet(json('GET'), tokenParams()));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true, name: 'Seed Call 2027', promoter: 'zz-test-firm', description: 'Funding for early-stage health startups.',
      timezone: 'Europe/Lisbon', phase: 'open', message: null, eligibility: [], regulation: null, fieldCount: 1,
    });
    // Nothing of the team's side: no ids of the call, no creator, no link token, no team, no applications.
    const text = JSON.stringify(res.body);
    for (const leak of ['createdBy', 'created_by', 'linkToken', 'link_token', 'ana', 'team', 'applications', 'configVersion']) expect(text, leak).not.toContain(leak);
  });

  it('says so when applications are not open yet or are closed, with the date', async () => {
    const id = await openCall();
    Object.assign(row(id), { status: 'scheduled', opens_at: new Date(Date.now() + 3 * DAY).toISOString() });
    const scheduled = await read(await publicGet(json('GET'), tokenParams()));
    expect(scheduled.body).toMatchObject({ phase: 'scheduled' });
    expect(scheduled.body.message).toMatch(/^Opens on \d{2} \w{3} \d{4}$/);
    Object.assign(row(id), { status: 'open', opens_at: new Date(Date.now() - 9 * DAY).toISOString(), closes_at: new Date(Date.now() - DAY).toISOString() });
    const closed = await read(await publicGet(json('GET'), tokenParams()));
    expect(closed.body).toMatchObject({ phase: 'closed' });
    expect(closed.body.message).toMatch(/^Applications closed on \d{2} \w{3} \d{4}$/);
  });

  it('is a 404, like any dead link, for: no form, a draft, an archived call, an unknown or malformed token, and Calls switched off', async () => {
    const id = await newCall();
    Object.assign(row(id), { status: 'open', opens_at: new Date(Date.now() - DAY).toISOString(), closes_at: new Date(Date.now() + DAY).toISOString(), link_token: TOKEN });
    expect((await publicGet(json('GET'), tokenParams())).status, 'no form').toBe(404);
    addField(id);
    expect((await publicGet(json('GET'), tokenParams())).status).toBe(200);
    row(id).status = 'draft';
    expect((await publicGet(json('GET'), tokenParams())).status, 'draft').toBe(404);
    Object.assign(row(id), { status: 'archived', archived_at: new Date().toISOString() });
    expect((await publicGet(json('GET'), tokenParams())).status, 'archived').toBe(404);
    row(id).status = 'open';
    expect((await publicGet(json('GET'), tokenParams('short'))).status, 'malformed').toBe(404);
    expect((await publicGet(json('GET'), tokenParams('does-not-exist-0123456789'))).status, 'unknown').toBe(404);
    process.env.CALLS_MODE = 'off';
    expect((await publicGet(json('GET'), tokenParams())).status, 'CALLS_MODE=off').toBe(404);
  });
});

describe('the regulation PDF', () => {
  const doc = (callId: string, over: Record<string, unknown> = {}) => {
    const d = { id: `d-${db.seq++}`, call_id: callId, kind: 'regulation', file_name: 'regulation.pdf', mime_type: 'application/pdf', size_bytes: 10, storage_path: `calls/${callId}/reg.pdf`, uploaded_by: 'ana', public_to_applicants: false, ...over };
    db.tables.call_source_documents.push(d); storage.objects.set(d.storage_path as string, { bytes: new Uint8Array([37, 80, 68, 70]) });
    return d;
  };

  it('is offered only when the team marked a regulation PDF "show to applicants"', async () => {
    const id = await openCall();
    const d = doc(id);
    expect((await read(await publicGet(json('GET'), tokenParams()))).body.regulation, 'not public yet').toBeNull();
    expect((await regulationGet(json('GET'), tokenParams())).status).toBe(404);
    d.public_to_applicants = true;
    const withReg = await read(await publicGet(json('GET'), tokenParams()));
    expect(withReg.body.regulation).toEqual({ fileName: 'regulation.pdf', url: `/api/calls/public/${TOKEN}/regulation` });
    const dl = await regulationGet(json('GET'), tokenParams());
    expect(dl.status).toBe(302);
    expect(dl.headers.get('location')).toContain('https://storage.test/signed/');
    expect(dl.headers.get('location')).not.toContain('public_to_applicants');
  });

  it('never offers a document that is not a regulation PDF, even if the flag is set', async () => {
    const id = await openCall();
    doc(id, { kind: 'form', public_to_applicants: true });
    doc(id, { kind: 'regulation', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_name: 'r.docx', public_to_applicants: true });
    expect((await read(await publicGet(json('GET'), tokenParams()))).body.regulation).toBeNull();
    expect((await regulationGet(json('GET'), tokenParams())).status).toBe(404);
  });

  it('the team can show and hide it, only for a regulation PDF, one at a time, and it is in the history', async () => {
    const id = await openCall();
    const a = doc(id); const b = doc(id, { file_name: 'regulation-v2.pdf' }); const form = doc(id, { kind: 'form', file_name: 'old-form.pdf' });
    as('ana');
    const patch = (docId: string, v: unknown) => sourcePatch(json('PATCH', { publicToApplicants: v }), { params: { id, docId } }).then(read);
    expect((await patch(a.id as string, true)).status).toBe(200);
    expect(a.public_to_applicants).toBe(true);
    // The newest choice wins: only one regulation is public.
    expect((await patch(b.id as string, true)).status).toBe(200);
    expect([a.public_to_applicants, b.public_to_applicants]).toEqual([false, true]);
    expect((await patch(form.id as string, true)).status, 'a form is the team\'s own material').toBe(400);
    expect((await patch(a.id as string, 'yes')).status).toBe(400);
    expect((await patch('nope', true)).status).toBe(404);
    expect((await patch(b.id as string, false)).status).toBe(200);
    expect(b.public_to_applicants).toBe(false);
    expect(db.tables.call_events.filter((e) => e.call_id === id && String(e.event).startsWith('regulation_')).map((e) => e.event))
      .toEqual(['regulation_shown_to_applicants', 'regulation_shown_to_applicants', 'regulation_hidden_from_applicants']);
  });

  it('only someone who can configure the call may change it (a plain member, or another entity, cannot)', async () => {
    const id = await openCall();
    const d = doc(id);
    member('bob', 'member');
    as('bob');
    expect((await sourcePatch(json('PATCH', { publicToApplicants: true }), { params: { id, docId: d.id as string } })).status).toBe(403);
    as(null);
    expect((await sourcePatch(json('PATCH', { publicToApplicants: true }), { params: { id, docId: d.id as string } })).status).toBe(401);
    expect(d.public_to_applicants).toBe(false);
  });
});

describe('who am I on this link', () => {
  const org = (id: string, name: string) => db.tables.orgs.push({ id, name });
  const membership = (userId: string, orgId: string) => db.tables.org_members.push({ org_id: orgId, user_id: userId, role: 'owner' });

  it('a person who is not signed in gets "not authenticated" (a 200, not a redirect) and nothing about any account', async () => {
    await openCall();
    as(null);
    const res = await read(await sessionGet(json('GET'), tokenParams()));
    expect(res).toEqual({ status: 200, body: { ok: true, authenticated: false, hasStartup: false } });
  });

  it('a signed-in account with no startup (an investor\'s) is sent to the startup step', async () => {
    await openCall();
    as('investor-1');
    const res = await read(await sessionGet(json('GET'), tokenParams()));
    expect(res.body).toMatchObject({ ok: true, authenticated: true, hasStartup: false });
    expect(res.body.application).toBeUndefined();
  });

  it('a signed-in startup with a draft is told where to continue; another startup\'s application is never visible', async () => {
    const id = await openCall();
    org('org-a', 'Acme'); org('org-b', 'Other Co'); membership('founder-a', 'org-a'); membership('founder-b', 'org-b');
    db.tables.call_applications.push(
      { id: 'app-a', call_id: id, startup_org_id: 'org-a', applicant_user_id: 'founder-a', status: 'draft', reference: 'REF-A', last_page: 2, updated_at: '2026-10-10T10:00:00Z' },
      { id: 'app-b', call_id: id, startup_org_id: 'org-b', applicant_user_id: 'founder-b', status: 'submitted', reference: 'REF-B', updated_at: '2026-10-10T10:00:00Z' },
      { id: 'app-a-old', call_id: id, startup_org_id: 'org-a', applicant_user_id: 'founder-a', status: 'withdrawn', reference: 'REF-W', updated_at: '2026-10-09T10:00:00Z' },
    );
    as('founder-a');
    const a = await read(await sessionGet(json('GET'), tokenParams()));
    expect(a.body).toMatchObject({ authenticated: true, hasStartup: true, startupName: 'Acme', application: { id: 'app-a', status: 'draft', reference: 'REF-A', lastPage: 2 }, submittedCount: 0 });
    expect(JSON.stringify(a.body)).not.toContain('REF-B');
    as('founder-b');
    const b = await read(await sessionGet(json('GET'), tokenParams()));
    expect(b.body).toMatchObject({ startupName: 'Other Co', application: { id: 'app-b', status: 'submitted' }, submittedCount: 1 });
  });

  it('answers 404 for a link that does not work, signed in or not', async () => {
    as('founder-a');
    expect((await sessionGet(json('GET'), tokenParams('does-not-exist-0123456789'))).status).toBe(404);
  });
});
