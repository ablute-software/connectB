// Prompt 909, I1 — deleting and archiving a call, through the real handlers and the real access rules over the
// stateful fake database (which models delete_call_if_empty: the refusals, the record that survives, the cascade).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';

let db: CallsDb;
let currentUser: { id: string; email: string } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));

import { GET as listGet, POST as createPost } from './route';
import { POST as actionPost } from './[id]/action/route';
import { GET as publicGet } from './public/[token]/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json() });
const as = (userId: string) => { currentUser = { id: userId, email: `${userId}@example.com` }; };
function member(userId: string, role: string) {
  db.users.set(userId, { id: userId, email: `${userId}@example.com` });
  db.tables.matchdeal_investor_members.push({ id: `m-${userId}`, user_id: userId, catalog_entity_id: FIRM, status: 'active', role, created_at: '2026-01-01T00:00:00.000Z' });
}
async function newCall(name = 'Seed Call') {
  as('ana');
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name })));
  expect(created.status).toBe(200);
  return created.body.call as { id: string };
}
const row = (id: string) => db.tables.calls.find((c) => c.id === id)!;
const act = (id: string, action: string) => actionPost(json('POST', { action }), params(id)).then(read);
const application = (callId: string, status: string) =>
  db.tables.call_applications.push({ id: `a-${db.seq++}`, call_id: callId, status, applicant_user_id: `x-${db.seq}`, draft_answers: { secret: 'answer' } });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm' });
  member('ana', 'admin');
  member('bob', 'member');
  currentUser = null;
});

describe('Delete call', () => {
  it('deletes a draft nobody applied to: the call, its phases and its form go, and a record stays', async () => {
    const { id } = await newCall('Draft to delete');
    db.tables.call_form_fields.push({ id: 'f1', call_id: id, kind: 'short_text', label: 'Q', page: 1, position: 0 });
    expect(db.tables.call_phases.some((p) => p.call_id === id)).toBe(true);
    expect(db.tables.call_events.some((e) => e.call_id === id)).toBe(true);

    const res = await act(id, 'delete');
    expect(res).toMatchObject({ status: 200, body: { ok: true, deleted: true, name: 'Draft to delete' } });
    expect(db.tables.calls).toHaveLength(0);
    for (const t of ['call_phases', 'call_form_fields', 'call_events', 'call_config_snapshots']) expect(db.tables[t].filter((r) => r.call_id === id), t).toEqual([]);
    expect(db.tables.call_deletions).toMatchObject([{
      call_id: id, call_name: 'Draft to delete', promoter_kind: 'catalog_entity', promoter_id: FIRM, promoter_name: 'zz-test-firm',
      status_at_deletion: 'draft', deleted_by: 'ana',
    }]);
    expect(db.tables.call_deletions[0].deleted_at).toBeTruthy();
  });

  it('the record survives: it cannot be changed or removed afterwards', async () => {
    const { id } = await newCall();
    await act(id, 'delete');
    const admin = fakeCallsAdmin(db);
    expect((await admin.from('call_deletions').update({ call_name: 'x' }).eq('call_id', id)).error).toBeTruthy();
    expect((await admin.from('call_deletions').delete().eq('call_id', id)).error).toBeTruthy();
    expect(db.tables.call_deletions).toHaveLength(1);
  });

  it('is allowed for a confirmed and for a scheduled call that nobody applied to, and the record says which', async () => {
    const a = await newCall('Confirmed'); row(a.id).status = 'validated';
    const b = await newCall('Scheduled'); Object.assign(row(b.id), { status: 'scheduled', opens_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), closes_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), link_token: 'tok-scheduled-0123456789' });
    expect((await act(a.id, 'delete')).status).toBe(200);
    expect((await act(b.id, 'delete')).status).toBe(200);
    expect(db.tables.call_deletions.map((d) => d.status_at_deletion).sort()).toEqual(['scheduled', 'validated']);
  });

  it('the link stops working once the call is deleted', async () => {
    const { id } = await newCall();
    Object.assign(row(id), { status: 'scheduled', opens_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), closes_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), link_token: 'tok-gone-0123456789abcd' });
    expect((await publicGet(json('GET'), { params: { token: 'tok-gone-0123456789abcd' } })).status).toBe(200);
    await act(id, 'delete');
    expect((await publicGet(json('GET'), { params: { token: 'tok-gone-0123456789abcd' } })).status).toBe(404);
  });

  it('is refused with an application in progress, a submitted one or a withdrawn one: the call and the answers stay', async () => {
    for (const status of ['draft', 'submitted', 'withdrawn']) {
      const { id } = await newCall(`With ${status}`);
      application(id, status);
      const res = await act(id, 'delete');
      expect(res.status, status).toBe(409);
      expect(res.body.error).toContain('has applications');
      expect(row(id)).toBeTruthy();
    }
    expect(db.tables.call_applications).toHaveLength(3);
    expect(db.tables.call_deletions).toEqual([]);
  });

  it('is refused once the call has opened (any state from open on), and says to archive it', async () => {
    for (const status of ['open', 'closed', 'evaluating', 'results_published', 'archived']) {
      const { id } = await newCall(`Call ${status}`);
      Object.assign(row(id), { status, closes_at: status === 'open' ? new Date(Date.now() + 5 * 86_400_000).toISOString() : null });
      const res = await act(id, 'delete');
      expect(res.status, status).toBe(409);
      expect(res.body.error).toContain('archive');
    }
    expect(db.tables.calls).toHaveLength(5);
    expect(db.tables.call_deletions).toEqual([]);
  });

  it('a late application is stopped by the database itself, not only by the check before it', async () => {
    const { id } = await newCall();
    // The route read "no applications"; somebody applies before the delete runs.
    const admin = fakeCallsAdmin(db);
    application(id, 'draft');
    const { data } = await admin.rpc('delete_call_if_empty', { p_call: id, p_actor: 'ana', p_promoter_name: 'x' });
    expect(data).toMatchObject({ ok: false, reason: 'has_applications' });
    expect(row(id)).toBeTruthy();
  });

  it('a plain member, a stranger and a signed-out caller cannot delete', async () => {
    const { id } = await newCall();
    as('bob');
    expect((await act(id, 'delete')).status).toBe(403);
    db.users.set('zed', { id: 'zed', email: 'zed@example.com' });
    as('zed');
    expect((await act(id, 'delete')).status).toBe(403);
    currentUser = null;
    expect((await act(id, 'delete')).status).toBe(401);
    expect(db.tables.calls).toHaveLength(1);
  });
});

describe('Archive call', () => {
  it('archives a closed call with applications: it stays, with who and when, and an event', async () => {
    const { id } = await newCall('Edition 2025');
    Object.assign(row(id), { status: 'closed', closed_at: '2026-06-01T00:00:00Z' });
    application(id, 'submitted');
    const res = await act(id, 'archive');
    expect(res.status).toBe(200);
    expect(res.body.call).toMatchObject({ status: 'archived' });
    expect(row(id)).toMatchObject({ status: 'archived', archived_by: 'ana' });
    expect(row(id).archived_at).toBeTruthy();
    expect(db.tables.call_events.filter((e) => e.event === 'call_archived')).toMatchObject([{ actor_user_id: 'ana', detail: { from: 'closed' } }]);
    expect(db.tables.call_applications).toHaveLength(1);
  });

  it('an open call must be closed first; after closing it can be archived', async () => {
    const { id } = await newCall();
    Object.assign(row(id), { status: 'open', opens_at: '2026-01-01T00:00:00Z', closes_at: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    const refused = await act(id, 'archive');
    expect(refused).toMatchObject({ status: 409, body: { error: 'Close the call before archiving it.' } });
    expect((await act(id, 'close')).status).toBe(200);
    expect((await act(id, 'archive')).status).toBe(200);
  });

  it('an archived call is not archived twice, and its link is no longer advertised', async () => {
    const { id } = await newCall();
    Object.assign(row(id), { status: 'closed', link_token: 'tok-arch-0123456789abcdef' });
    expect((await act(id, 'archive')).status).toBe(200);
    expect((await act(id, 'archive')).status).toBe(409);
    expect((await publicGet(json('GET'), { params: { token: 'tok-arch-0123456789abcdef' } })).status).toBe(404);
  });

  it('the list still returns archived calls (with their state and the number of applications), for the filter to hide', async () => {
    const a = await newCall('Live'); const b = await newCall('Old');
    Object.assign(row(b.id), { status: 'closed' });
    application(b.id, 'submitted'); application(b.id, 'draft');
    await act(b.id, 'archive');
    as('ana');
    const list = await read(await listGet(new NextRequest('http://localhost/api/calls?kind=catalog_entity')));
    const byName = Object.fromEntries(list.body.calls.map((c: { name: string }) => [c.name, c]));
    expect(byName.Old).toMatchObject({ effectiveStatus: 'archived', applications: 1, applicationsTotal: 2 });
    expect(byName.Live).toMatchObject({ effectiveStatus: 'draft', applicationsTotal: 0 });
    expect(a.id).toBeTruthy();
  });

  it('a plain member cannot archive', async () => {
    const { id } = await newCall();
    Object.assign(row(id), { status: 'closed' });
    as('bob');
    expect((await act(id, 'archive')).status).toBe(403);
    expect(row(id).status).toBe('closed');
  });
});
