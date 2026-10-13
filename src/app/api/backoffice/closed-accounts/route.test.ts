// Prompt 900 §A/§B — the three back-office routes behind Startups › "Closed & deleted", through their real handlers: platform admin
// only; the list reads the accounts that ended; the two actions validate their input, call THEIR ONE SQL FUNCTION with the admin as
// actor, write nothing themselves (the function writes the history rows in the same transaction — a second audit row from the route
// would be a duplicate), and turn the database's refusal into a status and a sentence.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { fakeAdmin, fakeDb } from '@/test/fake-supabase';

const h = vi.hoisted(() => ({ isAdmin: true, admin: null as unknown }));
vi.mock('@/lib/backoffice-auth', () => ({
  requirePlatformAdmin: async () => (h.isAdmin
    ? { admin: h.admin, userId: 'bo-1' }
    : { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) }),
}));

import { GET, dynamic } from './route';
import { POST as reopen } from './reopen/route';
import { POST as release } from './release-email/route';

const ORG = '00000000-0000-4000-8000-0000000000c1';

/** An admin client that answers rpc() as told and refuses to be used for anything else. */
function stubAdmin(answer: (name: string, args: unknown) => { data: unknown; error: { code?: string; message: string } | null }) {
  const calls: { name: string; args: unknown }[] = [];
  const touched: string[] = [];
  return {
    calls, touched,
    admin: {
      rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return answer(name, args); },
      from: (table: string) => { touched.push(table); throw new Error(`the route must not read or write ${table} itself`); },
    },
  };
}

function post(handler: (req: Request) => Promise<Response>, body: unknown) {
  return handler(new Request('https://www.sherlockdeal.com/api/backoffice/closed-accounts/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}

beforeEach(() => { h.isAdmin = true; });

describe('GET /api/backoffice/closed-accounts', () => {
  it('is never prerendered at build time', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('is platform admin only', async () => {
    h.isAdmin = false;
    expect((await GET()).status).toBe(403);
  });

  it('lists the accounts that ended and nothing else', async () => {
    const d = fakeDb({
      orgs: [
        { id: ORG, name: 'zz-test-dead', is_test: true, is_internal: false, created_at: '2026-07-01T00:00:00Z', moderation_status: 'deleted', closed_at: null, closed_by: null, closed_reason: null, purge_after: null },
        { id: 'live-1', name: 'zz-test-live', is_test: true, is_internal: false, created_at: '2026-07-01T00:00:00Z', moderation_status: 'active', closed_at: null, closed_by: null, closed_reason: null, purge_after: null },
      ],
    });
    d.evalOr = true;
    h.admin = fakeAdmin(d);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.accounts.map((a: { name: string }) => a.name)).toEqual(['zz-test-dead']);
    expect(body.accounts[0]).toMatchObject({ moderationStatus: 'deleted', members: [], reopen: { ok: true } });
  });
});

describe('POST /api/backoffice/closed-accounts/reopen', () => {
  it('is platform admin only, and does not even look at the body before knowing that', async () => {
    h.isAdmin = false;
    const s = stubAdmin(() => ({ data: null, error: null })); h.admin = s.admin;
    expect((await post(reopen, { orgId: ORG, reason: 'ask by e-mail' })).status).toBe(403);
    expect(s.calls).toEqual([]);
  });

  it('needs an org and a reason of a few characters', async () => {
    const s = stubAdmin(() => ({ data: null, error: null })); h.admin = s.admin;
    expect((await post(reopen, { reason: 'ask by e-mail' })).status).toBe(400);
    expect((await post(reopen, { orgId: ORG })).status).toBe(400);
    expect((await post(reopen, { orgId: ORG, reason: ' x ' })).status).toBe(400);
    expect(s.calls).toEqual([]);
  });

  it('calls moderation_reopen_org with the admin as the actor and the reason trimmed — and writes nothing itself', async () => {
    const s = stubAdmin(() => ({ data: { orgId: ORG, status: 'active' }, error: null })); h.admin = s.admin;
    const res = await post(reopen, { orgId: ORG, reason: '  Nuno asked by e-mail  ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { orgId: ORG, status: 'active' } });
    expect(s.calls).toEqual([{ name: 'moderation_reopen_org', args: { p_org_id: ORG, p_reason: 'Nuno asked by e-mail', p_actor: 'bo-1' } }]);
    expect(s.touched).toEqual([]);
  });

  it('turns the database’s refusal into a status and its own sentence', async () => {
    const refuse = (code: string, message: string) => stubAdmin(() => ({ data: null, error: { code, message } }));
    let s = refuse('P0001', 'only a deleted account can be reopened (its status is active)'); h.admin = s.admin;
    let res = await post(reopen, { orgId: ORG, reason: 'ask by e-mail' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('only a deleted account can be reopened (its status is active)');

    s = refuse('42501', 'platform admin only'); h.admin = s.admin;
    expect((await post(reopen, { orgId: ORG, reason: 'ask by e-mail' })).status).toBe(403);

    s = refuse('P0001', 'no org with that id'); h.admin = s.admin;
    expect((await post(reopen, { orgId: ORG, reason: 'ask by e-mail' })).status).toBe(404);

    // before the migration is applied the function does not exist: say so, do not pretend it is a bad request
    s = refuse('PGRST202', 'Could not find the function public.moderation_reopen_org'); h.admin = s.admin;
    res = await post(reopen, { orgId: ORG, reason: 'ask by e-mail' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('has not been applied');
  });
});

describe('POST /api/backoffice/closed-accounts/release-email', () => {
  const USER = '00000000-0000-4000-8000-0000000000d1';

  it('is platform admin only', async () => {
    h.isAdmin = false;
    const s = stubAdmin(() => ({ data: null, error: null })); h.admin = s.admin;
    expect((await post(release, { orgId: ORG, userId: USER, reason: 'owner invite' })).status).toBe(403);
    expect(s.calls).toEqual([]);
  });

  it('needs the account, the person and a reason', async () => {
    const s = stubAdmin(() => ({ data: null, error: null })); h.admin = s.admin;
    expect((await post(release, { userId: USER, reason: 'owner invite' })).status).toBe(400);
    expect((await post(release, { orgId: ORG, reason: 'owner invite' })).status).toBe(400);
    expect((await post(release, { orgId: ORG, userId: USER })).status).toBe(400);
    expect(s.calls).toEqual([]);
  });

  it('calls moderation_release_org_member with the admin as the actor, and passes the "last member" fact back', async () => {
    const s = stubAdmin(() => ({ data: { orgId: ORG, userId: USER, email: 'a@zz-test.example', orgNowClosed: true, closedByThisRelease: true }, error: null })); h.admin = s.admin;
    const res = await post(release, { orgId: ORG, userId: USER, reason: ' owner invite needs the e-mail ' });
    expect(res.status).toBe(200);
    expect((await res.json()).result.closedByThisRelease).toBe(true);
    expect(s.calls).toEqual([{ name: 'moderation_release_org_member', args: { p_org_id: ORG, p_user_id: USER, p_reason: 'owner invite needs the e-mail', p_actor: 'bo-1' } }]);
    expect(s.touched).toEqual([]);
  });

  it('turns the database’s refusals (GDPR, blocked e-mail, owner window) into 409 with its own sentence', async () => {
    for (const message of [
      'a member of this account is in a GDPR erasure (pending or done): nothing is released from it',
      'this e-mail is on the blocked list: that was decided for security and is managed on its own screen',
      'this account was closed by its owner and can still be reopened until 2026-11-02: releasing a member now would leave nothing to reopen',
    ]) {
      const s = stubAdmin(() => ({ data: null, error: { code: 'P0001', message } })); h.admin = s.admin;
      const res = await post(release, { orgId: ORG, userId: USER, reason: 'owner invite' });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(message);
    }
  });

  it('a person who is not a member is a 404', async () => {
    const s = stubAdmin(() => ({ data: null, error: { code: 'P0001', message: 'that person is not a member of this account' } })); h.admin = s.admin;
    expect((await post(release, { orgId: ORG, userId: USER, reason: 'owner invite' })).status).toBe(404);
  });
});
