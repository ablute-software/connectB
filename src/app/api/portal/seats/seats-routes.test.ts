// Prompt 904 Part C (C4) — the portal seat routes through their real handlers and the real guard, over
// the stateful fake database: who may manage seats, what an administrator sees, what happens past the
// number, and that a removed member is told so. Only the session and the mailer are stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addUser, fakeSeatAdmin, seatDb, type SeatDb } from '@/test/fake-seat-db';

let db: SeatDb;
let currentUser: { id: string; email: string } | null;
const sendEmail = vi.fn(async (..._args: unknown[]) => ({ sent: true }));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSeatAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}));
vi.mock('@/lib/resend', () => ({
  sendTransactionalEmail: (...a: unknown[]) => sendEmail(...a),
  transactionalTemplate: () => '<p>x</p>',
}));

import { GET as seatsGet } from './route';
import { POST as invite } from './invite/route';
import { POST as cancel } from './invite/cancel/route';
import { POST as remove } from './remove/route';
import { POST as redeem } from './redeem/route';
import { POST as legacyRevoke } from '../colleagues/revoke/route';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';
import { createSeatCode, setSeatPlan } from '@/lib/investor-firm-seats';
import { findRemovedFirm } from '@/lib/investor-firm-seats-guard';

const FIRM = 'ent-zz-test-firm';
const json = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const seat = (userId: string, role = 'member') => {
  addUser(db, userId, `${userId}@zz-test-firm.com`);
  db.tables.matchdeal_investor_members.push({
    id: `m-${userId}`, user_id: userId, catalog_entity_id: FIRM, status: 'active', role,
    created_at: `2026-01-0${db.tables.matchdeal_investor_members.length + 1}`,
  });
};

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  db = seatDb();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', website: 'https://zz-test-firm.com' });
  sendEmail.mockClear();
  seat('ana', 'admin');
  seat('bob', 'member');
  await setSeatPlan(makeSeatStore(fakeSeatAdmin(db)), { entityId: FIRM, seats: 3, adminEmail: 'ana@zz-test-firm.com', actor: 'bo' });
  currentUser = { id: 'ana', email: 'ana@zz-test-firm.com' };
});

describe('GET /api/portal/seats', () => {
  it('an administrator gets the numbers, who holds each seat since when, and reserved seats', async () => {
    await invite(json({ email: 'guest@external.com' }));
    const body = await (await seatsGet()).json();
    expect(body).toMatchObject({ ok: true, hasPlan: true, isAdmin: true, planName: 'Private Detective', seats: 3, used: 2, reserved: 1, free: 0 });
    expect(body.members.map((m: { email: string }) => m.email).sort()).toEqual(['ana@zz-test-firm.com', 'bob@zz-test-firm.com']);
    expect(body.members[0].since).toBeTruthy();
    expect(body.invites).toMatchObject([{ email: 'guest@external.com' }]);
  });

  it('an ordinary member only learns the plan, not who else is on it', async () => {
    currentUser = { id: 'bob', email: 'bob@zz-test-firm.com' };
    const body = await (await seatsGet()).json();
    expect(body).toEqual({ ok: true, hasPlan: true, isAdmin: false, planName: 'Private Detective', seats: 3 });
  });

  it('a firm without a plan says so; a signed-out caller is refused', async () => {
    db.tables.investor_firm_seat_plans.length = 0;
    expect(await (await seatsGet()).json()).toEqual({ ok: true, hasPlan: false });
    currentUser = null;
    expect((await seatsGet()).status).toBe(401);
  });

  it('someone with no seat anywhere gets a clear refusal, not another firm\'s data', async () => {
    addUser(db, 'zed', 'zed@elsewhere.com');
    currentUser = { id: 'zed', email: 'zed@elsewhere.com' };
    expect((await seatsGet()).status).toBe(403);
  });
});

describe('administrator actions', () => {
  it('a member who is not an administrator cannot reserve, cancel or remove', async () => {
    currentUser = { id: 'bob', email: 'bob@zz-test-firm.com' };
    for (const res of [await invite(json({ email: 'x@external.com' })), await cancel(json({ inviteId: 'i' })), await remove(json({ memberId: 'm-ana' }))]) {
      expect(res.status).toBe(403);
    }
    expect(db.tables.matchdeal_investor_members.find((m) => m.id === 'm-ana')?.status).toBe('active');
  });

  it('reserves a seat, emails the person, and blocks the one that would exceed the number — saying why', async () => {
    const ok = await invite(json({ email: 'Guest@External.com' }));
    expect(await ok.json()).toMatchObject({ ok: true, emailSent: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0][0] as { to: string }).to).toBe('guest@external.com');
    const full = await invite(json({ email: 'another@external.com' }));
    expect(full.status).toBe(409);
    const body = await full.json();
    expect(body.error).toContain('Private Detective');
    expect(body.error).toContain('3 seats');
    expect(body.error).toContain('Remove a member or cancel an invite');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(db.tables.investor_firm_seat_invites).toHaveLength(1);
  });

  it('does not say whether the invited email already has an account (same answer either way)', async () => {
    addUser(db, 'known', 'known@external.com');
    const a = await (await invite(json({ email: 'known@external.com' }))).json();
    await cancel(json({ inviteId: db.tables.investor_firm_seat_invites[0].id }));
    const b = await (await invite(json({ email: 'unknown@external.com' }))).json();
    expect(a).toEqual(b);
  });

  it('removing a member frees the seat, keeps the history, and the removed person is told by name', async () => {
    const res = await remove(json({ memberId: 'm-bob' }));
    expect(await res.json()).toEqual({ ok: true });
    expect(db.tables.matchdeal_investor_members.find((m) => m.id === 'm-bob')?.status).toBe('revoked');
    expect(await findRemovedFirm(fakeSeatAdmin(db), 'bob')).toEqual({ entityId: FIRM, entityName: 'zz-test-firm' });
    expect(await findRemovedFirm(fakeSeatAdmin(db), 'ana')).toBeNull();
    // the freed seat can be reserved again
    expect((await invite(json({ email: 'new@external.com' }))).status).toBe(200);
  });

  it('an administrator cannot remove their own seat', async () => {
    const res = await remove(json({ memberId: 'm-ana' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('your own seat');
  });

  it('cannot reach into another firm\'s seats', async () => {
    db.tables.matchdeal_investor_members.push({ id: 'm-else', user_id: 'else', catalog_entity_id: 'ent-other', status: 'active', role: 'member', created_at: '2026-02-01' });
    const res = await remove(json({ memberId: 'm-else' }));
    expect(res.status).toBe(404);
    expect(db.tables.matchdeal_investor_members.find((m) => m.id === 'm-else')?.status).toBe('active');
  });

  it('on a firm without a plan the manage routes refuse with a clear message', async () => {
    db.tables.investor_firm_seat_plans.length = 0;
    const res = await invite(json({ email: 'x@external.com' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('no custom seat plan');
  });
});

describe('the older "revoke a colleague" route on a firm with a plan', () => {
  it('a member who is not an administrator can no longer remove the head of the firm', async () => {
    currentUser = { id: 'bob', email: 'bob@zz-test-firm.com' };
    const res = await legacyRevoke(json({ memberId: 'm-ana' }));
    expect(res.status).toBe(403);
    expect(db.tables.matchdeal_investor_members.find((m) => m.id === 'm-ana')?.status).toBe('active');
  });

  it('an administrator removes through the same rule (history and last-admin protection included)', async () => {
    const res = await legacyRevoke(json({ memberId: 'm-bob' }));
    expect((await res.json()).ok).toBe(true);
    expect(db.tables.investor_seat_events.some((e) => e.event === 'seat_released' && e.actor_user_id === 'ana')).toBe(true);
  });

  it('a firm without a plan keeps the old behaviour: any member removes any other', async () => {
    db.tables.investor_firm_seat_plans.length = 0;
    currentUser = { id: 'bob', email: 'bob@zz-test-firm.com' };
    expect((await (await legacyRevoke(json({ memberId: 'm-ana' }))).json()).ok).toBe(true);
  });
});

describe('POST /api/portal/seats/redeem', () => {
  it('activates the plan for the claimant of that profile and gives the same refusal to everyone else', async () => {
    db.tables.investor_firm_seat_plans.length = 0;
    db.tables.investor_entity_claims.push({ id: 'c1', catalog_entity_id: FIRM, claimant_user_id: 'ana', status: 'approved' });
    const created = await createSeatCode(makeSeatStore(fakeSeatAdmin(db)), { entityId: FIRM, seats: 8, actor: 'bo', now: new Date(db.clock) });
    const code = (created as { code: string }).code;

    currentUser = { id: 'bob', email: 'bob@zz-test-firm.com' }; // seated, but no approved claim of his own
    const refused = await redeem(json({ code }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("This code can't be used with your account.");

    currentUser = { id: 'ana', email: 'ana@zz-test-firm.com' };
    const ok = await redeem(json({ code }));
    expect(await ok.json()).toEqual({ ok: true, seats: 8 });
    expect(db.tables.investor_firm_seat_plans[0]).toMatchObject({ seats: 8, activated_via: 'promo_code' });
    expect((await redeem(json({ code }))).status).toBe(400); // single use
  });

  it('refuses a signed-out caller', async () => {
    currentUser = null;
    expect((await redeem(json({ code: 'PD-AAAAA-BBBBB-CCCCC-DDDDD' }))).status).toBe(401);
  });
});
