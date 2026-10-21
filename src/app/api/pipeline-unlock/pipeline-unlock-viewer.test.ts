// Nuno, 20/10/2026: "I do not understand why Mob2is' pipeline is empty". In a Developer Viewer session the Pipeline said "Your profile is complete. Your next batch of
// investors arrives with your plan's monthly renewal" — about a founder who had THREE investors waiting for one click on "Unlock my pipeline". The cause: the route
// read the quota with catalog_effective_quota(), which answers for the CALLER and answers 0 to anyone who is not a member of the org — a developer in a viewer session —
// so `deliverable` was computed as 0 and the screen took the "quota spent, wait for the renewal" branch. A viewer session now reads what the founder's own page load
// would produce (the stored quota, raised to the target the floor would raise it to), read-only: it still writes nothing.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeDb, fakeSession, type FakeDb } from '@/test/fake-supabase';
import { VIEWER_ORG_COOKIE } from '@/lib/developer-viewer-shape';

const h = vi.hoisted(() => ({ session: null as unknown, admin: null as unknown, deliverableCalls: [] as { quota: number; delivered: number }[], floorCalls: [] as number[], target: 3 }));

vi.mock('@/lib/supabase-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  authEnabled: true,
  serverClient: async () => h.session,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }));
vi.mock('@/lib/pipeline-unlock-capability', () => ({ pipelineUnlockAnchorsAvailable: async () => true }));
vi.mock('@/lib/effective-plan-server', () => ({ effectivePlanForOrg: async () => 'idea' }));
vi.mock('@/lib/pipeline-unlock-server', () => ({
  computeVisiblePipelineSize: async () => ({ visible: 0, gateComplete: true, eligiblePoolSize: 40, catalogQuotaTarget: h.target }),
  computeDeliverable: async (_admin: unknown, _org: string, quota: number, delivered: number) => {
    h.deliverableCalls.push({ quota, delivered });
    return { deliverable: Math.max(0, quota - delivered), unlimited: false };
  },
  raiseCatalogQuotaFloor: async (_admin: unknown, _org: string, target: number) => { h.floorCalls.push(target); },
}));

import { GET } from './route';

const ORG_A = 'a0a0a0a0-0000-4000-8000-00000000000a'; // zz-test-A — the founder's org
const ORG_B = 'b0b0b0b0-0000-4000-8000-00000000000b'; // zz-test-B — the developer's own org
const FOUNDER = 'dddddddd-0000-4000-8000-0000000000a1';
const DEVELOPER = 'dddddddd-0000-4000-8000-00000000000b';
const ENTERED = '2026-10-20T10:00:00.000Z';

let db: FakeDb;
// who the (faked) catalog_effective_quota answers for — the RPC answers for its CALLER
let caller = '';
function world(over: { storedQuota?: number; delivered?: number } = {}): FakeDb {
  return fakeDb({
    orgs: [{ id: ORG_A, name: 'zz-test-A', plan: 'idea', catalog_quota: over.storedQuota ?? 3, profile_completed_at: '2026-10-14T00:00:00Z' }, { id: ORG_B, name: 'zz-test-B', plan: 'idea', catalog_quota: 0 }],
    org_members: [{ user_id: FOUNDER, org_id: ORG_A, role: 'owner' }, { user_id: DEVELOPER, org_id: ORG_B, role: 'admin' }],
    catalog_deliveries: Array.from({ length: over.delivered ?? 0 }, (_, i) => ({ org_id: ORG_A, catalog_id: `cat-${i}`, quota_exempt: false })),
  });
}
function actAs(user: string, isDeveloper = false) {
  h.session = fakeSession(db, { userId: user, isDeveloper, email: `${user}@example.test` });
  h.admin = fakeAdmin(db);
}
const call = (cookie?: string) => new NextRequest('https://example.test/api/pipeline-unlock', { headers: cookie ? { cookie } : {} });
const viewerCookie = `${VIEWER_ORG_COOKIE}=${ORG_A}:${ENTERED}`;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
  h.deliverableCalls = []; h.floorCalls = []; h.target = 3;
  db = world();
  // catalog_effective_quota answers for the CALLER: the founder gets the stored quota, a non-member (a developer in a viewer session) gets 0 — as in production
  db.rpc = { catalog_effective_quota: (args: unknown) => (h.session && (args as { check_org: string }).check_org === ORG_A && caller === FOUNDER ? 3 : 0) };
  db.writes = [];
  db.rpcCalls = [];
});


describe('GET /api/pipeline-unlock — what the Pipeline says about an empty pipeline', () => {
  it('the founder\'s own session: the quota comes from catalog_effective_quota, and the floor is raised as before', async () => {
    actAs(FOUNDER); caller = FOUNDER;
    const body = await (await GET(call())).json();
    expect(body).toMatchObject({ ok: true, gateComplete: true, deliverable: 3, quota: 3, delivered: 0 });
    expect(db.rpcCalls?.some((c) => c.name === 'catalog_effective_quota')).toBe(true);
    expect(h.floorCalls).toEqual([3]);
  });

  it('a Developer Viewer sees the SAME state the founder sees — three investors waiting — not "the next batch arrives with the monthly renewal"', async () => {
    actAs(DEVELOPER, true); caller = DEVELOPER;
    const body = await (await GET(call(viewerCookie))).json();
    expect(body).toMatchObject({ ok: true, gateComplete: true, deliverable: 3, quota: 3, delivered: 0 });
  });

  it('…without asking catalog_effective_quota (which would answer 0 for a non-member) and without writing: no quota raised, nothing stamped', async () => {
    actAs(DEVELOPER, true); caller = DEVELOPER;
    await GET(call(viewerCookie));
    expect(db.rpcCalls?.some((c) => c.name === 'catalog_effective_quota')).toBe(false);
    expect(h.floorCalls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it('the viewer reads the quota the founder\'s page load would CREATE: the stored one, raised to the target (the raise itself is skipped)', async () => {
    db = world({ storedQuota: 1 }); h.target = 3;
    actAs(DEVELOPER, true); caller = DEVELOPER; db.rpc = { catalog_effective_quota: () => 0 };
    const body = await (await GET(call(viewerCookie))).json();
    expect(h.deliverableCalls).toEqual([{ quota: 3, delivered: 0 }]);
    expect(body).toMatchObject({ deliverable: 3, quota: 3 });
    // a stored quota above the target stays as it is (the floor only ever raises)
    h.deliverableCalls = [];
    db = world({ storedQuota: 8 }); actAs(DEVELOPER, true); db.rpc = { catalog_effective_quota: () => 0 };
    await GET(call(viewerCookie));
    expect(h.deliverableCalls).toEqual([{ quota: 8, delivered: 0 }]);
  });

  it('what was already delivered counts, so "N of N delivered" is true in a viewer session too (2 of 3 delivered → 1 left)', async () => {
    db = world({ delivered: 2 });
    actAs(DEVELOPER, true); db.rpc = { catalog_effective_quota: () => 0 };
    const body = await (await GET(call(viewerCookie))).json();
    expect(body).toMatchObject({ deliverable: 1, quota: 3, delivered: 2 });
  });

  it('everything delivered: nothing left, and the numbers say why (3 of 3)', async () => {
    db = world({ delivered: 3 });
    actAs(DEVELOPER, true); db.rpc = { catalog_effective_quota: () => 0 };
    const body = await (await GET(call(viewerCookie))).json();
    expect(body).toMatchObject({ deliverable: 0, quota: 3, delivered: 3 });
  });

  it('an exempt delivery (granted outside the plan) is not counted against the quota', async () => {
    db = world({ delivered: 1 });
    (db.tables.catalog_deliveries[0] as Record<string, unknown>).quota_exempt = true;
    actAs(DEVELOPER, true); db.rpc = { catalog_effective_quota: () => 0 };
    expect((await (await GET(call(viewerCookie))).json()).delivered).toBe(0);
  });
});
