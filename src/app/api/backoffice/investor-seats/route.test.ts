// Prompt 904 Part C (C3, C6) — the back-office seat route: platform-admin only, pre-assignment before any
// claim, the code shown once and never logged, release / reassign, and the "migration not applied" guard.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { addUser, fakeSeatAdmin, seatDb, type SeatDb } from '@/test/fake-seat-db';

let db: SeatDb;
let isAdmin = true;
const audit = vi.fn(async (..._a: unknown[]) => {});

vi.mock('@/lib/backoffice-auth', () => ({
  requirePlatformAdmin: async () => (isAdmin
    ? { admin: fakeSeatAdmin(db), userId: 'bo-1' }
    : { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) }),
}));
vi.mock('@/lib/audit', () => ({ logAdminAction: (...a: unknown[]) => audit(...a) }));

import { GET, POST } from './route';

const FIRM = 'ent-zz-test-firm';
const post = (body: unknown) => POST(new Request('http://localhost/api/backoffice/investor-seats', { method: 'POST', body: JSON.stringify(body) }));
const get = (qs = '') => GET(new Request(`http://localhost/api/backoffice/investor-seats${qs}`));

beforeEach(() => {
  db = seatDb();
  isAdmin = true;
  audit.mockClear();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', website: 'https://zz-test-firm.com', is_test: true });
});

describe('access', () => {
  it('refuses anyone who is not a platform admin, on both verbs', async () => {
    isAdmin = false;
    expect((await get()).status).toBe(403);
    expect((await post({ action: 'set_plan', entityId: FIRM, seats: 10 })).status).toBe(403);
    expect(db.tables.investor_firm_seat_plans).toHaveLength(0);
  });

  it('says plainly when the migration has not been applied, and writes nothing', async () => {
    delete (db.tables as Record<string, unknown>).investor_firm_seat_plans;
    const res = await post({ action: 'set_plan', entityId: FIRM, seats: 10 });
    expect(await res.json()).toMatchObject({ ok: false, migrationPending: true });
  });
});

describe('pre-assignment (before any claim)', () => {
  it('assigns 10 seats to a profile nobody has claimed, and the audit trail records it', async () => {
    const res = await post({ action: 'set_plan', entityId: FIRM, seats: 10, adminEmail: 'ana@zz-test-firm.com' });
    expect((await res.json()).ok).toBe(true);
    expect(db.tables.investor_firm_seat_plans[0]).toMatchObject({
      catalog_entity_id: FIRM, seats: 10, plan_name: 'Private Detective', admin_email: 'ana@zz-test-firm.com', status: 'active',
    });
    expect(audit.mock.calls[0][1]).toMatchObject({ action: 'investor_seats_set_plan', subjectId: FIRM, adminUserId: 'bo-1' });
    const detail = await (await get(`?entityId=${FIRM}`)).json();
    expect(detail).toMatchObject({ ok: true, limit: 10, used: 0, reserved: 0, free: 10, plan: { seats: 10 } });
    const list = await (await get()).json();
    expect(list.firms).toMatchObject([{ entityId: FIRM, name: 'zz-test-firm', seats: 10, used: 0, free: 10 }]);
  });

  it('rejects nonsense numbers and unknown firms and actions', async () => {
    expect((await post({ action: 'set_plan', entityId: FIRM, seats: 0 })).status).toBe(400);
    expect((await post({ action: 'set_plan', entityId: FIRM, seats: 9999 })).status).toBe(400);
    expect((await post({ action: 'set_plan', entityId: 'nope', seats: 5 })).status).toBe(404);
    expect((await post({ action: 'explode', entityId: FIRM })).status).toBe(400);
    expect((await post({ action: 'set_plan', seats: 5 })).status).toBe(400);
  });
});

describe('codes', () => {
  it('returns the plaintext code once and never writes it to the audit log', async () => {
    const res = await (await post({ action: 'create_code', entityId: FIRM, seats: 10, validDays: 14 })).json();
    expect(res.ok).toBe(true);
    expect(res.code).toMatch(/^PD-/);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(res.code);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(res.code.replace(/-/g, ''));
    const detail = await (await get(`?entityId=${FIRM}`)).json();
    expect(detail.codes).toMatchObject([{ seats: 10, status: 'active' }]);
    expect(JSON.stringify(detail)).not.toContain(res.code);
    const id = detail.codes[0].id;
    expect((await (await post({ action: 'revoke_code', entityId: FIRM, codeId: id })).json()).ok).toBe(true);
    expect((await (await get(`?entityId=${FIRM}`)).json()).codes[0].status).toBe('revoked');
  });
});

describe('release and reassign', () => {
  async function planWithTwoMembers() {
    await post({ action: 'set_plan', entityId: FIRM, seats: 2, adminEmail: 'ana@zz-test-firm.com' });
    for (const [i, id] of ['ana', 'bob'].entries()) {
      addUser(db, id, `${id}@zz-test-firm.com`);
      db.tables.matchdeal_investor_members.push({
        id: `m-${id}`, user_id: id, catalog_entity_id: FIRM, status: 'active', role: id === 'ana' ? 'admin' : 'member', created_at: `2026-01-0${i + 1}`,
      });
    }
  }

  it('releases a seat (any member, even an administrator) and reassigns it to another email', async () => {
    await planWithTwoMembers();
    expect((await (await post({ action: 'reassign', entityId: FIRM, memberId: 'm-bob', toEmail: 'carla@external.com' })).json()).ok).toBe(true);
    const detail = await (await get(`?entityId=${FIRM}`)).json();
    expect(detail).toMatchObject({ used: 1, reserved: 1, free: 0 });
    expect(detail.invites).toMatchObject([{ email: 'carla@external.com' }]);
    expect((await (await post({ action: 'release', entityId: FIRM, memberId: 'm-ana' })).json()).ok).toBe(true);
    const after = await (await get(`?entityId=${FIRM}`)).json();
    expect(after.events.map((e: { event: string }) => e.event)).toContain('seat_released');
  });

  it('refuses to lower the plan under what is taken, and promotes a member to administrator', async () => {
    await planWithTwoMembers();
    expect((await post({ action: 'set_plan', entityId: FIRM, seats: 1 })).status).toBe(409);
    expect((await (await post({ action: 'promote', entityId: FIRM, memberId: 'm-bob' })).json()).ok).toBe(true);
    expect(db.tables.matchdeal_investor_members.find((m) => m.id === 'm-bob')?.role).toBe('admin');
  });
});
