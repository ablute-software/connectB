// Prompt 904, Adenda 1 (v2) — the back-office side of seats, end to end over the stateful fake database:
//   · "Add a person by email": an account that exists, one that does not, and a plan with no free seat;
//   · Approve / Decline of requests waiting, done by the back-office;
//   · the shorter code (PD-XXXX-XXXX) and the long ones that were already issued, typed any way;
//   · deleting a code that was never used, refusing one that was;
//   · ending a plan: the archive row with who held a seat, a new plan on the same firm, two ended plans;
//   · the "added to a firm" notice.
// The SQL itself (end_investor_seat_plan, the CHECK, the backfill) was proved by the dry run in production.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addUser, fakeSeatAdmin, seatDb, type SeatDb } from '@/test/fake-seat-db';

const sendEmail = vi.fn(async (..._a: unknown[]) => ({ sent: true }));
vi.mock('./resend', () => ({
  resendConfigured: true,
  sendTransactionalEmail: (...a: unknown[]) => sendEmail(...a),
  transactionalTemplate: (o: { heading: string; body: string }) => `${o.heading} ${o.body}`,
}));

import { makeSeatStore } from './investor-firm-seats-store';
import {
  SEAT_CODE_REFUSED, createSeatCode, deleteSeatCode, endSeatPlan, generateSeatCode, hashSeatCode, normalizeSeatCode,
  redeemSeatCode, revokeSeatCode, seatCodeCandidates, seatSummary, setSeatPlan, tierSeatLimitInfo,
} from './investor-firm-seats';
import { addPersonToFirm, approvePendingSeatClaim, declinePendingSeatClaim, listPendingSeatClaims } from './investor-seat-claims';

const FIRM = 'ent-zz-test-firm';
const BO = 'bo-1';
const DOMAIN = 'zz-test-firm.com';

function setup() {
  const db = seatDb();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', website: `https://${DOMAIN}`, email: null, is_test: true });
  const admin = fakeSeatAdmin(db);
  const store = makeSeatStore(admin);
  addUser(db, BO, 'bo@sherlock.test');
  return { db, admin, store };
}
type Env = ReturnType<typeof setup>;

/** Seat someone the way the product does: an insert on matchdeal_investor_members (the trigger logs and enforces). */
async function seat(env: Env, userId: string, role = 'member', name: string | null = null) {
  addUser(env.db, userId, `${userId}@${DOMAIN}`);
  const { data } = await env.admin.from('matchdeal_investor_members')
    .insert({ user_id: userId, catalog_entity_id: FIRM, status: 'active', role }).select('id').single();
  if (name) env.db.tables.matchdeal_profiles.push({ membership_id: (data as { id: string }).id, kind: 'investor', representative_name: name });
  return (data as { id: string }).id;
}

const memberRows = (db: SeatDb, userId: string) => db.tables.matchdeal_investor_members.filter((m) => m.user_id === userId && m.catalog_entity_id === FIRM);
const claimsOf = (db: SeatDb, userId: string) => db.tables.investor_entity_claims.filter((c) => c.claimant_user_id === userId);
const events = (db: SeatDb, event: string) => db.tables.investor_seat_events.filter((e) => e.event === event);

beforeEach(() => sendEmail.mockClear());

describe('Add a person by email', () => {
  it('an account that exists becomes an active member now, manual, with an approved claim in the admin\'s name and a history entry', async () => {
    const env = setup();
    addUser(env.db, 'u-ana', 'Ana@External.com');
    await setSeatPlan(env.store, { entityId: FIRM, seats: 3, actor: BO });

    const r = await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: '  ANA@external.com ', actor: BO });
    expect(r).toMatchObject({ ok: true, outcome: 'added', emailSent: true });

    expect(memberRows(env.db, 'u-ana')).toMatchObject([{ status: 'active', verification_method: 'manual', role: 'member' }]);
    expect(claimsOf(env.db, 'u-ana')).toMatchObject([{ status: 'approved', resolved_by: BO, verification_method: 'manual', claimant_email: 'ana@external.com' }]);
    // The seat itself says who gave it, and the history says it was added directly.
    expect(events(env.db, 'seat_granted').find((e) => e.user_id === 'u-ana')).toMatchObject({ actor_user_id: BO, detail: { via: 'backoffice_add' } });
    expect(events(env.db, 'claim_approved')).toMatchObject([{ actor_user_id: BO, detail: { email: 'ana@external.com', via: 'backoffice_add' } }]);
    const summary = await seatSummary(env.store, FIRM, tierSeatLimitInfo('pro_scout', 'Pro Scout'));
    expect(summary).toMatchObject({ used: 1, reserved: 0, free: 2 });
  });

  it('tells them, by email and on the platform', async () => {
    const env = setup();
    addUser(env.db, 'u-ana', 'ana@external.com');
    await setSeatPlan(env.store, { entityId: FIRM, seats: 3, actor: BO });
    await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: 'ana@external.com', actor: BO });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'ana@external.com', subject: expect.stringContaining("You've been added to zz-test-firm on") });
    expect(await env.store.unseenNotices('ana@external.com')).toHaveLength(1);
    expect(await env.store.unseenNotices('someone-else@external.com')).toEqual([]);
  });

  it('an email with no account reserves a seat, exactly as "Reserve seat" does, and still tells them', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 3, actor: BO });
    const r = await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: 'new.person+membro1@gmail.com', actor: BO });
    expect(r).toMatchObject({ ok: true, outcome: 'reserved', emailSent: true });
    expect(env.db.tables.investor_firm_seat_invites).toMatchObject([{ email: 'new.person+membro1@gmail.com', status: 'open', invited_by: BO }]);
    expect(env.db.tables.matchdeal_investor_members).toHaveLength(0);
    expect(env.db.tables.investor_entity_claims).toHaveLength(0);
    expect(events(env.db, 'invite_created')).toHaveLength(1);
    expect(await env.store.unseenNotices('new.person+membro1@gmail.com')).toHaveLength(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'new.person+membro1@gmail.com' });
    expect((await seatSummary(env.store, FIRM, tierSeatLimitInfo('pro_scout', 'Pro Scout')))).toMatchObject({ used: 0, reserved: 1, free: 2 });
  });

  it('with no free seat it blocks with the plan\'s own sentence, for an account and for a stranger alike, and writes nothing', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 1, actor: BO });
    await seat(env, 'u-holder', 'admin');
    addUser(env.db, 'u-ana', 'ana@external.com');
    const before = JSON.stringify(env.db.tables);
    for (const email of ['ana@external.com', 'stranger@nowhere.com']) {
      const r = await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email, actor: BO });
      expect(r, email).toMatchObject({ ok: false, status: 409 });
      expect((r as { error: string }).error).toContain('Private Detective');
      expect((r as { error: string }).error).toContain('1 seat');
      expect((r as { error: string }).error).toContain('Remove a member or cancel an invite');
    }
    expect(JSON.stringify(env.db.tables)).toBe(before);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a seat reserved for the very same email is the one it uses, not a second one', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 1, actor: BO });
    await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: 'later@external.com', actor: BO }); // reserves; plan now full
    addUser(env.db, 'u-later', 'later@external.com');
    const r = await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: 'later@external.com', actor: BO });
    expect(r).toMatchObject({ ok: true, outcome: 'added' });
    expect(env.db.tables.investor_firm_seat_invites).toMatchObject([{ status: 'accepted', accepted_user_id: 'u-later' }]);
    expect((await seatSummary(env.store, FIRM, tierSeatLimitInfo('pro_scout', 'Pro Scout')))).toMatchObject({ used: 1, reserved: 0, free: 0 });
  });

  it('reuses a claim the person already has pending (no duplicate), and refuses someone who already has a seat', async () => {
    const env = setup();
    addUser(env.db, 'u-ana', 'ana@external.com');
    await setSeatPlan(env.store, { entityId: FIRM, seats: 3, actor: BO });
    env.db.tables.investor_entity_claims.push({ id: 'claim-pending', catalog_entity_id: FIRM, claimant_user_id: 'u-ana', claimant_email: 'ana@external.com', status: 'pending', domain_match: false, requested_role: 'Partner' });
    expect((await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: 'ana@external.com', actor: BO })).ok).toBe(true);
    expect(claimsOf(env.db, 'u-ana')).toMatchObject([{ id: 'claim-pending', status: 'approved', resolved_by: BO }]);
    expect(await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: 'ana@external.com', actor: BO })).toMatchObject({ ok: false, status: 409 });
  });

  it('needs a plan on the firm, and a real email', async () => {
    const env = setup();
    expect(await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: 'ana@external.com', actor: BO })).toMatchObject({ ok: false, status: 400 });
    await setSeatPlan(env.store, { entityId: FIRM, seats: 3, actor: BO });
    expect(await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: 'not-an-email', actor: BO })).toMatchObject({ ok: false, status: 400 });
    expect(env.db.tables.matchdeal_investor_members).toHaveLength(0);
  });

  it('a person the administrator removed earlier can be added back by the back-office', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 3, actor: BO });
    await seat(env, 'u-ana');
    await env.store.revokeMember(FIRM, memberRows(env.db, 'u-ana')[0].id as string);
    const r = await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: `u-ana@${DOMAIN}`, actor: BO });
    expect(r).toMatchObject({ ok: true, outcome: 'added' });
    expect(memberRows(env.db, 'u-ana')).toHaveLength(1);
    expect(memberRows(env.db, 'u-ana')[0]).toMatchObject({ status: 'active', verification_method: 'manual' });
  });
});

describe('Requests waiting, decided by the back-office', () => {
  const pending = (env: Env, id: string, userId: string) => {
    addUser(env.db, userId, `${userId}@${DOMAIN}`);
    env.db.tables.investor_entity_claims.push({ id, catalog_entity_id: FIRM, claimant_user_id: userId, claimant_email: `${userId}@${DOMAIN}`, status: 'pending', domain_match: true, requested_role: null });
  };

  it('Approve seats them and the history says it was the back-office; the person is told', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 2, actor: BO });
    pending(env, 'c1', 'u-1');
    expect(await listPendingSeatClaims(env.admin, FIRM)).toMatchObject([{ id: 'c1', claimantEmail: `u-1@${DOMAIN}` }]);
    const r = await approvePendingSeatClaim(env.admin, { entityId: FIRM, claimId: 'c1', actorUserId: BO, via: 'backoffice' });
    expect(r.ok).toBe(true);
    expect(memberRows(env.db, 'u-1')).toMatchObject([{ status: 'active' }]);
    expect(claimsOf(env.db, 'u-1')).toMatchObject([{ status: 'approved', resolved_by: BO }]);
    expect(events(env.db, 'claim_approved')).toMatchObject([{ actor_user_id: BO, detail: { via: 'backoffice' } }]);
    expect(sendEmail.mock.calls.some((c) => (c[0] as { to: string }).to === `u-1@${DOMAIN}`)).toBe(true);
    expect(await listPendingSeatClaims(env.admin, FIRM)).toEqual([]);
  });

  it('Approve past the number is refused with the plan\'s reason and the request stays waiting', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 1, actor: BO });
    await seat(env, 'u-holder', 'admin');
    pending(env, 'c1', 'u-1');
    const r = await approvePendingSeatClaim(env.admin, { entityId: FIRM, claimId: 'c1', actorUserId: BO, via: 'backoffice' });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(memberRows(env.db, 'u-1')).toHaveLength(0);
    expect(await listPendingSeatClaims(env.admin, FIRM)).toHaveLength(1);
  });

  it('Decline rejects, tells the person, and gives no seat', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 2, actor: BO });
    pending(env, 'c1', 'u-1');
    expect((await declinePendingSeatClaim(env.admin, { entityId: FIRM, claimId: 'c1', actorUserId: BO, via: 'backoffice' })).ok).toBe(true);
    expect(claimsOf(env.db, 'u-1')).toMatchObject([{ status: 'rejected', resolved_by: BO }]);
    expect(memberRows(env.db, 'u-1')).toHaveLength(0);
    expect(events(env.db, 'claim_declined')).toMatchObject([{ actor_user_id: BO, detail: { via: 'backoffice' } }]);
    expect(await approvePendingSeatClaim(env.admin, { entityId: FIRM, claimId: 'c1', actorUserId: BO })).toMatchObject({ ok: false, status: 404 });
  });

  it('a claim on another firm is not reachable from this one', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 2, actor: BO });
    addUser(env.db, 'u-x', 'x@elsewhere.com');
    env.db.tables.investor_entity_claims.push({ id: 'c-other', catalog_entity_id: 'ent-other', claimant_user_id: 'u-x', claimant_email: 'x@elsewhere.com', status: 'pending', domain_match: true });
    expect(await approvePendingSeatClaim(env.admin, { entityId: FIRM, claimId: 'c-other', actorUserId: BO })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('The shorter code', () => {
  it('is PD- and 8 characters from an alphabet with no 0, O, 1 or I, in two groups of four', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateSeatCode();
      expect(code).toMatch(/^PD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(code.slice(3)).not.toMatch(/[01OI]/);
    }
    expect(new Set(Array.from({ length: 200 }, generateSeatCode)).size).toBe(200);
  });

  it('is normalised: hyphens, spaces and case do not matter', () => {
    expect(normalizeSeatCode('pd-abcd-efgh')).toBe('PDABCDEFGH');
    expect(normalizeSeatCode(' PD ABCD EFGH ')).toBe('PDABCDEFGH');
    expect(hashSeatCode('pd-abcd-efgh')).toBe(hashSeatCode('PDABCDEFGH'));
    expect(seatCodeCandidates('abcd-efgh').map(normalizeSeatCode)).toEqual(['PDABCDEFGH', 'ABCDEFGH']);
  });

  /** A firm whose owner holds an approved claim and a seat, which is what a code requires. */
  async function firmWithOwner() {
    const env = setup();
    addUser(env.db, 'u-owner', `owner@${DOMAIN}`);
    env.db.tables.investor_entity_claims.push({ id: 'c-owner', catalog_entity_id: FIRM, claimant_user_id: 'u-owner', claimant_email: `owner@${DOMAIN}`, status: 'approved', domain_match: true });
    await env.admin.from('matchdeal_investor_members').insert({ user_id: 'u-owner', catalog_entity_id: FIRM, status: 'active', role: 'member' });
    return env;
  }

  it('is accepted however it is typed: with or without hyphens, any case, even without the PD', async () => {
    for (const typed of [(c: string) => c, (c: string) => c.toLowerCase(), (c: string) => c.replace(/-/g, ''), (c: string) => c.toLowerCase().replace(/-/g, ' '), (c: string) => c.slice(3), (c: string) => c.slice(3).replace('-', '').toLowerCase()]) {
      const env = await firmWithOwner();
      const { code } = await createSeatCode(env.store, { entityId: FIRM, seats: 10, actor: BO, now: new Date(env.db.clock) }) as { code: string };
      const r = await redeemSeatCode(env.store, { code: typed(code), userId: 'u-owner' });
      expect(r, typed(code)).toMatchObject({ ok: true, catalogEntityId: FIRM, seats: 10 });
    }
  });

  it('a code issued in the old long format is still valid', async () => {
    const env = await firmWithOwner();
    const old = 'PD-K7M2Q-9XWRT-4HNVB-3DJPC';
    env.db.tables.investor_seat_codes.push({
      id: 'old-1', code_hash: hashSeatCode(old), code_hint: 'DJPC', catalog_entity_id: FIRM, seats: 7, tier: 'tier_c', plan_name: 'Private Detective',
      status: 'active', expires_at: new Date(env.db.clock + 86_400_000).toISOString(), created_at: new Date(env.db.clock).toISOString(),
    });
    expect(await redeemSeatCode(env.store, { code: old.toLowerCase().replace(/-/g, ''), userId: 'u-owner' })).toMatchObject({ ok: true, seats: 7 });
  });

  it('a wrong or too-short code is refused with the same sentence as always', async () => {
    const env = await firmWithOwner();
    for (const code of ['', 'PD-ABC', 'x', generateSeatCode(), 'A'.repeat(60)]) {
      expect(await redeemSeatCode(env.store, { code, userId: 'u-owner' }), code).toEqual({ ok: false, status: 400, error: SEAT_CODE_REFUSED });
    }
  });

  it('the plan a code activates does not inherit the seats of an older plan that already ended', async () => {
    const env = await firmWithOwner();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 10, actor: BO });
    await endSeatPlan(env.store, { entityId: FIRM, actor: BO });
    const { code } = await createSeatCode(env.store, { entityId: FIRM, seats: 3, actor: BO, now: new Date(env.db.clock) }) as { code: string };
    expect((await redeemSeatCode(env.store, { code, userId: 'u-owner' })).ok).toBe(true);
    expect(await env.store.getPlan(FIRM)).toMatchObject({ seats: 3 });
  });
});

describe('Deleting codes', () => {
  async function firmWithCodes() {
    const env = setup();
    addUser(env.db, 'u-owner', `owner@${DOMAIN}`);
    env.db.tables.investor_entity_claims.push({ id: 'c-owner', catalog_entity_id: FIRM, claimant_user_id: 'u-owner', claimant_email: `owner@${DOMAIN}`, status: 'approved' });
    await env.admin.from('matchdeal_investor_members').insert({ user_id: 'u-owner', catalog_entity_id: FIRM, status: 'active', role: 'member' });
    const make = async () => (await createSeatCode(env.store, { entityId: FIRM, seats: 5, actor: BO, now: new Date(env.db.clock) }) as { code: string }).code;
    const [activeCode, revokedCode, usedCode] = [await make(), await make(), await make()];
    const idOf = (code: string) => env.db.tables.investor_seat_codes.find((c) => c.code_hash === hashSeatCode(code))!.id as string;
    await revokeSeatCode(env.store, { entityId: FIRM, codeId: idOf(revokedCode), actor: BO });
    await redeemSeatCode(env.store, { code: usedCode, userId: 'u-owner' });
    return { env, ids: { active: idOf(activeCode), revoked: idOf(revokedCode), used: idOf(usedCode) } };
  }

  it('an unused code, active or revoked, is deleted, and the history says who deleted it and when', async () => {
    const { env, ids } = await firmWithCodes();
    for (const id of [ids.active, ids.revoked]) {
      expect((await deleteSeatCode(env.store, { entityId: FIRM, codeId: id, actor: BO })).ok).toBe(true);
      expect(env.db.tables.investor_seat_codes.some((c) => c.id === id)).toBe(false);
    }
    const deleted = events(env.db, 'code_deleted');
    expect(deleted).toHaveLength(2);
    expect(deleted[0]).toMatchObject({ actor_user_id: BO, catalog_entity_id: FIRM });
    expect(deleted[0].created_at).toBeTruthy();
    expect(deleted.map((e) => (e.detail as { wasState: string }).wasState).sort()).toEqual(['active', 'revoked']);
    // The hint is kept so the line can be told apart; the code itself never was stored.
    expect(JSON.stringify(deleted)).not.toMatch(/PD-/);
  });

  it('a used code is refused: it is the proof of how the firm got its seats', async () => {
    const { env, ids } = await firmWithCodes();
    const r = await deleteSeatCode(env.store, { entityId: FIRM, codeId: ids.used, actor: BO });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as { error: string }).error).toContain('used');
    expect(env.db.tables.investor_seat_codes.some((c) => c.id === ids.used)).toBe(true);
    expect(events(env.db, 'code_deleted')).toHaveLength(0);
    // Even if the check above were raced, the delete itself refuses a redeemed row.
    expect(await env.store.deleteCode(FIRM, ids.used)).toBe(false);
    expect(env.db.tables.investor_seat_codes.some((c) => c.id === ids.used)).toBe(true);
  });

  it('a code of another firm, or one that does not exist, is not found', async () => {
    const { env, ids } = await firmWithCodes();
    expect(await deleteSeatCode(env.store, { entityId: 'ent-other', codeId: ids.active, actor: BO })).toMatchObject({ ok: false, status: 404 });
    expect(await deleteSeatCode(env.store, { entityId: FIRM, codeId: 'nope', actor: BO })).toMatchObject({ ok: false, status: 404 });
    expect(env.db.tables.investor_seat_codes).toHaveLength(3);
  });

  it('an expired code that was never used may be deleted too', async () => {
    const env = setup();
    const { code } = await createSeatCode(env.store, { entityId: FIRM, seats: 5, validDays: 1, actor: BO, now: new Date(env.db.clock - 90 * 86_400_000) }) as { code: string };
    const id = env.db.tables.investor_seat_codes.find((c) => c.code_hash === hashSeatCode(code))!.id as string;
    expect((await deleteSeatCode(env.store, { entityId: FIRM, codeId: id, actor: BO, now: new Date(env.db.clock) })).ok).toBe(true);
    expect(events(env.db, 'code_deleted')[0].detail).toMatchObject({ wasState: 'expired' });
  });
});

describe('Ending a plan keeps it', () => {
  it('writes the archive row with who held a seat, role and since; removes nobody; the history has it once', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 5, adminEmail: `ana@${DOMAIN}`, actor: BO, note: 'for the Portugal test' });
    await seat(env, 'ana', 'admin', 'Ana Silva');
    await seat(env, 'bob', 'member');
    await addPersonToFirm(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', email: 'reserved@external.com', actor: BO }); // a reservation is not a seat

    const r = await endSeatPlan(env.store, { entityId: FIRM, actor: BO });
    expect(r).toMatchObject({ ok: true });

    const archive = await env.store.listArchive(FIRM);
    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatchObject({
      entityId: FIRM, planName: 'Private Detective', seats: 5, adminEmail: `ana@${DOMAIN}`, activatedVia: 'backoffice', endedBy: BO, reconstructed: false,
    });
    expect(archive[0].members).toMatchObject([
      { userId: 'ana', email: `ana@${DOMAIN}`, name: 'Ana Silva', role: 'admin' },
      { userId: 'bob', email: `bob@${DOMAIN}`, name: null, role: 'member' },
    ]);
    expect(archive[0].members.every((m) => !!m.since)).toBe(true);
    expect(archive[0].planCreatedAt).toBeTruthy();
    expect(archive[0].endedAt >= archive[0].planCreatedAt).toBe(true);

    expect(await env.store.getPlan(FIRM)).toBeNull();
    expect(env.db.tables.matchdeal_investor_members.filter((m) => m.status === 'active')).toHaveLength(2); // nobody removed
    expect(events(env.db, 'plan_ended')).toMatchObject([{ actor_user_id: BO, detail: { seats: 5, members: 2 } }]);
  });

  it('ending twice, or a firm with no plan, says so and archives nothing more', async () => {
    const env = setup();
    expect(await endSeatPlan(env.store, { entityId: FIRM, actor: BO })).toMatchObject({ ok: false, status: 404 });
    await setSeatPlan(env.store, { entityId: FIRM, seats: 2, actor: BO });
    expect((await endSeatPlan(env.store, { entityId: FIRM, actor: BO })).ok).toBe(true);
    expect(await endSeatPlan(env.store, { entityId: FIRM, actor: BO })).toMatchObject({ ok: false, status: 404 });
    expect(await env.store.listArchive(FIRM)).toHaveLength(1);
  });

  it('a NEW plan on the same firm does not erase the archived one, and two ended plans both show', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 2, planName: 'First', actor: BO });
    await seat(env, 'ana', 'admin');
    await endSeatPlan(env.store, { entityId: FIRM, actor: BO });
    const firstEnded = (await env.store.listArchive(FIRM))[0];

    // A new plan: a new life, with its own beginning.
    env.db.clock += 3_600_000;
    await setSeatPlan(env.store, { entityId: FIRM, seats: 6, planName: 'Second', actor: BO });
    const live = env.db.tables.investor_firm_seat_plans.find((p) => p.catalog_entity_id === FIRM)!;
    expect(live).toMatchObject({ status: 'active', seats: 6, plan_name: 'Second' });
    expect(String(live.created_at) > firstEnded.endedAt).toBe(true);
    expect(await env.store.listArchive(FIRM)).toHaveLength(1);
    expect((await env.store.listArchive(FIRM))[0]).toMatchObject({ id: firstEnded.id, planName: 'First', seats: 2 });

    await seat(env, 'bob');
    await seat(env, 'carl');
    await endSeatPlan(env.store, { entityId: FIRM, actor: 'bo-2' });
    const both = await env.store.listArchive(FIRM);
    expect(both).toHaveLength(2);
    expect(both.map((a) => a.planName)).toEqual(['Second', 'First']); // newest first
    expect(both[0].members.map((m) => m.userId)).toEqual(['ana', 'bob', 'carl']);
    expect(both[1].members.map((m) => m.userId)).toEqual(['ana']); // the first snapshot is untouched
    expect(both[0].endedBy).toBe('bo-2');
    expect(await env.store.listArchive('ent-other')).toEqual([]);
    expect(await env.store.listArchive()).toHaveLength(2);
  });
});

describe('The "added to a firm" notice', () => {
  it('is shown once to the address it was left for, and gone after it is marked seen', async () => {
    const env = setup();
    await env.store.addNotice('ana@external.com', FIRM, BO);
    await env.store.addNotice('ana@external.com', FIRM, BO);
    const first = await env.store.unseenNotices('ana@external.com');
    expect(first).toHaveLength(2);
    expect(await env.store.unseenNotices('bob@external.com')).toEqual([]);
    await env.store.markNoticesSeen('bob@external.com', first.map((n) => n.id)); // somebody else's address changes nothing
    expect(await env.store.unseenNotices('ana@external.com')).toHaveLength(2);
    await env.store.markNoticesSeen('ana@external.com', [first[0].id]);
    expect(await env.store.unseenNotices('ana@external.com')).toHaveLength(1);
    await env.store.markNoticesSeen('ana@external.com', []);
    expect(await env.store.unseenNotices('ana@external.com')).toHaveLength(1);
  });
});
