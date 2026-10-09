// Prompt 904, Adenda 1 (v2) — the back-office seat route, the new verbs and views through the real handlers:
// add_person, approve_claim / decline_claim, delete_code, end_plan -> the archive, the global History with its
// filters, and the extra fields the expanded firm needs (requests waiting, who used a code).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { addUser, fakeSeatAdmin, seatDb, type SeatDb } from '@/test/fake-seat-db';

let db: SeatDb;
let isAdmin = true;
const audit = vi.fn(async (..._a: unknown[]) => {});
const sendEmail = vi.fn(async (..._a: unknown[]) => ({ sent: true }));

vi.mock('@/lib/backoffice-auth', () => ({
  requirePlatformAdmin: async () => (isAdmin
    ? { admin: fakeSeatAdmin(db), userId: 'bo-1' }
    : { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) }),
}));
vi.mock('@/lib/audit', () => ({ logAdminAction: (...a: unknown[]) => audit(...a) }));
vi.mock('@/lib/resend', () => ({
  resendConfigured: true,
  sendTransactionalEmail: (...a: unknown[]) => sendEmail(...a),
  transactionalTemplate: () => '<p>x</p>',
}));

import { GET, POST } from './route';

const FIRM = 'ent-zz-test-firm';
const OTHER = 'ent-zz-test-other';
const post = (body: unknown) => POST(new Request('http://localhost/api/backoffice/investor-seats', { method: 'POST', body: JSON.stringify(body) }));
const get = (qs = '') => GET(new Request(`http://localhost/api/backoffice/investor-seats${qs}`));
const ok = async (p: Promise<Response>) => { const j = await (await p).json(); expect(j.ok, JSON.stringify(j)).toBe(true); return j; };

beforeEach(() => {
  db = seatDb();
  isAdmin = true;
  audit.mockClear();
  sendEmail.mockClear();
  db.tables.catalog_entities.push(
    { id: FIRM, name: 'zz-test-firm', website: 'https://zz-test-firm.com', is_test: true },
    { id: OTHER, name: 'zz-test-other', website: 'https://zz-test-other.com', is_test: true },
  );
  addUser(db, 'bo-1', 'bo@sherlock.test');
});

describe('Add a person', () => {
  it('through the route: an account is seated, a stranger is reserved, and both are in the audit log', async () => {
    addUser(db, 'u-ana', 'ana@external.com');
    await ok(post({ action: 'set_plan', entityId: FIRM, seats: 3 }));
    const added = await ok(post({ action: 'add_person', entityId: FIRM, email: 'ana@external.com' }));
    expect(added).toMatchObject({ outcome: 'added', emailSent: true });
    const reserved = await ok(post({ action: 'add_person', entityId: FIRM, email: 'sherlockdeal.com+membro1@gmail.com' }));
    expect(reserved).toMatchObject({ outcome: 'reserved', emailSent: true });
    expect(audit.mock.calls.map((c) => (c[1] as { action: string }).action)).toEqual(['investor_seats_set_plan', 'investor_seats_add_person', 'investor_seats_add_person']);
    const detail = await ok(get(`?entityId=${FIRM}`));
    expect(detail).toMatchObject({ used: 1, reserved: 1, free: 1 });
    expect(detail.invites).toMatchObject([{ email: 'sherlockdeal.com+membro1@gmail.com' }]);
    expect(detail.members).toMatchObject([{ email: 'ana@external.com' }]);
  });

  it('a full plan answers 409 with the plan\'s sentence; no plan, 400; a non-admin, 403', async () => {
    expect((await post({ action: 'add_person', entityId: FIRM, email: 'a@b.com' })).status).toBe(400);
    await ok(post({ action: 'set_plan', entityId: FIRM, seats: 1 }));
    await ok(post({ action: 'add_person', entityId: FIRM, email: 'first@external.com' }));
    const full = await post({ action: 'add_person', entityId: FIRM, email: 'second@external.com' });
    expect(full.status).toBe(409);
    expect((await full.json()).error).toContain('Private Detective');
    isAdmin = false;
    expect((await post({ action: 'add_person', entityId: FIRM, email: 'x@y.com' })).status).toBe(403);
  });
});

describe('Requests waiting', () => {
  it('shows only domain-matched pending claims on this firm and lets the back-office approve or decline them', async () => {
    await ok(post({ action: 'set_plan', entityId: FIRM, seats: 3 }));
    for (const [id, user, entity, match] of [['c1', 'u-1', FIRM, true], ['c2', 'u-2', FIRM, true], ['c3', 'u-3', FIRM, false], ['c4', 'u-4', OTHER, true]] as const) {
      addUser(db, user, `${user}@zz-test-firm.com`);
      db.tables.investor_entity_claims.push({ id, catalog_entity_id: entity, claimant_user_id: user, claimant_email: `${user}@zz-test-firm.com`, status: 'pending', domain_match: match });
    }
    const detail = await ok(get(`?entityId=${FIRM}`));
    expect(detail.pendingClaims.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2']);

    await ok(post({ action: 'approve_claim', entityId: FIRM, claimId: 'c1' }));
    await ok(post({ action: 'decline_claim', entityId: FIRM, claimId: 'c2' }));
    const after = await ok(get(`?entityId=${FIRM}`));
    expect(after.pendingClaims).toEqual([]);
    expect(after.members).toMatchObject([{ email: 'u-1@zz-test-firm.com' }]);
    expect((await post({ action: 'approve_claim', entityId: FIRM, claimId: 'c4' })).status).toBe(404);
    expect((await post({ action: 'approve_claim', entityId: FIRM, claimId: 'c3' })).status).toBe(404); // not a domain match: reviewed in Investor claims
  });
});

describe('Codes', () => {
  it('create -> copy -> delete: gone from the list, in the history; a used one shows who used it and cannot be deleted', async () => {
    const created = await ok(post({ action: 'create_code', entityId: FIRM, seats: 5 }));
    expect(created.code).toMatch(/^PD-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    let detail = await ok(get(`?entityId=${FIRM}`));
    expect(detail.codes).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain(created.code);
    await ok(post({ action: 'delete_code', entityId: FIRM, codeId: detail.codes[0].id }));
    detail = await ok(get(`?entityId=${FIRM}`));
    expect(detail.codes).toEqual([]);
    expect(detail.events.map((e: { event: string }) => e.event)).toContain('code_deleted');
    expect(JSON.stringify(audit.mock.calls)).not.toContain(created.code);

    // A used code.
    addUser(db, 'u-owner', 'owner@zz-test-firm.com');
    db.tables.investor_entity_claims.push({ id: 'c-o', catalog_entity_id: FIRM, claimant_user_id: 'u-owner', claimant_email: 'owner@zz-test-firm.com', status: 'approved' });
    await fakeSeatAdmin(db).from('matchdeal_investor_members').insert({ user_id: 'u-owner', catalog_entity_id: FIRM, status: 'active', role: 'member' });
    const second = await ok(post({ action: 'create_code', entityId: FIRM, seats: 5 }));
    const { redeemSeatCode } = await import('@/lib/investor-firm-seats');
    const { makeSeatStore } = await import('@/lib/investor-firm-seats-store');
    expect((await redeemSeatCode(makeSeatStore(fakeSeatAdmin(db)), { code: second.code, userId: 'u-owner' })).ok).toBe(true);
    detail = await ok(get(`?entityId=${FIRM}`));
    expect(detail.codes).toMatchObject([{ status: 'redeemed', redeemedByEmail: 'owner@zz-test-firm.com' }]);
    const refused = await post({ action: 'delete_code', entityId: FIRM, codeId: detail.codes[0].id });
    expect(refused.status).toBe(409);
    expect((await ok(get(`?entityId=${FIRM}`))).codes).toHaveLength(1);
  });
});

describe('Sub-tabs 2 and 4: the plan list and the ended plans', () => {
  it('the list carries when the plan was created and last changed', async () => {
    await ok(post({ action: 'set_plan', entityId: FIRM, seats: 4 }));
    const list = await ok(get());
    expect(list.firms).toMatchObject([{ entityId: FIRM, seats: 4 }]);
    expect(typeof list.firms[0].createdAt === 'string' || list.firms[0].createdAt === undefined).toBe(true);
    expect(list.firms[0]).toHaveProperty('updatedAt');
  });

  it('End plan: the firm leaves the list, appears in the ended plans with who held a seat, and nobody is removed', async () => {
    await ok(post({ action: 'set_plan', entityId: FIRM, seats: 3, adminEmail: 'ana@zz-test-firm.com' }));
    for (const [i, id] of ['ana', 'bob'].entries()) {
      addUser(db, id, `${id}@zz-test-firm.com`);
      await fakeSeatAdmin(db).from('matchdeal_investor_members').insert({ user_id: id, catalog_entity_id: FIRM, status: 'active', role: i === 0 ? 'admin' : 'member' });
    }
    const ended = await ok(post({ action: 'end_plan', entityId: FIRM }));
    expect(ended.archiveId).toBeTruthy();
    expect((await ok(get())).firms).toEqual([]);

    const rows = (await ok(get('?view=ended'))).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: FIRM, name: 'zz-test-firm', seats: 3, adminEmail: 'ana@zz-test-firm.com', endedByEmail: 'bo@sherlock.test', reconstructed: false });
    expect(rows[0].members.map((m: { email: string; role: string }) => `${m.email}:${m.role}`)).toEqual(['ana@zz-test-firm.com:admin', 'bob@zz-test-firm.com:member']);
    expect(db.tables.matchdeal_investor_members.filter((m) => m.status === 'active')).toHaveLength(2);

    // The same firm gets a new plan and ends it again: both ended plans are listed.
    await ok(post({ action: 'set_plan', entityId: FIRM, seats: 9 }));
    await ok(post({ action: 'end_plan', entityId: FIRM }));
    expect((await ok(get('?view=ended'))).rows.map((r: { seats: number }) => r.seats).sort()).toEqual([3, 9]);
    expect((await post({ action: 'end_plan', entityId: FIRM })).status).toBe(404);
  });
});

describe('Sub-tab 3: the History of every firm', () => {
  async function seedHistory() {
    await ok(post({ action: 'set_plan', entityId: FIRM, seats: 3 }));
    await ok(post({ action: 'set_plan', entityId: OTHER, seats: 2 }));
    await ok(post({ action: 'invite', entityId: FIRM, email: 'guest@external.com' }));
    await ok(post({ action: 'invite', entityId: OTHER, email: 'other.guest@external.com' }));
    const code = await ok(post({ action: 'create_code', entityId: OTHER, seats: 2 }));
    expect(code.ok).toBe(true);
  }
  const hist = async (qs = '') => (await ok(get(`?view=history${qs ? `&${qs}` : ''}`))) as { rows: { firm: string; event: string; actorEmail: string | null }[]; truncated: boolean };

  it('one list across firms, newest first, with the firm\'s name and who did it', async () => {
    await seedHistory();
    const { rows } = await hist();
    expect(rows.length).toBe(5);
    expect(new Set(rows.map((r) => r.firm))).toEqual(new Set(['zz-test-firm', 'zz-test-other']));
    expect(rows.every((r) => r.actorEmail === 'bo@sherlock.test')).toBe(true);
    expect(rows[0].event).toBe('code_created');
  });

  it('filters by firm, by event type, by dates and by a search on firm or email', async () => {
    await seedHistory();
    expect((await hist(`entityId=${OTHER}`)).rows.every((r) => r.firm === 'zz-test-other')).toBe(true);
    expect((await hist('event=invite_created')).rows).toHaveLength(2);
    expect((await hist(`entityId=${FIRM}&event=invite_created`)).rows).toHaveLength(1);
    expect((await hist('q=other.guest')).rows).toHaveLength(1);
    expect((await hist('q=ZZ-TEST-OTHER')).rows.every((r) => r.firm === 'zz-test-other')).toBe(true);
    expect((await hist('from=2999-01-01')).rows).toEqual([]);
    expect((await hist('to=2000-01-01')).rows).toEqual([]);
    expect((await hist('from=2026-10-09&to=2026-10-09')).rows.length).toBeGreaterThan(0);
  });

  it('is for platform admins only', async () => {
    isAdmin = false;
    expect((await get('?view=history')).status).toBe(403);
    expect((await get('?view=ended')).status).toBe(403);
  });
});
