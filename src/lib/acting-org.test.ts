// Prompt 904 — the resolver and the two wrappers, over the in-memory Supabase fake.
//
// Fixture, always the same: the caller (DEV) is a MEMBER of org A (ablute_, the
// developer's own org) and is a platform developer. The viewer cookie names org B
// (Insignals). Everything below asserts that B — never A — is what a viewer session
// resolves to, that a viewer cannot write, and that outside a viewer session
// nothing changes for anybody.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeDb, fakeSession, type FakeDb } from '@/test/fake-supabase';
import { VIEWER_ORG_COOKIE } from '@/lib/developer-viewer';

const h = vi.hoisted(() => ({
  session: null as unknown,
  admin: null as unknown,
  serverClientCalls: 0,
}));

vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => { h.serverClientCalls += 1; return h.session; },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }));

import {
  _resetViewerReadAuditForTests,
  authorizeActingOrg,
  isViewerRequest,
  normalizeAuditRoute,
  resolveActingOrg,
  withActingOrg,
  withoutViewer,
} from '@/lib/acting-org';

const DEV = 'dddddddd-0000-0000-0000-000000000001';
const FOUNDER_B = 'ffffffff-0000-0000-0000-00000000000b';
const ORG_A = '0cdfcfc9-0000-0000-0000-00000000000a'; // ablute_ — the developer's own org
const ORG_B = 'b0b0b0b0-0000-0000-0000-00000000000b'; // Insignals — the org being viewed
const ORG_C = 'c0c0c0c0-0000-0000-0000-00000000000c'; // a third org nobody here belongs to
const ENTERED = '2026-10-12T10:00:00.000Z';
const COOKIE_B = `${VIEWER_ORG_COOKIE}=${ORG_B}:${ENTERED}`;

function req(path: string, opts: { cookie?: string; method?: string } = {}): Request {
  return new Request(`https://example.test${path}`, {
    method: opts.method ?? 'GET',
    headers: opts.cookie ? { cookie: opts.cookie } : {},
  });
}

let db: FakeDb;

function setup(opts: { isDeveloper: boolean; userId?: string } = { isDeveloper: true }) {
  db = fakeDb({
    org_members: [
      { user_id: DEV, org_id: ORG_A, role: 'admin' },
      { user_id: FOUNDER_B, org_id: ORG_B, role: 'owner' },
    ],
    admin_audit_log: [],
  });
  h.session = fakeSession(db, { userId: opts.userId ?? DEV, isDeveloper: opts.isDeveloper });
  h.admin = fakeAdmin(db);
}

beforeEach(() => {
  h.serverClientCalls = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
  _resetViewerReadAuditForTests();
  setup();
});

const auditRows = () => db.writes.filter((w) => w.table === 'admin_audit_log' && w.op === 'insert');

describe('resolveActingOrg', () => {
  it('outside a viewer session it is the caller\'s own membership, with the caller\'s role', async () => {
    const acting = await resolveActingOrg(req('/api/x'), { id: DEV });
    expect(acting).toEqual({ orgId: ORG_A, mode: 'member', role: 'admin' });
  });

  it('in a verified viewer session it is the VIEWED org, never the caller\'s own', async () => {
    const acting = await resolveActingOrg(req('/api/x', { cookie: COOKIE_B }), { id: DEV });
    expect(acting.orgId).toBe(ORG_B);
    expect(acting.mode).toBe('viewer');
    expect(acting.orgId).not.toBe(ORG_A);
  });

  it('a viewer sees what the owner sees (and nothing else changes: the wrapper refuses every write)', async () => {
    const acting = await resolveActingOrg(req('/api/x', { cookie: COOKIE_B }), { id: DEV });
    expect(acting.role).toBe('owner');
  });

  it('a forged viewer cookie on a NON-developer session is ignored — the caller\'s own org', async () => {
    setup({ isDeveloper: false, userId: FOUNDER_B });
    const acting = await resolveActingOrg(req('/api/x', { cookie: `${VIEWER_ORG_COOKIE}=${ORG_C}:${ENTERED}` }), { id: FOUNDER_B });
    expect(acting).toEqual({ orgId: ORG_B, mode: 'member', role: 'owner' });
  });

  it('a caller with no org and no viewer session resolves to null, not to somebody else\'s', async () => {
    const acting = await resolveActingOrg(req('/api/x'), { id: 'nobody' });
    expect(acting).toEqual({ orgId: null, mode: 'member', role: null });
  });

  it('asks is_ablute_developer once per request however many helpers ask', async () => {
    let calls = 0;
    const session = fakeSession(db, { userId: DEV, isDeveloper: true });
    const rpc = session.rpc.bind(session);
    (session as unknown as { rpc: unknown }).rpc = async (name: string) => { calls += 1; return rpc(name); };
    const r = req('/api/x', { cookie: COOKIE_B });
    await resolveActingOrg(r, { id: DEV }, session);
    await resolveActingOrg(r, { id: DEV }, session);
    await authorizeActingOrg(r, { id: DEV }, ORG_B, session);
    await isViewerRequest(r, session);
    expect(calls).toBe(1);
  });
});

describe('authorizeActingOrg (the client names the org)', () => {
  it('a member may name their own org', async () => {
    expect(await authorizeActingOrg(req('/api/x'), { id: DEV }, ORG_A)).toEqual({ orgId: ORG_A, mode: 'member', role: 'admin' });
  });
  it('a member may not name an org they do not belong to', async () => {
    expect(await authorizeActingOrg(req('/api/x'), { id: DEV }, ORG_B)).toBeNull();
  });
  it('in a viewer session only the VIEWED org is acceptable — not the caller\'s own, not a third', async () => {
    const r = () => req('/api/x', { cookie: COOKIE_B });
    expect(await authorizeActingOrg(r(), { id: DEV }, ORG_B)).toEqual({ orgId: ORG_B, mode: 'viewer', role: 'owner' });
    expect(await authorizeActingOrg(r(), { id: DEV }, ORG_A)).toBeNull();
    expect(await authorizeActingOrg(r(), { id: DEV }, ORG_C)).toBeNull();
  });
});

describe('isViewerRequest', () => {
  it('is false without a cookie and never builds a session client for it', async () => {
    expect(await isViewerRequest(req('/api/x'))).toBe(false);
    expect(h.serverClientCalls).toBe(0);
  });
  it('is true for a cookie on a developer session, false for the same cookie on anyone else', async () => {
    expect(await isViewerRequest(req('/api/x', { cookie: COOKIE_B }))).toBe(true);
    setup({ isDeveloper: false });
    expect(await isViewerRequest(req('/api/x', { cookie: COOKIE_B }))).toBe(false);
  });
});

describe('withActingOrg — a viewer session is read-only', () => {
  const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s in a viewer session answers 403 viewer_read_only and the handler never runs', async (method) => {
    const handler = vi.fn(ok);
    const wrapped = withActingOrg(handler);
    const res = await wrapped(req('/api/thing', { cookie: COOKIE_B, method }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: 'viewer_read_only' });
    expect(handler).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it('a GET in a viewer session runs the handler', async () => {
    const handler = vi.fn(ok);
    const res = await withActingOrg(handler)(req('/api/thing', { cookie: COOKIE_B }));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('outside a viewer session every method is a pass-through and no session client is built', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const handler = vi.fn(ok);
      const res = await withActingOrg(handler)(req('/api/thing', { method }));
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    }
    expect(h.serverClientCalls).toBe(0);
  });

  it('a viewer cookie on a non-developer session does not block that person\'s own writes', async () => {
    setup({ isDeveloper: false, userId: FOUNDER_B });
    const handler = vi.fn(ok);
    const res = await withActingOrg(handler)(req('/api/thing', { cookie: COOKIE_B, method: 'POST' }));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('allowViewerWrite is the one visible way to let a write through', async () => {
    const handler = vi.fn(ok);
    const res = await withActingOrg(handler, { allowViewerWrite: true })(req('/api/thing', { cookie: COOKIE_B, method: 'POST' }));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignoreInViewer skips the handler and answers 200 { ignored: "viewer" } — for beacons', async () => {
    const handler = vi.fn(ok);
    const res = await withActingOrg(handler, { ignoreInViewer: true })(req('/api/events/page-view', { cookie: COOKIE_B, method: 'POST' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: 'viewer' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('forwards the route context (params) untouched', async () => {
    const handler = vi.fn(async (_r: Request, ctx: { params: { id: string } }) => new Response(ctx.params.id));
    const res = await withActingOrg(handler)(req('/api/thing/42', { cookie: COOKIE_B }), { params: { id: '42' } });
    expect(await res.text()).toBe('42');
  });
});

describe('withoutViewer — the caller\'s own account is never touched on anyone\'s behalf', () => {
  const ok = () => new Response('fine', { status: 200 });

  it.each(['GET', 'POST', 'PATCH', 'DELETE'])('%s in a viewer session answers 403 viewer_read_only', async (method) => {
    const handler = vi.fn(ok);
    const res = await withoutViewer(handler)(req('/api/account/password', { cookie: COOKIE_B, method }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'viewer_read_only' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('is a pass-through for everybody else', async () => {
    const handler = vi.fn(ok);
    const res = await withoutViewer(handler)(req('/api/account/password', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('viewer_read audit', () => {
  const ok = () => new Response('{}', { status: 200 });

  it('logs one viewer_read per route per viewer session, with the route and no query string', async () => {
    const wrapped = withActingOrg(ok);
    await wrapped(req('/api/market-thesis?secret=1', { cookie: COOKIE_B }));
    await wrapped(req('/api/market-thesis?secret=2', { cookie: COOKIE_B }));
    await wrapped(req('/api/market-thesis', { cookie: COOKIE_B }));
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toMatchObject({
      admin_user_id: DEV, action: 'viewer_read', subject_type: 'org', subject_id: ORG_B,
      detail: { route: '/api/market-thesis', enteredAt: ENTERED },
    });
    expect(JSON.stringify(rows[0].values)).not.toContain('secret');
  });

  it('a different route is a different row; ids are folded so the log stays small', async () => {
    const wrapped = withActingOrg(ok);
    await wrapped(req('/api/market-thesis', { cookie: COOKIE_B }));
    await wrapped(req('/api/entities/3f2a1b4c-0000-4000-8000-000000000001/notes', { cookie: COOKIE_B }));
    await wrapped(req('/api/entities/9a9a9a9a-0000-4000-8000-000000000002/notes', { cookie: COOKIE_B }));
    const routes = auditRows().map((w) => (w.values as { detail: { route: string } }).detail.route);
    expect(routes).toEqual(['/api/market-thesis', '/api/entities/:id/notes']);
  });

  it('a new viewer session (new enteredAt) logs again', async () => {
    const wrapped = withActingOrg(ok);
    await wrapped(req('/api/market-thesis', { cookie: COOKIE_B }));
    await wrapped(req('/api/market-thesis', { cookie: `${VIEWER_ORG_COOKIE}=${ORG_B}:2026-10-12T11:00:00.000Z` }));
    expect(auditRows()).toHaveLength(2);
  });

  it('is exact across serverless instances: a row already in the log is not written twice', async () => {
    db.tables.admin_audit_log.push({
      admin_user_id: DEV, action: 'viewer_read', subject_type: 'org', subject_id: ORG_B,
      detail: { route: '/api/market-thesis', enteredAt: ENTERED },
    });
    await withActingOrg(ok)(req('/api/market-thesis', { cookie: COOKIE_B }));
    expect(auditRows()).toHaveLength(0);
  });

  it('nothing is logged outside a viewer session, nor for a refused write', async () => {
    await withActingOrg(ok)(req('/api/market-thesis'));
    await withActingOrg(ok)(req('/api/market-thesis', { cookie: COOKIE_B, method: 'POST' }));
    expect(auditRows()).toHaveLength(0);
  });

  it('a failing log write never stops the read', async () => {
    h.admin = { from: () => { throw new Error('audit table down'); } };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await withActingOrg(ok)(req('/api/market-thesis', { cookie: COOKIE_B }));
    expect(res.status).toBe(200);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('normalizeAuditRoute', () => {
  it('drops the query string and folds uuids and numeric segments', () => {
    expect(normalizeAuditRoute(req('/api/a/3f2a1b4c-0000-4000-8000-000000000001/b/17?x=1'))).toBe('/api/a/:id/b/:n');
    expect(normalizeAuditRoute(req('/api/plain'))).toBe('/api/plain');
  });
});
