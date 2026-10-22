// Prompt 918, Adenda 2 (C) — deleting a call, through the real handlers over the stateful fake database (which models soft_delete_call / restore_call / purge_deleted_call): in any state, after the
// name is typed, to "Deleted calls" for 30 days, restorable, then removed for good with its files; an open call is closed at once; the link says it is gone; the applicants are told and can still
// read and download what they submitted; only whoever may configure the call can do it; and the number on the screen is the number the server says.
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
  sendTransactionalEmail: async (o: { to: string; subject: string; text?: string; html?: string }) => { emails.push({ to: o.to, subject: o.subject, text: o.text, html: o.html }); return { sent: true }; },
}));

import { GET as listGet, POST as createPost } from './route';
import { POST as actionPost } from './[id]/action/route';
import { GET as oneGet } from './[id]/route';
import { GET as impactGet } from './[id]/delete-impact/route';
import { POST as restorePost } from './[id]/restore/route';
import { GET as publicGet } from './public/[token]/route';
import { GET as applicationGet, PUT as applicationPut } from './apply/applications/[id]/route';
import { GET as downloadGet } from './apply/applications/[id]/files/[fileId]/download/route';
import { GET as overviewGet } from './apply/overview/route';
import { purgeDeletedCalls } from '@/lib/calls/purge';
import { CONFIRM_NAME_ERROR, impactLines } from '@/lib/calls/deletion';

const FIRM = '11111111-1111-4111-8111-111111111111';
const STARTUP = '33333333-3333-4333-8333-333333333333';
const DAY = 86_400_000;
const TOKEN = 'tok-del-0123456789abcdef';
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
const del = (id: string, confirmName?: string) => actionPost(json('POST', { action: 'delete', ...(confirmName === undefined ? {} : { confirmName }) }), params(id)).then(read);
const publish = (id: string, over: Record<string, unknown> = {}) => {
  Object.assign(row(id), { status: 'open', opens_at: new Date(Date.now() - DAY).toISOString(), closes_at: new Date(Date.now() + 30 * DAY).toISOString(), link_token: TOKEN, ...over });
  db.tables.call_form_fields.push({ id: `f-${id}`, call_id: id, kind: 'short_text', label: 'Q', page: 1, position: 0, required: false });
};
let nextApp = 1;
function application(callId: string, status: 'draft' | 'submitted' | 'withdrawn', user: string, over: Record<string, unknown> = {}) {
  db.users.set(user, { id: user, email: `${user}@startup.test` });
  const id = `00000000-0000-4000-8000-${String(nextApp++).padStart(12, '0')}`;
  db.tables.call_applications.push({ id, call_id: callId, status, startup_org_id: STARTUP, applicant_user_id: user, draft_answers: { secret: 'the secret answer' }, draft_revision: 0, reference: `REF-${nextApp}`, submitted_at: status === 'submitted' ? '2026-10-10T10:00:00Z' : null, ...over });
  return id;
}
const note = (user: string) => db.tables.call_notices.filter((n) => n.user_id === user && n.kind === 'call_cancelled');

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; emails.length = 0; nextApp = 1;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  db.tables.orgs.push({ id: STARTUP, name: 'Startup One', is_test: false });
  member('ana', 'admin'); member('bob', 'member');
  currentUser = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // streamStorageObject mints an internal address and fetches it; here that address answers with the bytes held by the fake storage.
  vi.stubGlobal('fetch', async (url: string) => {
    const path = decodeURIComponent(String(url).replace('https://storage.test/signed/', '').replace(/\?.*$/, ''));
    const o = storage.objects.get(path);
    return o ? new Response(Buffer.from(o.bytes), { status: 200, headers: { 'content-type': o.contentType ?? 'application/octet-stream' } }) : new Response('nope', { status: 404 });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('who may delete, and the name that has to be typed', () => {
  it('without the name, or with another one, nothing happens (409 confirm_name, the same sentence the dialog shows)', async () => {
    const { id } = await newCall('INNOV-ID');
    for (const typed of [undefined, '', 'INNOV', 'something else']) {
      const r = await del(id, typed);
      expect(r, String(typed)).toMatchObject({ status: 409, body: { ok: false, code: 'confirm_name', error: CONFIRM_NAME_ERROR } });
    }
    expect(row(id).deleted_at ?? null).toBeNull();
    expect(db.tables.call_deletions).toEqual([]);
  });

  it('spaces and capital letters do not matter when typing the name', async () => {
    const { id } = await newCall('INNOV-ID  2nd Call');
    expect((await del(id, '  innov-id 2ND call ')).status).toBe(200);
  });

  it('a plain member, a stranger and a signed-out caller cannot delete — nor restore', async () => {
    const { id } = await newCall();
    as('bob');
    expect((await del(id, 'INNOV-ID')).status).toBe(403);
    db.users.set('zed', { id: 'zed', email: 'zed@example.com' });
    as('zed');
    expect((await del(id, 'INNOV-ID')).status).toBe(403);
    as(null);
    expect((await del(id, 'INNOV-ID')).status).toBe(401);
    expect(row(id).deleted_at ?? null).toBeNull();
    as('ana'); await del(id, 'INNOV-ID');
    as('bob');
    expect((await restorePost(json('POST', {}), params(id))).status).toBe(403);
    expect(row(id).deleted_at).toBeTruthy();
  });
});

describe('deleting, in any state', () => {
  it('a draft: it goes to "Deleted calls" with 30 days; the editor and the list no longer see it; the record says who and when, with the numbers', async () => {
    const { id } = await newCall('A draft');
    const r = await del(id, 'A draft');
    expect(r).toMatchObject({ status: 200, body: { ok: true, deleted: true, name: 'A draft', notified: 0 } });
    expect(Date.parse(r.body.purgeAfter) - Date.now()).toBeGreaterThan(29.9 * DAY);
    expect(Date.parse(r.body.purgeAfter) - Date.now()).toBeLessThan(30.1 * DAY);
    expect(row(id)).toMatchObject({ deleted_by: 'ana' });                                       // nothing was removed yet
    expect((await oneGet(json('GET'), params(id))).status).toBe(404);                           // the editor: gone
    as('ana');
    const list = await read(await listGet(new NextRequest('http://localhost/api/calls?kind=catalog_entity')));
    expect(list.body.calls).toEqual([]);
    expect(list.body.deleted).toMatchObject([{ id, name: 'A draft', daysLeft: 30, canRestore: true }]);
    expect(db.tables.call_deletions).toMatchObject([{ call_id: id, call_name: 'A draft', event: 'soft_deleted', deleted_by: 'ana', counts: { submitted: 0, drafts: 0, files: 0 }, promoter_name: 'zz-test-firm' }]);
  });

  it('an archived call can be deleted too, and so can a closed one with submissions', async () => {
    const a = await newCall('Archived one'); Object.assign(row(a.id), { status: 'archived', archived_at: '2026-09-01T00:00:00Z' });
    const b = await newCall('Closed one'); Object.assign(row(b.id), { status: 'closed' }); application(b.id, 'submitted', 'u1');
    expect((await del(a.id, 'Archived one')).status).toBe(200);
    expect((await del(b.id, 'Closed one')).status).toBe(200);
    expect(db.tables.call_applications).toHaveLength(1);                                         // the application is still there for the 30 days
  });

  it('an OPEN call is closed at once, and its link says "no longer available" (410) — not "not found"', async () => {
    const { id } = await newCall('INNOV-ID');
    publish(id);
    expect((await publicGet(json('GET'), { params: { token: TOKEN } })).status).toBe(200);
    expect((await fakeCallsAdmin(db, storage).rpc('call_accepting', { p_call: id })).data).toBe(true);
    const r = await del(id, 'INNOV-ID');
    expect(r.status).toBe(200);
    expect(row(id).status).toBe('closed');
    expect(row(id).closed_at).toBeTruthy();
    expect((await fakeCallsAdmin(db, storage).rpc('call_accepting', { p_call: id })).data).toBe(false);
    const link = await read(await publicGet(json('GET'), { params: { token: TOKEN } }));
    expect(link).toMatchObject({ status: 410, body: { ok: false, gone: true } });
    expect((await publicGet(json('GET'), { params: { token: 'not-a-link-0123456789abcd' } })).status).toBe(404);   // a wrong link is still just not found
  });

  it('a call already deleted cannot be deleted again', async () => {
    const { id } = await newCall('Once');
    await del(id, 'Once');
    expect((await del(id, 'Once')).status).toBe(404);
  });
});

describe('what the dialog shows is what the server counts', () => {
  it('the numbers (never who): submitted, applicants with a draft, files — and whether the call is open', async () => {
    const { id } = await newCall('INNOV-ID'); publish(id);
    const s1 = application(id, 'submitted', 'u1'); application(id, 'submitted', 'u2'); application(id, 'withdrawn', 'u3'); application(id, 'draft', 'u4');
    for (const f of ['a', 'b', 'c']) db.tables.call_application_files.push({ id: `file-${f}`, application_id: s1, call_id: id, org_id: STARTUP, field_id: 'f', source: 'upload', file_name: `${f}.pdf`, size_bytes: 10, storage_path: `x/${f}.pdf`, created_by: 'u1' });
    as('ana');
    const r = await read(await impactGet(json('GET'), params(id)));
    expect(r.body).toEqual({ ok: true, name: 'INNOV-ID', isOpen: true, submitted: 3, drafts: 1, files: 3 });        // a withdrawn one was submitted
    expect(impactLines(r.body)).toEqual(['3 submitted applications', '1 applicant with a draft (not submitted yet)', '3 uploaded files']);
    const done = await del(id, 'INNOV-ID');
    expect(db.tables.call_deletions[0].counts).toEqual({ submitted: 3, drafts: 1, files: 3 });                       // the record says the same numbers
    expect(JSON.stringify(done.body)).not.toMatch(/u1|u4|startup\.test/);                                            // the entity is never told who
  });

  it('only whoever may configure the call can even ask', async () => {
    const { id } = await newCall();
    as('bob');
    expect((await impactGet(json('GET'), params(id))).status).toBe(403);
  });
});

describe('the applicants', () => {
  it('everyone with a draft or a submission is told, once, in the app and by email: «Entity» has cancelled the call «Title»…', async () => {
    const { id } = await newCall('INNOV-ID'); publish(id);
    application(id, 'draft', 'u1'); application(id, 'submitted', 'u2'); application(id, 'submitted', 'u2'); application(id, 'withdrawn', 'u3');
    const r = await del(id, 'INNOV-ID');
    expect(r.body.notified).toBe(2);                                                              // u2 once, however many applications; the withdrawn one is not told
    expect(note('u1')).toHaveLength(1); expect(note('u2')).toHaveLength(1); expect(note('u3')).toHaveLength(0);
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(r.body.purgeAfter));
    expect(note('u1')[0]).toMatchObject({ title: 'zz-test-firm has cancelled the call INNOV-ID', link_path: '/calls' });
    expect(note('u1')[0].body).toContain(`zz-test-firm has cancelled the call INNOV-ID. Your application will be deleted on ${day}.`);
    expect(note('u1')[0].body).toContain('download your files');
    expect(emails.map((e) => e.to).sort()).toEqual(['u1@startup.test', 'u2@startup.test']);
    expect(emails[0].subject).toBe('zz-test-firm has cancelled the call INNOV-ID');
    expect(emails[0].text).toContain('View my applications');
    expect(db.tables.call_events.filter((e) => e.event === 'call_cancelled_notified')).toMatchObject([{ detail: { applicants: 2 } }]);
  });

  it('for the 30 days they can still READ the application and download their files, but nothing can be saved on it', async () => {
    const { id } = await newCall('INNOV-ID'); publish(id);
    const draft = application(id, 'draft', 'u1');
    const done = application(id, 'submitted', 'u2');
    storage.objects.set('frozen/f1.pdf', { bytes: new Uint8Array([37, 80, 68, 70, 45, 49]), contentType: 'application/pdf' });
    db.tables.call_application_files.push({ id: 'f1', application_id: done, call_id: id, org_id: STARTUP, field_id: 'field', source: 'upload', file_name: 'plan.pdf', size_bytes: 6, storage_path: 'live/f1.pdf', frozen_path: 'frozen/f1.pdf', created_by: 'u2' });
    db.tables.org_members.push({ org_id: STARTUP, user_id: 'u1', role: 'owner' }, { org_id: STARTUP, user_id: 'u2', role: 'owner' });
    await del(id, 'INNOV-ID');

    as('u1');
    const read1 = await read(await applicationGet(json('GET'), params(draft)));
    expect(read1).toMatchObject({ status: 200, body: { ok: true, state: { canEdit: false, call: { name: 'INNOV-ID', deletedPurgeAfter: row(id).delete_purge_after } } } });
    const save = await read(await applicationPut(json('PUT', { answers: { x: 1 }, baseRevision: 0 }), params(draft)));
    expect(save).toMatchObject({ status: 410, body: { ok: false, code: 'call_deleted', error: 'This call is no longer available.' } });
    expect(db.tables.call_applications.find((a) => a.id === draft)!.draft_answers).toEqual({ secret: 'the secret answer' });   // untouched

    as('u2');
    const file = await downloadGet(json('GET'), { params: { id: done, fileId: 'f1' } });
    expect(file.status).toBe(200);
    expect(await file.arrayBuffer()).toEqual(new Uint8Array([37, 80, 68, 70, 45, 49]).buffer);                // the frozen copy, from the platform, no Storage address
    db.tables.orgs.push({ id: '44444444-4444-4444-8444-444444444444', name: 'Other Startup', is_test: false });
    db.tables.org_members.push({ org_id: '44444444-4444-4444-8444-444444444444', user_id: 'u9', role: 'owner' });
    as('u9');
    expect((await downloadGet(json('GET'), { params: { id: done, fileId: 'f1' } })).status).toBe(404);          // never another startup's application
  });

  it('in "My applications" the call is marked cancelled, with the day it goes; it is not advertised as an open call', async () => {
    const { id } = await newCall('INNOV-ID'); publish(id);
    application(id, 'submitted', 'u2'); application(id, 'draft', 'u1');
    db.tables.org_members.push({ org_id: STARTUP, user_id: 'u2', role: 'owner' });
    await del(id, 'INNOV-ID');
    as('u2');
    const o = await read(await overviewGet(json('GET')));
    expect(o.body.ok).toBe(true);
    expect(o.body.openCalls).toEqual([]);
    expect(o.body.mine).toHaveLength(2);
    expect(o.body.mine.every((m: { cancelledPurgeAfter?: string }) => m.cancelledPurgeAfter === row(id).delete_purge_after)).toBe(true);
    expect(o.body.mine.find((m: { applicationStatus: string }) => m.applicationStatus === 'submitted')).toBeTruthy();
  });
});

describe('restoring', () => {
  it('inside the 30 days it comes back as it was; a call that was open comes back CLOSED; its applications were never touched', async () => {
    const { id } = await newCall('INNOV-ID'); publish(id);
    application(id, 'submitted', 'u1'); application(id, 'draft', 'u2');
    await del(id, 'INNOV-ID');
    db.nowMs = Date.now() + 10 * DAY;
    as('ana');
    const r = await read(await restorePost(json('POST', {}), params(id)));
    expect(r).toMatchObject({ status: 200, body: { ok: true, restored: true, name: 'INNOV-ID', status: 'closed' } });
    expect(row(id)).toMatchObject({ status: 'closed', deleted_at: null, deleted_by: null, delete_purge_after: null });
    expect(db.tables.call_applications).toHaveLength(2);
    expect((await oneGet(json('GET'), params(id))).status).toBe(200);
    const list = await read(await listGet(new NextRequest('http://localhost/api/calls?kind=catalog_entity')));
    expect(list.body.calls.map((c: { name: string }) => c.name)).toEqual(['INNOV-ID']);
    expect(list.body.deleted).toEqual([]);
    expect(db.tables.call_deletions.map((d) => d.event)).toEqual(['soft_deleted', 'restored']);
    expect(db.tables.call_events.filter((e) => e.event === 'call_restored')).toHaveLength(1);
    expect((await restorePost(json('POST', {}), params(id))).status).toBe(409);                    // not deleted any more
  });

  it('after the 30 days it can no longer be restored', async () => {
    const { id } = await newCall('Late');
    await del(id, 'Late');
    db.nowMs = Date.now() + 31 * DAY;
    as('ana');
    const r = await read(await restorePost(json('POST', {}), params(id)));
    expect(r).toMatchObject({ status: 409, body: { ok: false, error: 'The 30 days to restore this call are over: it has been removed.' } });
    expect(row(id).deleted_at).toBeTruthy();
  });

  it('the days left are counted down in the list', async () => {
    const { id } = await newCall('Counting');
    await del(id, 'Counting');
    db.nowMs = undefined;
    as('ana');
    const list = await read(await listGet(new NextRequest('http://localhost/api/calls?kind=catalog_entity')));
    expect(list.body.deleted[0]).toMatchObject({ id, daysLeft: 30 });
  });
});

describe('removing for good, after the 30 days', () => {
  async function deletedWithEverything() {
    const { id } = await newCall('INNOV-ID'); publish(id);
    Object.assign(row(id), { cover_path: `calls/${id}/cover-aaaaaaaaaaaa.png`, logo_path: `calls/${id}/logo-bbbbbbbbbbbb.png` });
    db.tables.call_source_documents.push({ id: 'sd1', call_id: id, file_name: 'regulation.pdf', storage_path: `calls/${id}/source/regulation.pdf`, kind: 'regulation' });
    const sub = application(id, 'submitted', 'u1'); const draft = application(id, 'draft', 'u2');
    db.tables.call_application_submissions.push({ id: 's1', application_id: sub, version: 1, answers: { secret: 'the secret answer' }, documents: [], form_snapshot: {}, submitted_by: 'u1', submitted_at: '2026-10-10T10:00:00Z', idempotency_key: 'k' });
    db.tables.call_application_files.push(
      { id: 'up', application_id: sub, call_id: id, org_id: STARTUP, field_id: 'f', source: 'upload', file_name: 'plan.pdf', size_bytes: 1, storage_path: `${STARTUP}/calls/${sub}/plan.pdf`, frozen_path: `calls/${id}/frozen/plan.pdf`, created_by: 'u1' },
      { id: 'vt', application_id: sub, call_id: id, org_id: STARTUP, field_id: 'g', source: 'vault', file_name: 'deck.pdf', size_bytes: 1, storage_path: `${STARTUP}/vault/deck.pdf`, frozen_path: `calls/${id}/frozen/deck.pdf`, created_by: 'u1' },
      { id: 'dr', application_id: draft, call_id: id, org_id: STARTUP, field_id: 'f', source: 'upload', file_name: 'draft.pdf', size_bytes: 1, storage_path: `${STARTUP}/calls/${draft}/draft.pdf`, created_by: 'u2' },
    );
    for (const p of [`calls/${id}/cover-aaaaaaaaaaaa.png`, `calls/${id}/logo-bbbbbbbbbbbb.png`, `calls/${id}/source/regulation.pdf`, `${STARTUP}/calls/${sub}/plan.pdf`, `calls/${id}/frozen/plan.pdf`, `calls/${id}/frozen/deck.pdf`, `${STARTUP}/calls/${draft}/draft.pdf`, `${STARTUP}/vault/deck.pdf`]) {
      storage.objects.set(p, { bytes: new Uint8Array([1]), contentType: 'application/pdf' });
    }
    await del(id, 'INNOV-ID');
    return { id, sub, draft };
  }

  it('before the 30 days nothing is removed', async () => {
    const { id } = await deletedWithEverything();
    const out = await purgeDeletedCalls(fakeCallsAdmin(db, storage), new Date(Date.now() + 29 * DAY));
    expect(out).toMatchObject({ due: 0, purged: 0 });
    expect(row(id)).toBeTruthy();
    expect(storage.objects.size).toBe(8);
  });

  it('after the 30 days the call, its applications, drafts, submissions and files go — the Vault document stays — and only a minimal record remains', async () => {
    const { id } = await deletedWithEverything();
    db.nowMs = Date.now() + 31 * DAY;
    const out = await purgeDeletedCalls(fakeCallsAdmin(db, storage), new Date(Date.now() + 31 * DAY));
    expect(out).toEqual({ due: 1, purged: 1, failed: 0, filesRemoved: 7 });
    expect(db.tables.calls).toEqual([]);
    for (const t of ['call_applications', 'call_application_submissions', 'call_application_files', 'call_notices', 'call_events', 'call_phases', 'call_form_fields', 'call_source_documents']) expect(db.tables[t].filter((r) => r.call_id === id || r.application_id), t).toEqual([]);
    expect([...storage.objects.keys()]).toEqual([`${STARTUP}/vault/deck.pdf`]);                   // the startup's own Vault object is only ever referenced, never deleted
    expect(db.tables.call_deletions.map((d) => d.event)).toEqual(['soft_deleted', 'purged']);
    expect(db.tables.call_deletions[1]).toMatchObject({ call_id: id, call_name: 'INNOV-ID', counts: { submitted: 1, drafts: 1, files: 3 }, deleted_by: 'ana' });
    expect(JSON.stringify(db.tables.call_deletions)).not.toMatch(/secret|u1|u2|startup\.test/);   // no applicant's data in what stays
  });

  it('if Storage fails nothing is removed from the database: it is tried again the next day', async () => {
    const { id } = await deletedWithEverything();
    db.nowMs = Date.now() + 31 * DAY;
    const admin = fakeCallsAdmin(db, storage);
    (admin as unknown as { storage: unknown }).storage = { from: () => ({ remove: async () => ({ data: null, error: { message: 'storage is down' } }) }) };
    const out = await purgeDeletedCalls(admin, new Date(Date.now() + 31 * DAY));
    expect(out).toMatchObject({ due: 1, purged: 0, failed: 1 });
    expect(row(id)).toBeTruthy();
    expect(db.tables.call_applications).toHaveLength(2);
    // tomorrow, Storage is back
    expect(await purgeDeletedCalls(fakeCallsAdmin(db, storage), new Date(Date.now() + 31 * DAY))).toMatchObject({ purged: 1, failed: 0 });
  });

  it('a call that was restored is never purged', async () => {
    const { id } = await newCall('Back again');
    await del(id, 'Back again');
    as('ana'); await restorePost(json('POST', {}), params(id));
    db.nowMs = Date.now() + 40 * DAY;
    expect(await purgeDeletedCalls(fakeCallsAdmin(db, storage), new Date(Date.now() + 40 * DAY))).toMatchObject({ due: 0, purged: 0 });
    expect(row(id)).toBeTruthy();
  });
});
