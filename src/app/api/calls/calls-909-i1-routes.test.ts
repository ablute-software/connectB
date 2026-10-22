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
import { GET as oneGet } from './[id]/route';
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

// Deleting a call (Prompt 909 I1: only before opening and with nobody applied; Prompt 918 Adenda 1 A: the true message) was REPLACED by Prompt 918 Adenda 2 C: in any state, with a confirmation, 30 days to
// restore, then removed for good. Its tests are in calls-918-adenda2-delete-routes.test.ts.

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
