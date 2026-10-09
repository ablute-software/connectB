// Prompt 904 Part C — seats of custom plans (docs/calls/SPEC_CALLS_V2.md §9.3).
//
// The rules of "a firm with N seats", with every read/write behind `SeatStore`: the routes wire
// it to Supabase (investor-firm-seats-store.ts), the tests wire it to an in-memory world that
// also models the Postgres trigger of migration 20261009130000. A seat is an ACTIVE row of
// matchdeal_investor_members, as it has been since Prompt 497; nothing here invents a second
// notion of "seat".
//
// Vocabulary:
//  - plan      the firm-level custom plan (investor_firm_seat_plans): a number of seats and a
//              feature tier. It exists BEFORE anyone has claimed the profile (pre-assignment).
//  - invite    an email the firm's administrator has reserved a seat for. It counts against
//              the limit from the moment it is created, so the 11th invite of a 10-seat plan is
//              refused, and the invited person's later claim cannot be turned away for lack of
//              the seat that was kept for them.
//  - admin     "administrator of the entity": an ACTIVE member whose seat role is 'owner' or
//              'admin'. Chosen because the role column already exists with exactly those
//              values (migration 0145 family) and today gates nothing, so using it changes no
//              behaviour for firms without a plan. Who becomes admin is explicit: the email
//              named on the plan by the back-office, the person who redeems the entity code, or
//              whoever the back-office promotes — never "whoever claimed first".
import { createHash, randomBytes } from 'node:crypto';
import {
  MATCHDEAL_TIER_TO_INVESTOR_PLAN, investorSeatLimit, type InvestorPlanTier,
} from './plans';
import { canDeleteSeatCode, seatCodeState } from './seat-plans-view';

export const SEAT_ADMIN_ROLES = ['owner', 'admin'] as const;
export function isSeatAdminRole(role: string | null | undefined): boolean {
  return !!role && (SEAT_ADMIN_ROLES as readonly string[]).includes(role);
}

export const DEFAULT_CUSTOM_PLAN_NAME = 'Private Detective';
export const MAX_CUSTOM_SEATS = 500;
export const DEFAULT_CODE_VALIDITY_DAYS = 30;

export interface FirmSeatPlan {
  catalogEntityId: string;
  planName: string;
  seats: number;
  /** matchdeal_profiles.plan_tier vocabulary. */
  tier: string;
  adminEmail: string | null;
}

export interface SeatMember {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  role: string | null;
  /** When the seat was taken (latest seat_granted event, else the row's creation). */
  since: string | null;
}

export interface PendingSeatClaim {
  id: string; claimantUserId: string; claimantEmail: string; requestedRole: string | null; createdAt: string;
}

export interface SeatInvite { id: string; email: string; invitedBy: string | null; createdAt: string }

export interface SeatEvent {
  id: number; event: string; userId: string | null; email: string | null; actorUserId: string | null;
  detail: Record<string, unknown>; createdAt: string;
}

export interface SeatCodeRow {
  id: string; codeHint: string; seats: number; planName: string; status: 'active' | 'redeemed' | 'revoked';
  expiresAt: string; redeemedBy: string | null; redeemedAt: string | null; createdAt: string; note: string | null;
}

export interface ArchivedMember { userId: string | null; email: string | null; name: string | null; role: string | null; since: string | null }
export interface ArchivedPlan {
  id: string; entityId: string; planName: string; seats: number; tier: string; activatedVia: string; adminEmail: string | null;
  planCreatedAt: string; planChangedAt: string; endedAt: string; endedBy: string | null; members: ArchivedMember[];
  /** Rebuilt from the history for a plan that ended before the archive existed. */
  reconstructed: boolean;
}
export interface SeatNotice { id: string; entityId: string; createdAt: string }

export interface SeatStore {
  getPlan(entityId: string): Promise<FirmSeatPlan | null>;
  upsertPlan(plan: FirmSeatPlan & { activatedVia: 'backoffice' | 'promo_code'; setBy: string | null; note?: string | null }): Promise<void>;
  /** Ends the plan AND archives it (with a snapshot of who held a seat), in one transaction. null = no active plan. */
  endPlan(entityId: string, actor: string | null): Promise<{ archiveId: string } | null>;
  /** Plans that ended, newest first (the archive), optionally of one firm. */
  listArchive(entityId?: string): Promise<ArchivedPlan[]>;
  /** The account that owns this email, if any. */
  userIdByEmail(email: string): Promise<string | null>;
  /** "You have been added to X": keyed by email, shown to whoever signs in with that confirmed address. */
  addNotice(email: string, entityId: string, actor: string | null): Promise<void>;
  unseenNotices(email: string): Promise<SeatNotice[]>;
  markNoticesSeen(email: string, ids: string[]): Promise<void>;
  activeMembers(entityId: string): Promise<SeatMember[]>;
  /** Cheap: only who holds a seat (no email lookups) — for counting. */
  activeMemberUserIds(entityId: string): Promise<string[]>;
  /** Claims waiting for the firm's administrator: pending, and the claimant's email domain matches the firm's. */
  pendingClaims(entityId: string): Promise<PendingSeatClaim[]>;
  /** Users whose seat on this firm was taken away (membership 'revoked'). */
  revokedUserIds(entityId: string): Promise<string[]>;
  openInvites(entityId: string): Promise<SeatInvite[]>;
  addInvite(entityId: string, email: string, invitedBy: string | null): Promise<void>;
  cancelInvite(entityId: string, inviteId: string): Promise<boolean>;
  acceptInvite(entityId: string, email: string, userId: string): Promise<void>;
  revokeMember(entityId: string, memberId: string): Promise<boolean>;
  setMemberRole(entityId: string, memberId: string, role: string): Promise<boolean>;
  recordActor(entityId: string, memberId: string | null, actor: string | null, detail?: Record<string, unknown>): Promise<void>;
  recordEvent(entityId: string, event: string, actor: string | null, detail?: Record<string, unknown>): Promise<void>;
  events(entityId: string, limit: number): Promise<SeatEvent[]>;
  insertCode(row: { codeHash: string; codeHint: string; entityId: string; seats: number; tier: string; planName: string; expiresAt: string; createdBy: string | null; note: string | null }): Promise<void>;
  listCodes(entityId: string): Promise<SeatCodeRow[]>;
  revokeCode(entityId: string, codeId: string): Promise<boolean>;
  /** Deletes a code that was never used. A redeemed code is never deleted (it proves how the firm got its seats). */
  deleteCode(entityId: string, codeId: string): Promise<boolean>;
  redeemCode(codeHash: string, userId: string): Promise<{ ok: boolean; catalogEntityId?: string; seats?: number }>;
}

// --- Limit -----------------------------------------------------------------------------------

export interface SeatLimitInfo {
  limit: number;
  planName: string;
  /** True for a back-office custom plan; false for the 1/2/5 tiers. */
  custom: boolean;
  tier: InvestorPlanTier;
}

/** Tier-based limit for a firm WITHOUT a custom plan — the existing 1/2/5 rule, from plans.ts. */
export function tierSeatLimitInfo(tier: InvestorPlanTier, planName: string): SeatLimitInfo {
  return { limit: investorSeatLimit(tier), planName, custom: false, tier };
}

export function customSeatLimitInfo(plan: FirmSeatPlan): SeatLimitInfo {
  return {
    limit: plan.seats, planName: plan.planName, custom: true,
    tier: MATCHDEAL_TIER_TO_INVESTOR_PLAN[plan.tier] ?? 'legendary_sleuth',
  };
}

export interface SeatVerdict {
  allowed: boolean;
  limit: number;
  /** Seats already held or reserved (active members + open invites), excluding the one being asked for. */
  used: number;
  /** Seats still free before this request. */
  free: number;
  planName: string;
  custom: boolean;
  /** Plain-language reason when blocked; null when allowed. */
  reason: string | null;
}

/**
 * Pure: can one more seat be taken? `used` already includes open invites (a reserved seat is not
 * free). The message names the plan and the number and says what to do — the platform "blocks and
 * explains" (§9.3), it does not just say no.
 */
export function judgeSeats(info: SeatLimitInfo, used: number): SeatVerdict {
  const u = Math.max(0, used);
  const free = Math.max(0, info.limit - u);
  if (u < info.limit) return { allowed: true, limit: info.limit, used: u, free, planName: info.planName, custom: info.custom, reason: null };
  const what = `${info.limit} seat${info.limit === 1 ? '' : 's'}`;
  const held = `${u} ${u === 1 ? 'is' : 'are'} already in use or reserved`;
  const how = info.custom
    ? ' Remove a member or cancel an invite to free a seat, or ask Sherlock Deal to add more seats.'
    : '';
  return {
    allowed: false, limit: info.limit, used: u, free: 0, planName: info.planName, custom: info.custom,
    reason: `Your firm is on ${info.planName}, which includes ${what}, and ${held}.${how}`,
  };
}

export async function seatLimitFor(store: SeatStore, entityId: string, fallback: SeatLimitInfo): Promise<SeatLimitInfo> {
  const plan = await store.getPlan(entityId);
  return plan ? customSeatLimitInfo(plan) : fallback;
}

export interface SeatSummary {
  plan: FirmSeatPlan | null;
  limit: number;
  planName: string;
  members: SeatMember[];
  invites: SeatInvite[];
  /** Active members. */
  used: number;
  /** Seats reserved by open invites. */
  reserved: number;
  free: number;
}

export async function seatSummary(store: SeatStore, entityId: string, fallback: SeatLimitInfo): Promise<SeatSummary> {
  const [plan, members, invites] = await Promise.all([store.getPlan(entityId), store.activeMembers(entityId), store.openInvites(entityId)]);
  const info = plan ? customSeatLimitInfo(plan) : fallback;
  const reserved = plan ? invites.length : 0;
  return {
    plan, limit: info.limit, planName: info.planName, members, invites: plan ? invites : [],
    used: members.length, reserved, free: Math.max(0, info.limit - members.length - reserved),
  };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function normalizeSeatEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// --- What a claim does on a firm with a plan (C3: "the 2nd..10th claim is not left pending") ---

export interface ClaimSeatDecision {
  /** Auto-approve this claim now. */
  autoApprove: boolean;
  /** Seat role to give: the plan's named admin gets 'admin'. null = use the claim's own requested role. */
  roleOverride: 'admin' | null;
  /** The reserved invite this claim consumes, if any. */
  consumesInvite: boolean;
  /** Why it was not auto-approved, for the audit trail and the claimant's pending screen. */
  reason: 'no_plan' | 'awaiting_firm_admin' | 'no_domain_match_or_invite' | 'no_free_seat' | 'removed_member' | null;
  verdict: SeatVerdict | null;
}

/**
 * Decide a claim on a firm that has a custom plan. A firm WITHOUT a plan keeps the legacy rule in
 * /api/portal/claims untouched (`no_plan` -> the caller falls through to it).
 *
 * Differences from the legacy rule, all on purpose:
 *  - a second claimant is NOT a "dispute" on a planned firm (the plan exists so several people of the
 *    same firm are seated), but a matching domain alone approves nobody: it is `awaiting_firm_admin`;
 *  - only an invited email, or the administrator the back-office named, comes in by itself (an invited
 *    external evaluator needs no domain match).
 * What does NOT change: the email must be confirmed (checked before this is reached), the entity
 * must be claimable, and the seat limit is still enforced — in the app here and in the trigger.
 */
export async function decideClaimOnPlannedFirm(
  store: SeatStore, args: { entityId: string; email: string; domainMatch: boolean; userId?: string },
): Promise<ClaimSeatDecision> {
  const plan = await store.getPlan(args.entityId);
  if (!plan) return { autoApprove: false, roleOverride: null, consumesInvite: false, reason: 'no_plan', verdict: null };

  const email = normalizeSeatEmail(args.email);
  const [memberIds, invites] = await Promise.all([store.activeMemberUserIds(args.entityId), store.openInvites(args.entityId)]);
  const invited = invites.some((i) => i.email === email);
  const roleOverride = plan.adminEmail && normalizeSeatEmail(plan.adminEmail) === email ? 'admin' as const : null;
  // Someone the administrator removed does not walk back in on their own: only a new invite does.
  if (!invited && args.userId && (await store.revokedUserIds(args.entityId)).includes(args.userId)) {
    return { autoApprove: false, roleOverride: null, consumesInvite: false, reason: 'removed_member', verdict: null };
  }
  // Prompt 904 decision 3 (Nuno, 09/10/2026): on a firm with a custom plan a matching email domain is NOT
  // enough. Only the people the administrator reserved a seat for, and the administrator the back-office
  // named, come in by themselves; a claimant whose domain matches waits for the firm's administrator
  // (who is told, and accepts or declines in the seat management); any other claimant waits for the
  // back-office, as before.
  if (!invited && !roleOverride) {
    return {
      autoApprove: false, roleOverride: null, consumesInvite: false, verdict: null,
      reason: args.domainMatch ? 'awaiting_firm_admin' : 'no_domain_match_or_invite',
    };
  }

  // The invite that is being consumed is this person's own reservation: not counted against them.
  const reserved = invites.filter((i) => i.email !== email).length;
  const verdict = judgeSeats(customSeatLimitInfo(plan), memberIds.length + reserved);
  if (!verdict.allowed) return { autoApprove: false, roleOverride, consumesInvite: false, reason: 'no_free_seat', verdict };
  return { autoApprove: true, roleOverride, consumesInvite: invited, reason: null, verdict };
}

// --- Administrator actions (C4) and back-office actions (C6) --------------------------------

export type SeatActionResult<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export async function inviteToSeat(
  store: SeatStore, args: { entityId: string; email: string; actor: string | null },
): Promise<SeatActionResult<{ invite: 'created' }>> {
  const email = normalizeSeatEmail(args.email);
  if (!EMAIL_SHAPE.test(email)) return { ok: false, status: 400, error: 'Please enter a valid email address.' };
  const plan = await store.getPlan(args.entityId);
  if (!plan) return { ok: false, status: 400, error: 'This firm has no custom seat plan.' };

  const [members, invites] = await Promise.all([store.activeMembers(args.entityId), store.openInvites(args.entityId)]);
  if (members.some((m) => normalizeSeatEmail(m.email) === email)) return { ok: false, status: 409, error: 'That person already has a seat.' };
  if (invites.some((i) => i.email === email)) return { ok: false, status: 409, error: 'That email already has a seat reserved.' };

  const verdict = judgeSeats(customSeatLimitInfo(plan), members.length + invites.length);
  if (!verdict.allowed) return { ok: false, status: 409, error: verdict.reason ?? 'No free seats.' };

  await store.addInvite(args.entityId, email, args.actor);
  await store.recordEvent(args.entityId, 'invite_created', args.actor, { email });
  return { ok: true, invite: 'created' };
}

export async function cancelSeatInvite(
  store: SeatStore, args: { entityId: string; inviteId: string; actor: string | null },
): Promise<SeatActionResult> {
  const ok = await store.cancelInvite(args.entityId, args.inviteId);
  if (!ok) return { ok: false, status: 404, error: 'Not found.' };
  await store.recordEvent(args.entityId, 'invite_cancelled', args.actor, { inviteId: args.inviteId });
  return { ok: true };
}

/**
 * Take a member's seat away. The membership becomes inactive — the row stays (history, and the
 * "You're no longer part of X" screen needs it), the personal account is untouched, and the firm's
 * data stays with the firm because none of it is keyed to the member.
 */
export async function removeSeat(
  store: SeatStore, args: { entityId: string; memberId: string; actor: string | null; actorMemberId?: string | null },
): Promise<SeatActionResult> {
  if (args.actorMemberId && args.actorMemberId === args.memberId) {
    return { ok: false, status: 400, error: "You can't remove your own seat here. Ask another administrator, or the Sherlock Deal team." };
  }
  const members = await store.activeMembers(args.entityId);
  const target = members.find((m) => m.id === args.memberId);
  if (!target) return { ok: false, status: 404, error: 'Not found.' };
  if (isSeatAdminRole(target.role) && members.filter((m) => isSeatAdminRole(m.role)).length <= 1 && args.actorMemberId) {
    return { ok: false, status: 409, error: 'This is the only administrator of the firm. Promote someone else first.' };
  }
  const done = await store.revokeMember(args.entityId, args.memberId);
  if (!done) return { ok: false, status: 404, error: 'Not found.' };
  await store.recordActor(args.entityId, args.memberId, args.actor, { reason: 'removed' });
  return { ok: true };
}

/** Back-office: free a seat and reserve it for someone else in one step (C6, "libertar e reatribuir"). */
export async function reassignSeat(
  store: SeatStore, args: { entityId: string; memberId: string; toEmail: string; actor: string | null },
): Promise<SeatActionResult> {
  const email = normalizeSeatEmail(args.toEmail);
  if (!EMAIL_SHAPE.test(email)) return { ok: false, status: 400, error: 'Please enter a valid email address.' };
  const released = await removeSeat(store, { entityId: args.entityId, memberId: args.memberId, actor: args.actor });
  if (!released.ok) return released;
  const invited = await inviteToSeat(store, { entityId: args.entityId, email, actor: args.actor });
  if (!invited.ok) return invited;
  return { ok: true };
}

export async function setSeatPlan(
  store: SeatStore,
  args: { entityId: string; seats: number; tier?: string; planName?: string; adminEmail?: string | null; actor: string | null; note?: string | null },
): Promise<SeatActionResult<{ plan: FirmSeatPlan }>> {
  const seats = Math.floor(Number(args.seats));
  if (!Number.isFinite(seats) || seats < 1 || seats > MAX_CUSTOM_SEATS) {
    return { ok: false, status: 400, error: `Seats must be a whole number between 1 and ${MAX_CUSTOM_SEATS}.` };
  }
  const existing = await store.getPlan(args.entityId);
  const tier = args.tier ?? existing?.tier ?? 'tier_c';
  if (!['tier_a', 'tier_b', 'tier_c'].includes(tier)) return { ok: false, status: 400, error: 'Invalid tier.' };
  const adminEmail = args.adminEmail === undefined ? (existing?.adminEmail ?? null) : (args.adminEmail ? normalizeSeatEmail(args.adminEmail) : null);
  if (adminEmail && !EMAIL_SHAPE.test(adminEmail)) return { ok: false, status: 400, error: 'Administrator email is not valid.' };

  // Lowering below what is already taken would leave the firm over its limit. Existing seats are
  // never silently revoked (same stance as Prompt 497); the back-office releases them first.
  const [members, invites] = await Promise.all([store.activeMembers(args.entityId), store.openInvites(args.entityId)]);
  const taken = members.length + invites.length;
  if (existing && seats < taken) {
    return { ok: false, status: 409, error: `${taken} seats are already in use or reserved. Release ${taken - seats} first, then lower the number.` };
  }

  const plan: FirmSeatPlan = {
    catalogEntityId: args.entityId, planName: args.planName?.trim() || existing?.planName || DEFAULT_CUSTOM_PLAN_NAME,
    seats, tier, adminEmail,
  };
  await store.upsertPlan({ ...plan, activatedVia: 'backoffice', setBy: args.actor, note: args.note ?? null });
  await store.recordEvent(args.entityId, 'plan_set', args.actor, {
    seats, tier, planName: plan.planName, adminEmail, previousSeats: existing?.seats ?? null,
  });

  // The named administrator may already hold a seat: promote them now instead of waiting for a claim.
  if (adminEmail) {
    const holder = members.find((m) => normalizeSeatEmail(m.email) === adminEmail);
    if (holder && !isSeatAdminRole(holder.role)) {
      await store.setMemberRole(args.entityId, holder.id, 'admin');
      await store.recordEvent(args.entityId, 'admin_changed', args.actor, { email: adminEmail, role: 'admin' });
    }
  }
  return { ok: true, plan };
}

export async function endSeatPlan(store: SeatStore, args: { entityId: string; actor: string | null }): Promise<SeatActionResult<{ archiveId: string }>> {
  const existing = await store.getPlan(args.entityId);
  if (!existing) return { ok: false, status: 404, error: 'This firm has no custom seat plan.' };
  // One transaction in SQL: the archive row (with who held a seat right now), the status, and the history entry.
  const ended = await store.endPlan(args.entityId, args.actor);
  if (!ended) return { ok: false, status: 409, error: 'This plan was already ended.' };
  return { ok: true, archiveId: ended.archiveId };
}

export async function promoteToAdmin(
  store: SeatStore, args: { entityId: string; memberId: string; actor: string | null },
): Promise<SeatActionResult> {
  const members = await store.activeMembers(args.entityId);
  const target = members.find((m) => m.id === args.memberId);
  if (!target) return { ok: false, status: 404, error: 'Not found.' };
  await store.setMemberRole(args.entityId, args.memberId, 'admin');
  await store.recordEvent(args.entityId, 'admin_changed', args.actor, { email: target.email, role: 'admin' });
  return { ok: true };
}

// --- Entity-bound codes (C3) -----------------------------------------------------------------

/** The alphabet of a code: 32 characters, no 0, O, 1 or I (they get misread over the phone and in print). */
export const SEAT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * 8 characters of that alphabet (40 bits), shown as PD-XXXX-XXXX (Adenda 1, 09/10/2026: shorter, to be typed
 * or read out). A code is only usable by someone who already holds an approved claim and an active seat on the
 * exact profile it was made for, so 40 bits is a lock on a door that is already behind a login, and the hash
 * alone is stored. Codes issued before this, in the long format (PD-XXXXX-XXXXX-XXXXX-XXXXX), stay valid: the
 * hash is over the normalised text, which is the same function for both.
 */
export function generateSeatCode(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += SEAT_CODE_ALPHABET[bytes[i] % SEAT_CODE_ALPHABET.length];
  return `PD-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** With or without hyphens or spaces, in any case: "pd-abcd-efgh", "PDABCDEFGH" and " PD ABCD EFGH " are one code. */
export function normalizeSeatCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The texts a typed code may be the hash of. The stored hash is of the FULL code including its "PD" prefix, but
 * people copy only the 8 characters; so the typed text is tried as it is and with the prefix put back. Both
 * are refused alike when wrong (SEAT_CODE_REFUSED), so trying two says nothing about which was close.
 */
export function seatCodeCandidates(raw: string): string[] {
  const n = normalizeSeatCode(raw);
  return n.startsWith('PD') ? [n, `PD${n}`] : [`PD${n}`, n];
}

export function hashSeatCode(raw: string): string {
  return createHash('sha256').update(normalizeSeatCode(raw)).digest('hex');
}

// The list of codes (Adenda 1, point 3): pure and client-safe, so they live in seat-plans-view.ts and the page uses them too.
export { canDeleteSeatCode, filterSeatCodes, seatCodeState, type SeatCodeState } from './seat-plans-view';

export async function createSeatCode(
  store: SeatStore,
  args: { entityId: string; seats: number; validDays?: number; tier?: string; planName?: string; actor: string | null; note?: string | null; now?: Date },
): Promise<SeatActionResult<{ code: string; expiresAt: string }>> {
  const seats = Math.floor(Number(args.seats));
  if (!Number.isFinite(seats) || seats < 1 || seats > MAX_CUSTOM_SEATS) {
    return { ok: false, status: 400, error: `Seats must be a whole number between 1 and ${MAX_CUSTOM_SEATS}.` };
  }
  const days = args.validDays ?? DEFAULT_CODE_VALIDITY_DAYS;
  if (!Number.isFinite(days) || days < 1 || days > 365) return { ok: false, status: 400, error: 'Validity must be between 1 and 365 days.' };
  const code = generateSeatCode();
  const expiresAt = new Date((args.now ?? new Date()).getTime() + days * 86_400_000).toISOString();
  await store.insertCode({
    codeHash: hashSeatCode(code), codeHint: normalizeSeatCode(code).slice(-4), entityId: args.entityId, seats,
    tier: args.tier ?? 'tier_c', planName: args.planName?.trim() || DEFAULT_CUSTOM_PLAN_NAME, expiresAt,
    createdBy: args.actor, note: args.note ?? null,
  });
  await store.recordEvent(args.entityId, 'code_created', args.actor, { seats, expiresAt, codeHint: normalizeSeatCode(code).slice(-4) });
  return { ok: true, code, expiresAt };
}

export async function deleteSeatCode(store: SeatStore, args: { entityId: string; codeId: string; actor: string | null; now?: Date }): Promise<SeatActionResult> {
  const code = (await store.listCodes(args.entityId)).find((c) => c.id === args.codeId);
  if (!code) return { ok: false, status: 404, error: 'Not found.' };
  if (!canDeleteSeatCode(code)) {
    return { ok: false, status: 409, error: 'A code that was used cannot be deleted: it is the record of how this firm got its seats.' };
  }
  const state = seatCodeState(code, args.now);
  const done = await store.deleteCode(args.entityId, args.codeId);
  if (!done) return { ok: false, status: 409, error: 'That code was just used, so it can no longer be deleted.' };
  await store.recordEvent(args.entityId, 'code_deleted', args.actor, { codeHint: code.codeHint, wasState: state, seats: code.seats });
  return { ok: true };
}

export async function revokeSeatCode(store: SeatStore, args: { entityId: string; codeId: string; actor: string | null }): Promise<SeatActionResult> {
  const ok = await store.revokeCode(args.entityId, args.codeId);
  if (!ok) return { ok: false, status: 404, error: 'Not found, or already used.' };
  await store.recordEvent(args.entityId, 'code_revoked', args.actor, { codeId: args.codeId });
  return { ok: true };
}

/** One answer for every failure: wrong code, expired, revoked, used, someone else's profile. */
export const SEAT_CODE_REFUSED = "This code can't be used with your account.";

export async function redeemSeatCode(
  store: SeatStore, args: { code: string; userId: string },
): Promise<SeatActionResult<{ catalogEntityId: string; seats: number }>> {
  const normalized = normalizeSeatCode(args.code ?? '');
  // 8 characters in the new format (10 with the prefix), 20 in the old one (22 with it).
  if (normalized.length < 8 || normalized.length > 40) return { ok: false, status: 400, error: SEAT_CODE_REFUSED };
  for (const text of seatCodeCandidates(args.code)) {
    const res = await store.redeemCode(hashSeatCode(text), args.userId);
    if (res.ok && res.catalogEntityId) return { ok: true, catalogEntityId: res.catalogEntityId, seats: res.seats ?? 0 };
  }
  return { ok: false, status: 400, error: SEAT_CODE_REFUSED };
}

/**
 * Self-service linking (POST /api/portal/investor-profile/link) onto a firm with a custom plan:
 * null = fine, otherwise the sentence to show. Linking yourself is for people the firm's administrator
 * reserved a seat for (and the administrator the back-office named). Everyone else — even with the
 * firm's own email domain — claims the profile and waits for the administrator (decision 3, 09/10/2026),
 * and someone the administrator removed needs a new reservation. A firm WITHOUT a plan is not restricted.
 */
export async function selfLinkRefusal(
  store: SeatStore, args: { entityId: string; userId: string; email: string; domainVerified: boolean },
): Promise<string | null> {
  const plan = await store.getPlan(args.entityId);
  if (!plan) return null;
  if ((await store.activeMemberUserIds(args.entityId)).includes(args.userId)) return null;
  const invited = (await store.openInvites(args.entityId)).some((i) => i.email === args.email);
  if (invited) return null;
  if ((await store.revokedUserIds(args.entityId)).includes(args.userId)) {
    return 'Your access to this firm was removed by its administrator. Ask them to invite you again.';
  }
  if (plan.adminEmail && normalizeSeatEmail(plan.adminEmail) === args.email) return null;
  return args.domainVerified
    ? "This firm manages its own seats. Claim the profile instead: your firm's administrator will be asked to approve you."
    : 'This firm manages its own seats. Ask its administrator to reserve one for your email, then claim the profile.';
}
