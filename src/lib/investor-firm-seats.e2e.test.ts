// Prompt 904 Part C, C7 — the seat scenarios end to end, on a TEST firm (never the real Portugal
// Ventures profile): pre-assignment, claims, reservations, the limit, removal, reassignment, the
// administrator's approval of domain-matched claimants (decision 3, 09/10/2026) and the entity-bound
// code. Runs the real lib code (store, claim auto-approval, applyClaimApproval, seat checks, approve /
// decline) over the stateful fake in src/test/fake-seat-db.ts, which also MODELS the Postgres trigger and
// redeem function — so this proves the application logic; the SQL is proved by running the migration.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addUser, fakeSeatAdmin, seatDb, type SeatDb } from '@/test/fake-seat-db';

const sendEmail = vi.fn(async (..._a: unknown[]) => ({ sent: true }));
vi.mock('./resend', () => ({
  resendConfigured: true,
  sendTransactionalEmail: (...a: unknown[]) => sendEmail(...a),
  transactionalTemplate: (o: { heading: string; body: string }) => `${o.heading} ${o.body}`,
}));

import { evaluateClaimDomain } from './investor-entity-claims';
import { classifyClaim, autoApproveClaimIfEligible } from './investor-claim-auto-approval';
import { checkSeatAvailable } from './investor-seats';
import { makeSeatStore } from './investor-firm-seats-store';
import { MATCHDEAL_TIER_TO_INVESTOR_PLAN, investorSeatLimit } from './plans';
import {
  SEAT_CODE_REFUSED, cancelSeatInvite, createSeatCode, decideClaimOnPlannedFirm, endSeatPlan, inviteToSeat,
  isSeatAdminRole, judgeSeats, customSeatLimitInfo, reassignSeat, redeemSeatCode, removeSeat, revokeSeatCode,
  selfLinkRefusal, seatSummary, setSeatPlan, tierSeatLimitInfo, hashSeatCode, generateSeatCode,
} from './investor-firm-seats';
import { findRemovedFirm, resolveSeatContext } from './investor-firm-seats-guard';
import {
  approvePendingSeatClaim, declinePendingSeatClaim, listPendingSeatClaims, notifySeatAdminsOfPendingClaim,
} from './investor-seat-claims';

const FIRM = 'ent-zz-test-firm';
const DOMAIN = 'zz-test-firm.com';
const OTHER_FIRM = 'ent-zz-test-other';

function setup() {
  const db = seatDb();
  db.tables.catalog_entities.push(
    { id: FIRM, name: 'zz-test-firm', website: `https://${DOMAIN}`, email: null, is_test: true },
    { id: OTHER_FIRM, name: 'zz-test-other', website: 'https://zz-test-other.com', email: null, is_test: true },
  );
  const admin = fakeSeatAdmin(db);
  const store = makeSeatStore(admin);
  return { db, admin, store };
}
type Env = ReturnType<typeof setup>;

/** What POST /api/portal/claims does, minus the notifications: insert the claim, classify, auto-approve. */
async function claim(env: Env, entityId: string, userId: string, email: string, requestedRole: string | null = null) {
  addUser(env.db, userId, email);
  const entity = env.db.tables.catalog_entities.find((e) => e.id === entityId)!;
  const verdict = evaluateClaimDomain({ claimantEmail: email, entityWebsite: entity.website as string, entityEmail: null });
  const approvedBefore = env.db.tables.investor_entity_claims.filter((c) => c.catalog_entity_id === entityId && c.status === 'approved').length;
  const claimRow = {
    id: `claim-${env.db.seq++}`, catalog_entity_id: entityId, claimant_user_id: userId, claimant_email: email,
    status: 'pending', domain_match: verdict.domainMatch, requested_role: requestedRole,
  };
  env.db.tables.investor_entity_claims.push(claimRow);
  const classification = await classifyClaim(env.admin, { entityId, userId, email, domainMatch: verdict.domainMatch, approvedClaimCount: approvedBefore });
  const approved = await autoApproveClaimIfEligible(env.admin, {
    claimId: claimRow.id as string, entityId, userId, email, requestedRole, domainMatch: verdict.domainMatch, classification,
  });
  return { approved, classification, claimRow, verdict };
}

/** Seat a person the way the product does it: the administrator reserves, the person claims. */
async function seatPerson(env: Env, userId: string, email: string, entityId = FIRM) {
  const reserved = await inviteToSeat(env.store, { entityId, email, actor: 'bo' });
  expect(reserved.ok, `reserve ${email}`).toBe(true);
  const r = await claim(env, entityId, userId, email);
  expect(r.approved, `claim ${email}`).toBe(true);
  return r;
}

const members = (db: SeatDb, entity = FIRM) => db.tables.matchdeal_investor_members.filter((m) => m.catalog_entity_id === entity && m.status === 'active');
const memberOf = (db: SeatDb, userId: string, entity = FIRM) => db.tables.matchdeal_investor_members.find((m) => m.catalog_entity_id === entity && m.user_id === userId);
const claimRow = (db: SeatDb, id: string) => db.tables.investor_entity_claims.find((c) => c.id === id)!;

beforeEach(() => sendEmail.mockClear());

describe('C2 — the SQL limit and the TypeScript limit agree', () => {
  it('migration 0285 tier numbers equal plans.ts (the numbers are duplicated on purpose; this pins them)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0285_investor_seat_limit.sql'), 'utf8');
    const m = /case p_tier when 'tier_a' then (\d+) when 'tier_b' then (\d+) when 'tier_c' then (\d+) else (\d+) end/.exec(sql);
    expect(m).not.toBeNull();
    const [, a, b, c, fallback] = m!.map(Number) as unknown as number[];
    expect(a).toBe(investorSeatLimit(MATCHDEAL_TIER_TO_INVESTOR_PLAN.tier_a));
    expect(b).toBe(investorSeatLimit(MATCHDEAL_TIER_TO_INVESTOR_PLAN.tier_b));
    expect(c).toBe(investorSeatLimit(MATCHDEAL_TIER_TO_INVESTOR_PLAN.tier_c));
    expect(fallback).toBe(a);
  });

  it('the new migration reads the custom number from the same table the TypeScript reads, and the trigger uses it', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261009130000_investor_firm_seat_plans.sql'), 'utf8');
    expect(sql).toMatch(/function public\.matchdeal_firm_seat_limit/);
    expect(sql).toMatch(/select sp\.seats from public\.investor_firm_seat_plans sp/);
    expect(sql).toMatch(/v_limit := public\.matchdeal_firm_seat_limit\(new\.catalog_entity_id\)/);
    expect(sql).toMatch(/if tg_op = 'UPDATE' and old\.status = 'active' then\s+return new;/);
  });

  it('every event type the code writes is allowed by the migration CHECK', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261009130000_investor_firm_seat_plans.sql'), 'utf8');
    const allowed = new Set([...(/event\s+text\s+not null check \(event in \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    const written = new Set<string>();
    for (const f of ['investor-firm-seats.ts', 'investor-seat-claims.ts', 'investor-firm-seats-store.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/lib', f), 'utf8');
      for (const m of src.matchAll(/recordEvent\([^,]+,\s*'([a-z_]+)'/g)) written.add(m[1]);
    }
    expect(written.size).toBeGreaterThan(5);
    for (const e of written) expect(allowed.has(e), `event '${e}' missing from the CHECK`).toBe(true);
  });

  it('judgeSeats names the plan, the number and what to do', () => {
    const custom = customSeatLimitInfo({ catalogEntityId: FIRM, planName: 'Private Detective', seats: 10, tier: 'tier_c', adminEmail: null });
    expect(judgeSeats(custom, 9).allowed).toBe(true);
    const blocked = judgeSeats(custom, 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('Private Detective');
    expect(blocked.reason).toContain('10 seats');
    expect(blocked.reason).toContain('Remove a member or cancel an invite');
    const tier = judgeSeats(tierSeatLimitInfo('pro_scout', 'Pro Scout'), 1);
    expect(tier.reason).toContain('Pro Scout');
    expect(tier.reason).not.toContain('Remove a member');
  });

  it('admin role = owner or admin, nothing else', () => {
    expect(isSeatAdminRole('owner')).toBe(true);
    expect(isSeatAdminRole('admin')).toBe(true);
    for (const r of ['manager', 'member', null, undefined, '']) expect(isSeatAdminRole(r as string)).toBe(false);
  });
});

describe('C7 — pre-assignment by the back-office (a test firm with 10 seats, the administrator included)', () => {
  it('the plan exists BEFORE anyone has claimed the profile', async () => {
    const env = setup();
    expect((await setSeatPlan(env.store, { entityId: FIRM, seats: 10, adminEmail: `ana@${DOMAIN}`, actor: 'backoffice-1' })).ok).toBe(true);
    expect(members(env.db)).toHaveLength(0);
    expect(await env.store.getPlan(FIRM)).toMatchObject({ seats: 10, planName: 'Private Detective', tier: 'tier_c' });
  });

  it('the administrator named by the back-office is approved at once and seated as admin', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 10, adminEmail: `ana@${DOMAIN}`, actor: 'bo' });
    const r = await claim(env, FIRM, 'u-ana', `ana@${DOMAIN}`);
    expect(r.verdict.domainMatch).toBe(true);
    expect(r.approved).toBe(true);
    expect(memberOf(env.db, 'u-ana')).toMatchObject({ status: 'active', role: 'admin' });
    expect(await resolveSeatContext(env.admin, { id: 'u-ana', email: `ana@${DOMAIN}` })).toMatchObject({ entityId: FIRM, isAdmin: true, plan: { seats: 10 } });
  });

  it('administrator + 9 reserved = 10 seats; the 10th reservation is blocked with the explanation, the claims of the 9 are approved at once', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 10, adminEmail: `ana@${DOMAIN}`, actor: 'bo' });
    await claim(env, FIRM, 'u-ana', `ana@${DOMAIN}`);
    for (let i = 1; i <= 9; i++) {
      expect((await inviteToSeat(env.store, { entityId: FIRM, email: `ev${i}@external.com`, actor: 'u-ana' })).ok, `reserve ${i}`).toBe(true);
    }
    const tenth = await inviteToSeat(env.store, { entityId: FIRM, email: 'ev10@external.com', actor: 'u-ana' });
    expect(tenth).toMatchObject({ ok: false, status: 409 });
    expect((tenth as { error: string }).error).toContain('Private Detective');
    expect((tenth as { error: string }).error).toContain('Remove a member or cancel an invite');
    expect(await seatSummary(env.store, FIRM, tierSeatLimitInfo('pro_scout', 'Pro Scout'))).toMatchObject({ limit: 10, used: 1, reserved: 9, free: 0 });
    for (let i = 1; i <= 9; i++) expect((await claim(env, FIRM, `u-ev${i}`, `ev${i}@external.com`)).approved, `claim ${i}`).toBe(true);
    expect(members(env.db)).toHaveLength(10);
  });

  it('a reserved seat is kept for its email: nobody else can take it, the invited person can, even without the firm domain', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 2, adminEmail: `ana@${DOMAIN}`, actor: 'bo' });
    await claim(env, FIRM, 'u-ana', `ana@${DOMAIN}`);
    await inviteToSeat(env.store, { entityId: FIRM, email: 'guest@external.com', actor: 'u-ana' });
    // A colleague with the firm's domain waits for the administrator — and the administrator cannot give away the reserved seat.
    const colleague = await claim(env, FIRM, 'u-col', `col@${DOMAIN}`);
    expect(colleague.approved).toBe(false);
    const refused = await approvePendingSeatClaim(env.admin, { entityId: FIRM, claimId: colleague.claimRow.id as string, actorUserId: 'u-ana' });
    expect(refused).toMatchObject({ ok: false, status: 409 });
    expect((refused as { error: string }).error).toContain('2 seats');
    // The invited external evaluator is approved at once, consuming the reservation.
    const guest = await claim(env, FIRM, 'u-guest', 'GUEST@external.com');
    expect(guest.verdict.domainMatch).toBe(false);
    expect(guest.approved).toBe(true);
    expect(await env.store.openInvites(FIRM)).toHaveLength(0);
    expect(members(env.db)).toHaveLength(2);
  });

  it('the database trigger is the backstop: even a write that skips the app check cannot exceed the plan', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 2, actor: 'bo' });
    await seatPerson(env, 'u-1', `a@${DOMAIN}`);
    await seatPerson(env, 'u-2', `b@${DOMAIN}`);
    const { error } = await env.admin.from('matchdeal_investor_members')
      .upsert({ user_id: 'u-3', catalog_entity_id: FIRM, status: 'active' }, { onConflict: 'user_id,catalog_entity_id' }).select('id').single();
    expect(error?.code).toBe('23514');
    expect(members(env.db)).toHaveLength(2);
  });

  it('removal: membership inactive, account and firm data untouched, history kept, and they cannot walk back in', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 3, adminEmail: `ana@${DOMAIN}`, actor: 'bo' });
    await claim(env, FIRM, 'u-ana', `ana@${DOMAIN}`);
    await seatPerson(env, 'u-bob', `bob@${DOMAIN}`);
    const bob = memberOf(env.db, 'u-bob')!;
    const ana = memberOf(env.db, 'u-ana')!;

    const removed = await removeSeat(env.store, { entityId: FIRM, memberId: bob.id as string, actor: 'u-ana', actorMemberId: ana.id as string });
    expect(removed.ok).toBe(true);
    expect(memberOf(env.db, 'u-bob')).toMatchObject({ status: 'revoked' });
    expect(env.db.users.get('u-bob')).toBeDefined();
    expect(env.db.tables.investor_seat_events.filter((e) => e.member_id === bob.id).map((e) => e.event)).toEqual(['seat_granted', 'seat_released']);
    expect(env.db.tables.investor_seat_events.find((e) => e.event === 'seat_released')).toMatchObject({ actor_user_id: 'u-ana' });

    expect(await findRemovedFirm(env.admin, 'u-bob')).toEqual({ entityId: FIRM, entityName: 'zz-test-firm' });
    expect(await findRemovedFirm(env.admin, 'u-ana')).toBeNull();
    expect(await resolveSeatContext(env.admin, { id: 'u-bob', email: `bob@${DOMAIN}` })).toBeNull();

    // No self-linking back (even with the firm's domain), and a new claim waits instead of being approved.
    expect(await selfLinkRefusal(env.store, { entityId: FIRM, userId: 'u-bob', email: `bob@${DOMAIN}`, domainVerified: true })).toContain('removed by its administrator');
    const again = await claim(env, FIRM, 'u-bob', `bob@${DOMAIN}`);
    expect(again.approved).toBe(false);
    expect(again.classification.planned.reason).toBe('removed_member');

    // A new reservation is the way back.
    await inviteToSeat(env.store, { entityId: FIRM, email: `bob@${DOMAIN}`, actor: 'u-ana' });
    expect((await claim(env, FIRM, 'u-bob', `bob@${DOMAIN}`)).approved).toBe(true);
    expect(memberOf(env.db, 'u-bob')).toMatchObject({ status: 'active' });
  });

  it('an administrator cannot remove their own seat, nor the last administrator', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 3, adminEmail: `ana@${DOMAIN}`, actor: 'bo' });
    await claim(env, FIRM, 'u-ana', `ana@${DOMAIN}`);
    await seatPerson(env, 'u-bob', `bob@${DOMAIN}`);
    const ana = memberOf(env.db, 'u-ana')!;
    expect(await removeSeat(env.store, { entityId: FIRM, memberId: ana.id as string, actor: 'u-ana', actorMemberId: ana.id as string })).toMatchObject({ ok: false, status: 400 });
    expect((await removeSeat(env.store, { entityId: FIRM, memberId: ana.id as string, actor: 'bo' })).ok).toBe(true);
  });

  it('reassign: free a seat and keep it for another email in one step; the number never exceeds the plan', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 2, adminEmail: `ana@${DOMAIN}`, actor: 'bo' });
    await claim(env, FIRM, 'u-ana', `ana@${DOMAIN}`);
    await seatPerson(env, 'u-bob', `bob@${DOMAIN}`);
    const bob = memberOf(env.db, 'u-bob')!;
    expect((await reassignSeat(env.store, { entityId: FIRM, memberId: bob.id as string, toEmail: 'carla@external.com', actor: 'bo' })).ok).toBe(true);
    expect(members(env.db)).toHaveLength(1);
    expect(await env.store.openInvites(FIRM)).toMatchObject([{ email: 'carla@external.com' }]);
    expect((await claim(env, FIRM, 'u-carla', 'carla@external.com')).approved).toBe(true);
    expect(members(env.db)).toHaveLength(2);
    expect((await inviteToSeat(env.store, { entityId: FIRM, email: 'x@external.com', actor: 'bo' })).ok).toBe(false);
  });

  it('cancelling an invite gives the seat back', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 1, actor: 'bo' });
    await inviteToSeat(env.store, { entityId: FIRM, email: 'a@external.com', actor: 'bo' });
    expect((await inviteToSeat(env.store, { entityId: FIRM, email: 'b@external.com', actor: 'bo' })).ok).toBe(false);
    const [inv] = await env.store.openInvites(FIRM);
    expect((await cancelSeatInvite(env.store, { entityId: FIRM, inviteId: inv.id, actor: 'bo' })).ok).toBe(true);
    expect((await inviteToSeat(env.store, { entityId: FIRM, email: 'b@external.com', actor: 'bo' })).ok).toBe(true);
  });

  it('the plan cannot be lowered under what is taken, and ending it returns the firm to its tier', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 5, actor: 'bo' });
    for (let i = 1; i <= 3; i++) await seatPerson(env, `u-${i}`, `m${i}@${DOMAIN}`);
    expect(await setSeatPlan(env.store, { entityId: FIRM, seats: 2, actor: 'bo' })).toMatchObject({ ok: false, status: 409 });
    expect(members(env.db)).toHaveLength(3);
    expect((await setSeatPlan(env.store, { entityId: FIRM, seats: 3, actor: 'bo' })).ok).toBe(true);
    expect((await endSeatPlan(env.store, { entityId: FIRM, actor: 'bo' })).ok).toBe(true);
    expect(await env.store.getPlan(FIRM)).toBeNull();
    expect((await checkSeatAvailable(env.admin, FIRM, 'u-new', 'new@x.com')).allowed).toBe(false);
  });

  it('the history says who holds each seat since when, and every change', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 3, adminEmail: `ana@${DOMAIN}`, actor: 'bo' });
    await claim(env, FIRM, 'u-ana', `ana@${DOMAIN}`);
    const summary = await seatSummary(env.store, FIRM, tierSeatLimitInfo('pro_scout', 'Pro Scout'));
    expect(summary.members).toMatchObject([{ email: `ana@${DOMAIN}`, role: 'admin' }]);
    expect(summary.members[0].since).toBeTruthy();
    const events = (await env.store.events(FIRM, 20)).map((e) => e.event);
    expect(events).toContain('plan_set');
    expect(events).toContain('seat_granted');
  });
});

describe('decision 3 — a domain match alone does not approve anybody on a firm with a plan', () => {
  async function planned(seats = 3) {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats, adminEmail: `ana@${DOMAIN}`, actor: 'bo' });
    await claim(env, FIRM, 'u-ana', `ana@${DOMAIN}`);
    return env;
  }

  it('the claimant with the firm domain and no reservation is left PENDING for the administrator, not approved and not a dispute', async () => {
    const env = await planned();
    const r = await claim(env, FIRM, 'u-col', `col@${DOMAIN}`);
    expect(r.verdict.domainMatch).toBe(true);
    expect(r.approved).toBe(false);
    expect(r.classification.planned.reason).toBe('awaiting_firm_admin');
    expect(r.classification.isDispute).toBe(false);
    expect(claimRow(env.db, r.claimRow.id as string).status).toBe('pending');
    expect(memberOf(env.db, 'u-col')).toBeUndefined();
    expect(members(env.db)).toHaveLength(1);
  });

  it('the administrator sees who is waiting, and a claimant WITHOUT the firm domain is not put in front of them (the back-office decides that one)', async () => {
    const env = await planned();
    await claim(env, FIRM, 'u-col', `col@${DOMAIN}`);
    const stranger = await claim(env, FIRM, 'u-x', 'someone@elsewhere.com');
    expect(stranger.classification.planned.reason).toBe('no_domain_match_or_invite');
    const waiting = await listPendingSeatClaims(env.admin, FIRM);
    expect(waiting.map((c) => c.claimantEmail)).toEqual([`col@${DOMAIN}`]);
  });

  it('the administrators are told by email — the administrators only, never the claimant or an ordinary member', async () => {
    const env = await planned();
    await seatPerson(env, 'u-bob', `bob@${DOMAIN}`);
    const n = await notifySeatAdminsOfPendingClaim(env.admin, { entityId: FIRM, entityName: 'zz-test-firm', claimantEmail: `col@${DOMAIN}` });
    expect(n).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(mail.to).toBe(`ana@${DOMAIN}`);
    expect(mail.subject).toContain(`col@${DOMAIN}`);
    expect(mail.html).toContain('without your approval');
  });

  it('accepting takes a seat within the number, approves the claim, tells the claimant, and records who accepted', async () => {
    const env = await planned();
    const r = await claim(env, FIRM, 'u-col', `col@${DOMAIN}`);
    sendEmail.mockClear();
    expect(await approvePendingSeatClaim(env.admin, { entityId: FIRM, claimId: r.claimRow.id as string, actorUserId: 'u-ana' })).toEqual({ ok: true });
    expect(memberOf(env.db, 'u-col')).toMatchObject({ status: 'active', role: 'member' });
    expect(claimRow(env.db, r.claimRow.id as string)).toMatchObject({ status: 'approved', resolved_by: 'u-ana' });
    expect((sendEmail.mock.calls[0][0] as { to: string }).to).toBe(`col@${DOMAIN}`);
    expect((await env.store.events(FIRM, 20)).find((e) => e.event === 'claim_approved')).toMatchObject({ actorUserId: 'u-ana' });
    expect(await listPendingSeatClaims(env.admin, FIRM)).toHaveLength(0);
  });

  it('accepting past the number is blocked with the explanation, and the claim stays pending', async () => {
    const env = await planned(2);
    await seatPerson(env, 'u-bob', `bob@${DOMAIN}`);
    const r = await claim(env, FIRM, 'u-col', `col@${DOMAIN}`);
    const res = await approvePendingSeatClaim(env.admin, { entityId: FIRM, claimId: r.claimRow.id as string, actorUserId: 'u-ana' });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect((res as { error: string }).error).toContain('Private Detective');
    expect((res as { error: string }).error).toContain('2 seats');
    expect(claimRow(env.db, r.claimRow.id as string).status).toBe('pending');
    expect(members(env.db)).toHaveLength(2);
  });

  it('declining rejects the claim and tells the claimant; nothing else changes', async () => {
    const env = await planned();
    const r = await claim(env, FIRM, 'u-col', `col@${DOMAIN}`);
    sendEmail.mockClear();
    expect(await declinePendingSeatClaim(env.admin, { entityId: FIRM, claimId: r.claimRow.id as string, actorUserId: 'u-ana' })).toEqual({ ok: true });
    expect(claimRow(env.db, r.claimRow.id as string)).toMatchObject({ status: 'rejected', resolved_by: 'u-ana' });
    expect(memberOf(env.db, 'u-col')).toBeUndefined();
    expect((sendEmail.mock.calls[0][0] as { to: string }).to).toBe(`col@${DOMAIN}`);
    expect((await env.store.events(FIRM, 20)).some((e) => e.event === 'claim_declined')).toBe(true);
  });

  it('an administrator cannot touch a claim of another firm, nor one that is not waiting for them', async () => {
    const env = await planned();
    await setSeatPlan(env.store, { entityId: OTHER_FIRM, seats: 3, actor: 'bo' });
    const other = await claim(env, OTHER_FIRM, 'u-o', 'o@zz-test-other.com');
    expect(await approvePendingSeatClaim(env.admin, { entityId: FIRM, claimId: other.claimRow.id as string, actorUserId: 'u-ana' })).toMatchObject({ ok: false, status: 404 });
    const outsider = await claim(env, FIRM, 'u-x', 'someone@elsewhere.com'); // no domain match: not theirs to decide
    expect(await approvePendingSeatClaim(env.admin, { entityId: FIRM, claimId: outsider.claimRow.id as string, actorUserId: 'u-ana' })).toMatchObject({ ok: false, status: 404 });
    expect(await declinePendingSeatClaim(env.admin, { entityId: FIRM, claimId: 'nope', actorUserId: 'u-ana' })).toMatchObject({ ok: false, status: 404 });
  });

  it('a removed member who claims again with the firm domain also waits for the administrator (who may accept)', async () => {
    const env = await planned();
    await seatPerson(env, 'u-bob', `bob@${DOMAIN}`);
    await removeSeat(env.store, { entityId: FIRM, memberId: memberOf(env.db, 'u-bob')!.id as string, actor: 'u-ana' });
    const again = await claim(env, FIRM, 'u-bob', `bob@${DOMAIN}`);
    expect(again.approved).toBe(false);
    expect((await listPendingSeatClaims(env.admin, FIRM)).map((c) => c.claimantEmail)).toEqual([`bob@${DOMAIN}`]);
    expect((await approvePendingSeatClaim(env.admin, { entityId: FIRM, claimId: again.claimRow.id as string, actorUserId: 'u-ana' })).ok).toBe(true);
    expect(memberOf(env.db, 'u-bob')).toMatchObject({ status: 'active' });
  });

  it('self-linking: a reservation or the named administrator may link themselves; the firm domain alone may not', async () => {
    const env = await planned();
    await inviteToSeat(env.store, { entityId: FIRM, email: 'guest@external.com', actor: 'u-ana' });
    expect(await selfLinkRefusal(env.store, { entityId: FIRM, userId: 'u-g', email: 'guest@external.com', domainVerified: false })).toBeNull();
    expect(await selfLinkRefusal(env.store, { entityId: FIRM, userId: 'u-new', email: `ana@${DOMAIN}`, domainVerified: true })).toBeNull(); // the named administrator
    const byDomain = await selfLinkRefusal(env.store, { entityId: FIRM, userId: 'u-col', email: `col@${DOMAIN}`, domainVerified: true });
    expect(byDomain).toContain('Claim the profile instead');
    expect(byDomain).toContain('administrator will be asked');
    expect(await selfLinkRefusal(env.store, { entityId: FIRM, userId: 'u-x', email: 'x@elsewhere.com', domainVerified: false })).toContain('Ask its administrator');
  });
});

describe('a firm WITHOUT a plan is not changed', () => {
  it('the first claim with the domain is approved; a second claimant is still a dispute and still waits for a human', async () => {
    const env = setup();
    expect((await claim(env, FIRM, 'u-1', `a@${DOMAIN}`)).approved).toBe(true);
    const second = await claim(env, FIRM, 'u-2', `b@${DOMAIN}`);
    expect(second.classification.isPlanned).toBe(false);
    expect(second.classification.isDispute).toBe(true);
    expect(second.approved).toBe(false);
    expect(members(env.db)).toHaveLength(1);
    // nobody is asked to approve it on the firm's behalf: there is no custom plan, so no seat administrator
    expect(second.classification.planned.reason).toBe('no_plan');
  });

  it('the 1-seat tier still blocks a second seat (the 0285 rule)', async () => {
    const env = setup();
    await claim(env, FIRM, 'u-1', `a@${DOMAIN}`);
    expect((await checkSeatAvailable(env.admin, FIRM, 'u-2', `b@${DOMAIN}`)).allowed).toBe(false);
  });

  it('decideClaimOnPlannedFirm answers "no_plan" so the legacy rule applies', async () => {
    const env = setup();
    expect(await decideClaimOnPlannedFirm(env.store, { entityId: FIRM, email: `a@${DOMAIN}`, domainMatch: true })).toMatchObject({ reason: 'no_plan', autoApprove: false });
  });
});

describe('entity-bound promo code', () => {
  async function firmWithClaimant() {
    const env = setup();
    await claim(env, FIRM, 'u-owner', `owner@${DOMAIN}`); // no plan yet: first claim, 1-seat tier
    await claim(env, OTHER_FIRM, 'u-other', 'someone@zz-test-other.com');
    addUser(env.db, 'u-stranger', 'stranger@elsewhere.com');
    return env;
  }

  it('the right claimant activates the plan; the code is shown once and only its hash is stored', async () => {
    const env = await firmWithClaimant();
    const created = await createSeatCode(env.store, { entityId: FIRM, seats: 10, validDays: 30, actor: 'bo', now: new Date(env.db.clock) });
    expect(created.ok).toBe(true);
    const code = (created as { code: string }).code;
    expect(code).toMatch(/^PD-[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    const stored = env.db.tables.investor_seat_codes[0];
    expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, ''));
    expect(stored.code_hash).toBe(hashSeatCode(code));
    const redeemed = await redeemSeatCode(env.store, { code: code.toLowerCase().replace(/-/g, ' '), userId: 'u-owner' });
    expect(redeemed).toMatchObject({ ok: true, catalogEntityId: FIRM, seats: 10 });
    expect(await env.store.getPlan(FIRM)).toMatchObject({ seats: 10, adminEmail: `owner@${DOMAIN}` });
    expect(memberOf(env.db, 'u-owner')).toMatchObject({ role: 'admin' });
    // The plan is real: nine more fit now (the owner holds one), the 10th reservation is refused.
    for (let i = 2; i <= 10; i++) await seatPerson(env, `u-${i}`, `m${i}@${DOMAIN}`);
    expect((await inviteToSeat(env.store, { entityId: FIRM, email: 'm11@external.com', actor: 'bo' })).ok).toBe(false);
  });

  it('a forwarded code does nothing: another account, an account on another profile, nobody at all', async () => {
    const env = await firmWithClaimant();
    const { code } = await createSeatCode(env.store, { entityId: FIRM, seats: 10, actor: 'bo', now: new Date(env.db.clock) }) as { code: string };
    for (const userId of ['u-stranger', 'u-other', 'nobody']) {
      expect(await redeemSeatCode(env.store, { code, userId }), userId).toEqual({ ok: false, status: 400, error: SEAT_CODE_REFUSED });
    }
    expect(await env.store.getPlan(FIRM)).toBeNull();
    expect(env.db.tables.investor_seat_codes[0].status).toBe('active');
  });

  it('single use: after it was redeemed it is dead, for everyone', async () => {
    const env = await firmWithClaimant();
    const { code } = await createSeatCode(env.store, { entityId: FIRM, seats: 10, actor: 'bo', now: new Date(env.db.clock) }) as { code: string };
    expect((await redeemSeatCode(env.store, { code, userId: 'u-owner' })).ok).toBe(true);
    expect(await redeemSeatCode(env.store, { code, userId: 'u-owner' })).toMatchObject({ ok: false, error: SEAT_CODE_REFUSED });
    await seatPerson(env, 'u-2', `m2@${DOMAIN}`);
    expect(await redeemSeatCode(env.store, { code, userId: 'u-2' })).toMatchObject({ ok: false });
  });

  it('revoked by the back-office: refused, and the refusal is the same as for a wrong code', async () => {
    const env = await firmWithClaimant();
    const { code } = await createSeatCode(env.store, { entityId: FIRM, seats: 10, actor: 'bo', now: new Date(env.db.clock) }) as { code: string };
    const id = env.db.tables.investor_seat_codes[0].id as string;
    expect((await revokeSeatCode(env.store, { entityId: FIRM, codeId: id, actor: 'bo' })).ok).toBe(true);
    const revoked = await redeemSeatCode(env.store, { code, userId: 'u-owner' });
    const wrong = await redeemSeatCode(env.store, { code: generateSeatCode(), userId: 'u-owner' });
    expect(revoked).toEqual(wrong);
    expect(await env.store.getPlan(FIRM)).toBeNull();
    const second = await createSeatCode(env.store, { entityId: FIRM, seats: 5, actor: 'bo', now: new Date(env.db.clock) }) as { code: string };
    await redeemSeatCode(env.store, { code: second.code, userId: 'u-owner' });
    expect((await revokeSeatCode(env.store, { entityId: FIRM, codeId: env.db.tables.investor_seat_codes[1].id as string, actor: 'bo' })).ok).toBe(false);
  });

  it('expired: refused', async () => {
    const env = await firmWithClaimant();
    const longAgo = new Date(env.db.clock - 90 * 86_400_000);
    const { code } = await createSeatCode(env.store, { entityId: FIRM, seats: 10, validDays: 30, actor: 'bo', now: longAgo }) as { code: string };
    expect(await redeemSeatCode(env.store, { code, userId: 'u-owner' })).toMatchObject({ ok: false, error: SEAT_CODE_REFUSED });
    expect(await env.store.getPlan(FIRM)).toBeNull();
  });

  it('a removed member cannot redeem (no active seat), nor can a claim that is still pending', async () => {
    const env = await firmWithClaimant();
    const { code } = await createSeatCode(env.store, { entityId: FIRM, seats: 10, actor: 'bo', now: new Date(env.db.clock) }) as { code: string };
    await removeSeat(env.store, { entityId: FIRM, memberId: memberOf(env.db, 'u-owner')!.id as string, actor: 'bo' });
    expect(await redeemSeatCode(env.store, { code, userId: 'u-owner' })).toMatchObject({ ok: false });
    env.db.tables.investor_entity_claims.push({ id: 'c-p', catalog_entity_id: FIRM, claimant_user_id: 'u-stranger', status: 'pending' });
    expect(await redeemSeatCode(env.store, { code, userId: 'u-stranger' })).toMatchObject({ ok: false });
  });

  it('input is validated before anything is stored', async () => {
    const env = await firmWithClaimant();
    expect(await createSeatCode(env.store, { entityId: FIRM, seats: 0, actor: 'bo' })).toMatchObject({ ok: false, status: 400 });
    expect(await createSeatCode(env.store, { entityId: FIRM, seats: 501, actor: 'bo' })).toMatchObject({ ok: false });
    expect(await createSeatCode(env.store, { entityId: FIRM, seats: 5, validDays: 0, actor: 'bo' })).toMatchObject({ ok: false });
    expect(env.db.tables.investor_seat_codes).toHaveLength(0);
    expect(await redeemSeatCode(env.store, { code: 'abc', userId: 'u-owner' })).toMatchObject({ ok: false });
  });
});

describe('C4 — who is allowed', () => {
  it('on a planned firm the context says admin or not from the seat role', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 5, adminEmail: `ana@${DOMAIN}`, actor: 'bo' });
    await claim(env, FIRM, 'u-ana', `ana@${DOMAIN}`);
    await seatPerson(env, 'u-bob', `bob@${DOMAIN}`);
    expect((await resolveSeatContext(env.admin, { id: 'u-ana' }))?.isAdmin).toBe(true);
    expect((await resolveSeatContext(env.admin, { id: 'u-bob' }))?.isAdmin).toBe(false);
  });

  it('naming an existing member as administrator on the plan promotes them at once', async () => {
    const env = setup();
    await setSeatPlan(env.store, { entityId: FIRM, seats: 5, actor: 'bo' });
    await seatPerson(env, 'u-bob', `bob@${DOMAIN}`);
    expect((await resolveSeatContext(env.admin, { id: 'u-bob' }))?.isAdmin).toBe(false);
    await setSeatPlan(env.store, { entityId: FIRM, seats: 5, adminEmail: `bob@${DOMAIN}`, actor: 'bo' });
    expect((await resolveSeatContext(env.admin, { id: 'u-bob' }))?.isAdmin).toBe(true);
  });
});
