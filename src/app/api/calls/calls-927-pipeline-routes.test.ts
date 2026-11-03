// Prompt 927 (A) — "Add applicants to my pipeline": the applications submitted BEFORE applicants were told about the deal flow are brought into the pipeline of the administrator who asks, for themselves only; a person
// without "Configure call" cannot; an incubator call has no pipeline; asking twice adds nothing twice.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb } from '@/test/fake-calls-db';
import { loadCallPipelineSource } from '@/lib/calls/call-pipeline';

let db: CallsDb;
let currentUser: { id: string; email: string } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({ authEnabled: true, serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }) }));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));

import { POST as createPost } from './route';
import { GET as offerGet, POST as offerPost } from './[id]/pipeline/route';

const FIRM = '11111111-1111-4111-8111-111111111111';
const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json() });
const as = (id: string) => { currentUser = { id, email: `${id}@example.com` }; };
const S = (n: number) => `5${n}000000-0000-4000-8000-00000000000${n}`;

async function newCall(): Promise<string> {
  as('ana');
  const created = await read(await createPost(json('POST', { kind: 'catalog_entity', name: 'Seed Call' })));
  expect(created.status).toBe(200);
  return created.body.call.id as string;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  process.env.CALLS_MODE = 'on';
  db = callsDb();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm' });
  for (const [u, role] of [['ana', 'admin'], ['bob', 'member']]) {
    db.users.set(u, { id: u, email: `${u}@example.com` });
    db.tables.matchdeal_investor_members.push({ id: `m-${u}`, user_id: u, catalog_entity_id: FIRM, status: 'active', role });
  }
  currentUser = null;
});

describe('Add applicants to my pipeline', () => {
  it('offers the applications that predate the notice, adds them to the asking administrator only, and asking again adds nothing twice', async () => {
    const id = await newCall();
    const app = (n: number, extra: Record<string, unknown> = {}) => db.tables.call_applications.push({ id: `app-${n}`, call_id: id, startup_org_id: S(n), status: 'submitted', pipeline_notice_at: null, ...extra });
    app(1); app(2); app(3, { pipeline_notice_at: '2026-11-03T10:00:00Z' }); app(4, { status: 'draft' });
    as('ana');
    expect((await read(await offerGet(json('GET'), params(id)))).body).toMatchObject({ ok: true, available: true, older: 2, done: false });
    const first = await read(await offerPost(json('POST'), params(id)));
    expect(first).toMatchObject({ status: 200, body: { ok: true, added: 2, done: true } });
    expect(db.tables.call_pipeline_backfills).toHaveLength(1);
    const again = await read(await offerPost(json('POST'), params(id)));
    expect(again.body).toMatchObject({ ok: true, added: 0, done: true });
    expect(db.tables.call_pipeline_backfills).toHaveLength(1);
    expect(db.tables.call_events.filter((e) => e.event === 'pipeline_backfill')).toHaveLength(1);        // recorded once
    // What it did: the older ones are now in Ana's pipeline (and the draft never is) ...
    const anas = await loadCallPipelineSource(fakeCallsAdmin(db), 'ana', FIRM);
    expect([...anas.byOrg.keys()].sort()).toEqual([S(1), S(2), S(3)]);
    // ... and not in anybody else's.
    expect((await loadCallPipelineSource(fakeCallsAdmin(db), 'bob', FIRM)).byOrg.size).toBe(0);
  });

  it('whoever may not configure the call cannot; an incubator call has no pipeline to add to', async () => {
    const id = await newCall();
    as('bob');
    expect((await offerPost(json('POST'), params(id))).status).toBe(403);
    expect((await offerGet(json('GET'), params(id))).status).toBe(403);
    expect(db.tables.call_pipeline_backfills).toHaveLength(0);
    as('ana');
    db.tables.calls.find((c) => c.id === id)!.promoter_kind = 'incubator';
    expect((await offerGet(json('GET'), params(id))).status).not.toBe(200);                       // not even reachable for the firm member: it is not the firm call any more
    expect((await offerPost(json('POST'), params(id))).status).not.toBe(200);
    expect(db.tables.call_pipeline_backfills).toHaveLength(0);
  });
});
