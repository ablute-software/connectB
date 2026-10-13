// Prompt 906 §B — a round update can be edited and deleted, and the investor's feed follows, step by step.
//
// Real route handlers over an in-memory database that applies writes. The one thing the database does that no
// route does — stamping updated_at when (and only when) the title or body really changes — is modelled by
// `afterUpdate` below, and the SQL it models was rehearsed against production in a transaction that rolls back
// (migration 20261013100000_round_updates_updated_at.sql).
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeDb, fakeSession, type FakeDb, type Row } from '@/test/fake-supabase';
import { VIEWER_ORG_COOKIE } from '@/lib/developer-viewer-shape';
import { canManageRoundUpdate, roundUpdateEditedAt, ROUND_UPDATE_DELETE_MESSAGE } from '@/lib/round-updates';

const h = vi.hoisted(() => ({
  session: null as unknown,
  admin: null as unknown,
  sendEmail: null as unknown as ReturnType<typeof vi.fn>,
}));
h.sendEmail = vi.fn(async () => ({ sent: true }));

vi.mock('@/lib/supabase-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  authEnabled: true,
  serverClient: async () => h.session,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }));
// A closed org is its own screen (410); nothing here is closed.
vi.mock('@/lib/org-closed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/org-closed')>()),
  closedOrgGuard: async () => null,
}));
// Mail is configured, and counted: publishing emails the investors with access, editing and deleting must not.
vi.mock('@/lib/resend', () => ({
  resendConfigured: true,
  sendTransactionalEmail: (...args: unknown[]) => (h.sendEmail as (...a: unknown[]) => unknown)(...args),
  transactionalTemplate: () => '<p>update</p>',
}));

const ORG = 'a9a9a9a9-0000-4000-8000-0000000009a6'; // zz-test-906-org
const OTHER = 'b9b9b9b9-0000-4000-8000-0000000009b6'; // zz-test-906-other
const OWNER = 'user-906-owner';
const ADMIN = 'user-906-admin';
const MANAGER = 'user-906-manager';
const MEMBER = 'user-906-member';
const OUTSIDER = 'user-906-outsider'; // a member of OTHER
const INVESTOR = 'user-906-investor';
const DEV = 'user-906-dev'; // a platform developer, member of OTHER
const INVESTOR_EMAIL = 'investor@zz-test-906.example';
const ENTERED = '2026-10-13T10:00:00.000Z';

let db: FakeDb;

function world(): FakeDb {
  const d = fakeDb({
    orgs: [{ id: ORG, name: 'zz-test-906-org' }, { id: OTHER, name: 'zz-test-906-other' }],
    org_members: [
      { user_id: OWNER, org_id: ORG, role: 'owner' },
      { user_id: ADMIN, org_id: ORG, role: 'admin' },
      { user_id: MANAGER, org_id: ORG, role: 'manager' },
      { user_id: MEMBER, org_id: ORG, role: 'member' },
      { user_id: OUTSIDER, org_id: OTHER, role: 'owner' },
      { user_id: DEV, org_id: OTHER, role: 'admin' },
    ],
    access_grants: [{ org_id: ORG, grantee_email: INVESTOR_EMAIL, invited_email: null, confirmed_at: null, revoked_at: null, expires_at: null }],
    people: [],
    round_updates: [],
    admin_audit_log: [],
    platform_admins: [{ user_id: DEV }],
  });
  d.applyWrites = true;
  d.evalOr = true;
  // the migration's trigger: stamp updated_at only when title or body really differ
  d.afterUpdate = {
    round_updates: (after, before) => {
      if (after.title !== before.title || after.body !== before.body) after.updated_at = new Date(Date.now() + 1000).toISOString();
    },
  };
  return d;
}

function asUser(user: string, opts: { developer?: boolean; email?: string } = {}) {
  h.session = fakeSession(db, { userId: user, isDeveloper: !!opts.developer, email: opts.email ?? `${user}@example.test` });
  h.admin = fakeAdmin(db);
}

function signedOut() {
  h.session = {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => { throw new Error('a signed-out request must not read anything'); },
    rpc: async () => ({ data: false, error: null }),
  };
  h.admin = fakeAdmin(db);
}

const req = (method: string, url: string, body?: unknown, cookie?: string) => new NextRequest(`https://example.test${url}`, {
  method,
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

type J = Record<string, unknown>;

async function create(body: unknown) {
  const { POST } = await import('@/app/api/org/updates/route');
  const res = await POST(req('POST', '/api/org/updates', body));
  return { status: res.status, json: await res.json() as J };
}
async function list(cookie?: string) {
  const { GET } = await import('@/app/api/org/updates/route');
  const res = await GET(req('GET', '/api/org/updates', undefined, cookie));
  return { status: res.status, json: await res.json() as { updates: J[] } };
}
async function patch(id: string, body: unknown, cookie?: string) {
  const { PATCH } = await import('@/app/api/org/updates/[id]/route');
  const res = await PATCH(req('PATCH', `/api/org/updates/${id}`, body, cookie), { params: { id } });
  return { status: res.status, json: await res.json() as J };
}
async function remove(id: string, cookie?: string) {
  const { DELETE } = await import('@/app/api/org/updates/[id]/route');
  const res = await DELETE(req('DELETE', `/api/org/updates/${id}`, undefined, cookie), { params: { id } });
  return { status: res.status, json: await res.json() as J };
}
async function portalFeed() {
  const { GET } = await import('@/app/api/portal/updates/route');
  const res = await GET(new Request(`https://example.test/api/portal/updates?org_id=${ORG}`));
  return { status: res.status, json: await res.json() as { updates: J[] } };
}

const stored = (): Row[] => db.tables.round_updates;
const seed = (row: Row) => { stored().push({ org_id: ORG, created_at: '2026-10-07T18:14:52.000Z', updated_at: null, ...row }); };

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
  h.sendEmail.mockClear();
  db = world();
  asUser(OWNER);
});

describe('who may change an update (the pure rule)', () => {
  it('owner and admin: any update; manager and member: only their own; nobody who is off the team', () => {
    const someoneElse = 'someone-else';
    expect(canManageRoundUpdate({ role: 'owner', userId: 'u', createdBy: someoneElse })).toBe(true);
    expect(canManageRoundUpdate({ role: 'admin', userId: 'u', createdBy: someoneElse })).toBe(true);
    expect(canManageRoundUpdate({ role: 'manager', userId: 'u', createdBy: someoneElse })).toBe(false);
    expect(canManageRoundUpdate({ role: 'member', userId: 'u', createdBy: someoneElse })).toBe(false);
    expect(canManageRoundUpdate({ role: 'manager', userId: 'u', createdBy: 'u' })).toBe(true);
    expect(canManageRoundUpdate({ role: 'member', userId: 'u', createdBy: 'u' })).toBe(true);
    expect(canManageRoundUpdate({ role: null, userId: 'u', createdBy: 'u' })).toBe(false);
    expect(canManageRoundUpdate({ role: 'member', userId: 'u', createdBy: null })).toBe(false);
  });

  it('"edited" means updated_at is set — and a stamp from before the update existed is bad data, not an edit', () => {
    expect(roundUpdateEditedAt({ created_at: '2026-10-07T18:00:00Z', updated_at: null })).toBeNull();
    expect(roundUpdateEditedAt({ created_at: '2026-10-07T18:00:00Z' })).toBeNull();
    expect(roundUpdateEditedAt({ created_at: '2026-10-07T18:00:00Z', updated_at: '2026-10-08T09:00:00Z' })).toBe('2026-10-08T09:00:00Z');
    expect(roundUpdateEditedAt({ created_at: '2026-10-07T18:00:00Z', updated_at: '2026-10-07T17:00:00Z' })).toBeNull();
    expect(roundUpdateEditedAt({ created_at: '2026-10-07T18:00:00Z', updated_at: 'not a date' })).toBeNull();
  });

  it('the delete confirmation says what the prompt asked it to say', () => {
    expect(ROUND_UPDATE_DELETE_MESSAGE).toBe(
      "This removes the update from your profile and from investors' feeds. Investors who already saw it keep their notification.",
    );
  });
});

describe('create → edit → delete, with the investor\'s feed beside it', () => {
  it('each step shows up in the portal, and only publishing sends an email', async () => {
    // 1 — publish
    const made = await create({ title: 'ABOUT FOOD opens €250k Seed round', body: 'We are opening the round.' });
    expect(made.json.ok).toBe(true);
    expect(made.json.emailedCount).toBe(1);
    const id = made.json.id as string;
    expect(h.sendEmail).toHaveBeenCalledTimes(1);

    asUser(INVESTOR, { email: INVESTOR_EMAIL });
    let feed = await portalFeed();
    expect(feed.json.updates).toHaveLength(1);
    expect(feed.json.updates[0]).toMatchObject({ id, title: 'ABOUT FOOD opens €250k Seed round', body: 'We are opening the round.', updated_at: null });
    // the investor's side sees these five fields and no more (no author id, no org id)
    expect(Object.keys(feed.json.updates[0]).sort()).toEqual(['body', 'created_at', 'id', 'title', 'updated_at']);

    // 2 — the founder sees it, with the buttons
    asUser(OWNER);
    const mine = await list();
    expect(mine.json.updates).toHaveLength(1);
    expect(mine.json.updates[0]).toMatchObject({ id, can_edit: true });

    // 3 — edit
    const edited = await patch(id, { title: 'ABOUT FOOD opens its €250k Seed round', body: 'The round is open: €250k, seed.' });
    expect(edited.status).toBe(200);
    expect(edited.json.ok).toBe(true);

    asUser(INVESTOR, { email: INVESTOR_EMAIL });
    feed = await portalFeed();
    expect(feed.json.updates).toHaveLength(1);
    expect(feed.json.updates[0]).toMatchObject({ id, title: 'ABOUT FOOD opens its €250k Seed round', body: 'The round is open: €250k, seed.' });
    expect(feed.json.updates[0].updated_at).toBeTruthy();
    expect(roundUpdateEditedAt(feed.json.updates[0] as { created_at: string; updated_at: string })).not.toBeNull();

    // 4 — delete
    asUser(OWNER);
    const gone = await remove(id);
    expect(gone.status).toBe(200);
    expect(gone.json.ok).toBe(true);
    expect((await list()).json.updates).toHaveLength(0);
    asUser(INVESTOR, { email: INVESTOR_EMAIL });
    expect((await portalFeed()).json.updates).toHaveLength(0);

    // no notification for the edit, none for the delete: still the one email from publishing
    expect(h.sendEmail).toHaveBeenCalledTimes(1);

    // and the same row cannot be deleted twice
    asUser(OWNER);
    expect((await remove(id)).status).toBe(404);
  });

  it('the 07/10 case: a duplicate is removed and the original stays', async () => {
    seed({ id: 'dup-1', title: 'ABOUT FOOD opens €250k Seed round', body: 'same', created_by: OWNER });
    seed({ id: 'dup-2', title: 'ABOUT FOOD opens €250k Seed round', body: 'same', created_by: OWNER, created_at: '2026-10-07T18:15:33.000Z' });
    expect((await remove('dup-2')).status).toBe(200);
    expect(stored().map((r) => r.id)).toEqual(['dup-1']);
  });
});

describe('PATCH', () => {
  beforeEach(() => { seed({ id: 'u1', title: 'Original title', body: 'Original body', created_by: OWNER }); });

  it('changes what it is given, trims it, and leaves the rest alone', async () => {
    const r = await patch('u1', { title: '  New title  ' });
    expect(r.status).toBe(200);
    expect(stored()[0]).toMatchObject({ title: 'New title', body: 'Original body' });
    expect(stored()[0].updated_at).toBeTruthy();
  });

  it('refuses an empty title, an empty body, and a request that changes nothing', async () => {
    expect((await patch('u1', { title: '   ' })).status).toBe(400);
    expect((await patch('u1', { body: '' })).status).toBe(400);
    expect((await patch('u1', {})).status).toBe(400);
    expect((await patch('u1', { title: 42 })).status).toBe(400);
    expect(stored()[0]).toMatchObject({ title: 'Original title', body: 'Original body', updated_at: null });
  });

  it('a row deleted between the permission check and the write is a 404, not a 500', async () => {
    const session = h.session as { from: (t: string) => unknown };
    const realFrom = session.from.bind(session);
    let touches = 0;
    session.from = (table: string) => {
      if (table === 'round_updates' && ++touches === 2) db.tables.round_updates = []; // the write finds nothing
      return realFrom(table);
    };
    const r = await patch('u1', { title: 'Too late' });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Update not found.');
  });

  it('writes the title and body only — updated_at is the database\'s to stamp, so sending the same text back is not an edit', async () => {
    const r = await patch('u1', { title: 'Original title', body: 'Original body' });
    expect(r.status).toBe(200);
    const write = db.writes.find((w) => w.table === 'round_updates' && w.op === 'update');
    expect(Object.keys(write?.values as J).sort()).toEqual(['body', 'title']);
    expect(stored()[0].updated_at).toBeNull();
  });
});

describe('who gets through', () => {
  beforeEach(() => {
    seed({ id: 'by-owner', title: 'Owner wrote this', body: 'b', created_by: OWNER });
    seed({ id: 'by-manager', title: 'Manager wrote this', body: 'b', created_by: MANAGER });
    seed({ id: 'by-member', title: 'Member wrote this', body: 'b', created_by: MEMBER });
  });

  const cases: { actor: string; role: string; target: string; allowed: boolean }[] = [
    { actor: OWNER, role: 'owner', target: 'by-member', allowed: true },
    { actor: ADMIN, role: 'admin', target: 'by-manager', allowed: true },
    { actor: ADMIN, role: 'admin', target: 'by-owner', allowed: true },
    { actor: MANAGER, role: 'manager', target: 'by-manager', allowed: true },
    { actor: MANAGER, role: 'manager', target: 'by-owner', allowed: false },
    { actor: MEMBER, role: 'member', target: 'by-member', allowed: true },
    { actor: MEMBER, role: 'member', target: 'by-manager', allowed: false },
  ];

  it.each(cases)('$role editing $target → allowed: $allowed', async ({ actor, target, allowed }) => {
    asUser(actor);
    const before = JSON.stringify(stored());
    const r = await patch(target, { title: 'Changed' });
    expect(r.status).toBe(allowed ? 200 : 403);
    if (!allowed) expect(JSON.stringify(stored())).toBe(before);
  });

  it.each(cases)('$role deleting $target → allowed: $allowed', async ({ actor, target, allowed }) => {
    asUser(actor);
    const r = await remove(target);
    expect(r.status).toBe(allowed ? 200 : 403);
    expect(stored().some((x) => x.id === target)).toBe(!allowed);
  });

  it('the list tells each caller which rows they may touch (and the buttons follow it)', async () => {
    asUser(MEMBER);
    const mine = (await list()).json.updates;
    expect(Object.fromEntries(mine.map((u) => [u.id, u.can_edit]))).toEqual({ 'by-owner': false, 'by-manager': false, 'by-member': true });
    asUser(ADMIN);
    expect((await list()).json.updates.every((u) => u.can_edit === true)).toBe(true);
  });

  it('an id from another org is a 404 — never a 403 that would confirm it exists — and nothing changes', async () => {
    asUser(OUTSIDER);
    const before = JSON.stringify(stored());
    expect((await patch('by-owner', { title: 'x' })).status).toBe(404);
    expect((await remove('by-owner')).status).toBe(404);
    expect(JSON.stringify(stored())).toBe(before);
  });

  it('a signed-out request is a 401 and reads nothing', async () => {
    signedOut();
    expect((await patch('by-owner', { title: 'x' })).status).toBe(401);
    expect((await remove('by-owner')).status).toBe(401);
  });
});

describe('Developer Viewer (Prompt 904): read-only', () => {
  const cookie = `${VIEWER_ORG_COOKIE}=${ORG}:${ENTERED}`;
  beforeEach(() => {
    seed({ id: 'by-owner', title: 'Owner wrote this', body: 'b', created_by: OWNER });
    asUser(DEV, { developer: true });
  });

  it('PATCH and DELETE answer 403 viewer_read_only and change nothing', async () => {
    const before = JSON.stringify(stored());
    const p = await patch('by-owner', { title: 'x' }, cookie);
    const d = await remove('by-owner', cookie);
    for (const r of [p, d]) {
      expect(r.status).toBe(403);
      expect(r.json.error).toBe('viewer_read_only');
    }
    expect(JSON.stringify(stored())).toBe(before);
    expect(db.writes.filter((w) => w.table === 'round_updates')).toHaveLength(0);
  });

  it('the list shows the viewed org\'s updates, and offers no button on any of them', async () => {
    const r = await list(cookie);
    expect(r.json.updates.map((u) => u.id)).toEqual(['by-owner']);
    expect(r.json.updates.every((u) => u.can_edit === false)).toBe(true);
  });
});
