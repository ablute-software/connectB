// Prompt 900, parts A and B — the "Closed & deleted" tab: which orgs are dead, how each one ended, who is still attached to it,
// and when each of the two actions (Reopen account, Release email) is available. Pure: no I/O, no Supabase.
//
// The SQL functions behind the actions (moderation_reopen_org, moderation_release_org_member — migration 20261013160000)
// re-check every rule below inside the same transaction as the write, so this file is NOT what keeps a refused action from
// happening. It exists so the screen can say WHY a button is off before anyone clicks it (a refusal after the click is the
// worse experience) and so each rule has one readable statement. The order of the checks matches the SQL's on purpose: the
// first reason shown is the first reason the database would give.
import { canReopen } from './account-security';

export type OrgModerationStatus = 'active' | 'suspended' | 'deleted';
export type GdprState = 'pending' | 'done';

export interface OrgLifeFacts {
  moderationStatus: OrgModerationStatus;
  closedAt: string | null;
  /** orgs.closed_reason: 'owner' | 'platform' | 'last_member_deleted' | null (close_org() itself leaves it empty). */
  closedReason: string | null;
  purgeAfter: string | null;
}

/** An org belongs in the Closed & deleted tab when it ended: closed (by anyone) or deleted by moderation. */
export function isDeadOrg(o: Pick<OrgLifeFacts, 'moderationStatus' | 'closedAt'>): boolean {
  return o.closedAt != null || o.moderationStatus === 'deleted';
}

// ── how it ended ─────────────────────────────────────────────────────────────────────────────────────────────────
export type ClosureWay = 'moderation_deleted' | 'owner_closed' | 'platform_closed' | 'last_member' | 'closed_unspecified';

export const CLOSURE_LABEL: Record<ClosureWay, string> = {
  moderation_deleted: 'Deleted by moderation',
  owner_closed: 'Closed by its owner',
  platform_closed: 'Closed by the platform',
  last_member: 'Closed when its last member was released',
  closed_unspecified: 'Closed (reason not recorded)',
};

/** One account can have ended in two ways at once (deleted by moderation, then closed when its last member was released). */
export function closureWays(o: OrgLifeFacts): ClosureWay[] {
  const ways: ClosureWay[] = [];
  if (o.moderationStatus === 'deleted') ways.push('moderation_deleted');
  if (o.closedAt) {
    ways.push(
      o.closedReason === 'owner' ? 'owner_closed'
        : o.closedReason === 'platform' ? 'platform_closed'
          : o.closedReason === 'last_member_deleted' ? 'last_member'
            : 'closed_unspecified',
    );
  }
  return ways;
}

// ── what a person attached to a dead account also holds ─────────────────────────────────────────────────────────
export interface EcosystemHat { name: string; role: string | null; status: string; /** active membership of an ecosystem organisation that is not closed */ live: boolean }
export interface InvestorHat { name: string; role: string | null; /** active seat in a firm that is neither deleted nor under an active suspension */ live: boolean }
export interface MemberHats { ecosystem: EcosystemHat[]; investor: InvestorHat[] }

/** The same two signals account_has_live_hat() reads in SQL — display only, the door itself is SQL. */
export function liveHatNames(h: MemberHats): string[] {
  return [
    ...h.ecosystem.filter((e) => e.live).map((e) => `Ecosystem — ${e.name}`),
    ...h.investor.filter((i) => i.live).map((i) => `Investor — ${i.name}`),
  ];
}

/**
 * What this account does to the person at sign-in, in words — the question the tab was asked for ("why can't she get in?").
 * Mirrors account_access_state() for the two states that trap a person in a dead account (a deleted org; an org its owner
 * closed): a live hat lets them in through it, nothing else leaves them at the door. Display only: the SQL is the truth, and
 * the rehearsal (scripts/verify-closed-deleted-900.sql) is what proves it against it.
 */
export function signInHint(o: OrgLifeFacts, m: { blocked: boolean; hats: MemberHats }): string {
  if (m.blocked) return 'E-mail on the blocked list — cannot sign in';
  // A suspension is a sanction on the person: it blocks whatever else they hold (the same rule as the SQL).
  if (o.moderationStatus === 'suspended') return 'Locked out — the account is suspended (a sanction: nothing else lets them in)';
  const trapsThem = o.moderationStatus === 'deleted' || (o.closedAt != null && o.closedReason === 'owner');
  if (!trapsThem) return 'This account does not lock them out';
  const via = liveHatNames(m.hats);
  return via.length > 0 ? `Signs in through ${via.join(' · ')}` : 'Locked out by this account — holds nothing else live';
}

// ── availability of the two actions ──────────────────────────────────────────────────────────────────────────────
export type Availability = { ok: true } | { ok: false; reason: string };
const OK: Availability = { ok: true };
const no = (reason: string): Availability => ({ ok: false, reason });
const day = (iso: string) => iso.slice(0, 10);

function gdprReason(state: GdprState): string {
  return `A member of this account is in a GDPR erasure (${state === 'pending' ? 'pending' : 'done'}) — nothing is reopened or released from it.`;
}
const BLOCKED_REASON = 'The e-mail is on the blocked list — that was decided for security and has its own screen.';

/**
 * Reopen account — only for an account deleted by moderation, not also closed, inside its retention window, with no member in a
 * GDPR erasure and no blocked e-mail among its members.
 */
export function reopenAvailability(
  o: OrgLifeFacts,
  ctx: { gdpr: GdprState | null; anyMemberBlocked: boolean },
  now: Date,
): Availability {
  if (o.moderationStatus !== 'deleted') {
    return no(o.closedAt && o.closedReason === 'owner'
      ? 'Closed by its owner, not deleted by moderation — use the owner reopen above.'
      : `Only an account deleted by moderation can be reopened — this one is ${o.closedAt ? 'closed' : o.moderationStatus}.`);
  }
  if (o.closedAt) return no(`It is also closed (since ${day(o.closedAt)}): reopening the moderation status alone would not bring it back.`);
  if (o.purgeAfter && new Date(o.purgeAfter).getTime() <= now.getTime()) return no(`The retention window ended on ${day(o.purgeAfter)}.`);
  if (ctx.gdpr) return no(gdprReason(ctx.gdpr));
  if (ctx.anyMemberBlocked) return no(`A member's e-mail is on the blocked list — that was decided for security and has its own screen.`);
  return OK;
}

/**
 * Release email — takes one person out of a dead account (the account stays dead) so their e-mail can be used in another capacity.
 * Refused while the owner can still reopen the account, for a member in a GDPR erasure, and for a blocked e-mail.
 */
export function releaseAvailability(
  o: OrgLifeFacts,
  ctx: { gdpr: GdprState | null; memberBlocked: boolean },
  now: Date,
): Availability {
  if (!isDeadOrg(o)) return no('Only a closed or deleted account can release a member.');
  if (o.closedReason === 'owner' && o.purgeAfter && new Date(o.purgeAfter).getTime() > now.getTime()) {
    return no(`Closed by its owner — the owner can still reopen it until ${day(o.purgeAfter)}. Releasing a member now would leave nothing to reopen.`);
  }
  if (ctx.gdpr) return no(gdprReason(ctx.gdpr));
  if (ctx.memberBlocked) return no(BLOCKED_REASON);
  return OK;
}

/** The owner's own undo window (Prompt 602): the existing "Reopen…" flow, now hosted in this tab. */
export function ownerReopenable(o: OrgLifeFacts, now: Date): boolean {
  return canReopen({ closedAt: o.closedAt, closedReason: o.closedReason, purgeAfter: o.purgeAfter }, now);
}

// ── what the loader returns (and the tab renders) ───────────────────────────────────────────────────────────────
export interface ClosedAccountMember {
  userId: string;
  email: string;
  role: string | null;
  emailConfirmed: boolean;
  hats: MemberHats;
  blocked: boolean;
  gdpr: GdprState | null;
  signIn: string;
  release: Availability;
}

export interface TrailEntry { at: string; action: string; by: string | null; text: string }

/** One of the two ways an account ends, with its own date, person and reason (it can have both: deleted, then closed). */
export interface EndEvent {
  at: string | null;
  /** Back-office e-mail of the admin, or the owner who closed it. */
  by: string | null;
  reason: string | null;
}

export interface ClosedAccount {
  orgId: string;
  name: string;
  isTest: boolean;
  isInternal: boolean;
  createdAt: string | null;
  moderationStatus: OrgModerationStatus;
  closedAt: string | null;
  closedReason: string | null;
  purgeAfter: string | null;
  ways: ClosureWay[];
  /** Deleted by moderation: when, by whom, and the justification written then (account_moderation_actions). */
  deleted: EndEvent | null;
  /** Closed: when, by whom (the owner, the admin, or the admin who released its last member) and, for a release, the reason. */
  closed: EndEvent | null;
  /** The sort key: when it last ended — the later of the two. */
  when: string | null;
  /** A member is in a GDPR erasure (pending or done). */
  gdprErasure: GdprState | null;
  members: ClosedAccountMember[];
  reopen: Availability;
  /** Closed by its owner and still inside the retention window: the Prompt 602 reopen applies. */
  ownerReopenable: boolean;
  daysToPurge: number | null;
  trail: TrailEntry[];
}

// ── what the routes answer when the SQL function refuses ────────────────────────────────────────────────────────
export interface RpcRefusal { code?: string | null; message: string }

/**
 * The two SQL functions refuse with an exception whose text is written for a person (their rules are re-checked there, inside the
 * transaction of the write). The routes pass that text through and only choose the HTTP status:
 *   42501                       not a platform admin                                    → 403
 *   PGRST202 / 42883            the migration is not applied yet (no such function)     → 503
 *   "a reason is required…"     → 400 · "no org…" / "…not a member…" → 404 · any other rule they state → 409
 */
export function refusalStatus(e: RpcRefusal): number {
  if (e.code === '42501') return 403;
  if (e.code === 'PGRST202' || e.code === '42883') return 503;
  if (e.code === 'P0001') {
    if (/^a reason is required/i.test(e.message)) return 400;
    if (/^no org with that id|not a member of this account/i.test(e.message)) return 404;
    return 409;
  }
  return 500;
}

export function refusalMessage(e: RpcRefusal): string {
  if (e.code === '42501') return 'Platform admin only.';
  if (e.code === 'PGRST202' || e.code === '42883') return 'Not available yet — the closed-accounts migration (20261013160000) has not been applied.';
  return e.message;
}

/** The back-office asks for who/why/channel in the same words the owner reopen does: at least a few characters. */
export const MIN_REASON_LENGTH = 4;
