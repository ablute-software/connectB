// Prompt 531 — pure moderation logic for My Network reports/strikes/appeals.
// Zero I/O, so the two things that actually matter here are testable without
// a database: the strike→ban rule (which must stay EXACTLY what 0215
// defined) and the startup-facing projection (which must never carry
// reporter data).
//
// The policy is not redefined here. It is restated in one place so the
// back-office, the strike list and the recompute-after-reversal path all
// read the same rule instead of each re-deriving `>= 3` from memory.

/** 0215's own threshold, unchanged: 3 strikes suspends My Network access —
 *  My Network only, never the SherlockDeal account (that is
 *  orgs.moderation_status, a different mechanism entirely). */
export const NETWORK_STRIKE_BAN_THRESHOLD = 3;

export type StrikeStatus = 'active' | 'reversed';
export type AppealStatus = 'pending' | 'upheld' | 'reversed';

/** What a report froze at the moment it was filed. Deliberately has no
 *  reporter field of any kind — this object is stored on the report AND
 *  shown to the reported startup, so there is nowhere for reporter data to
 *  hide in it. */
export interface ReportedContentSnapshot {
  postId: string | null;
  body: string;
  kind: string;
  structured: Record<string, string> | null;
  target: string | null;
  groupName: string | null;
  createdAt: string | null;
  authorActorId: string | null;
  authorName: string | null;
}

export function buildContentSnapshot(post: {
  id: string; body: string; kind?: string | null; structured?: Record<string, string> | null;
  target?: string | null; created_at?: string | null; author_actor_id?: string | null;
}, extra: { groupName?: string | null; authorName?: string | null } = {}): ReportedContentSnapshot {
  return {
    postId: post.id,
    body: post.body,
    kind: post.kind ?? 'freeform',
    structured: post.structured ?? null,
    target: post.target ?? null,
    groupName: extra.groupName ?? null,
    createdAt: post.created_at ?? null,
    authorActorId: post.author_actor_id ?? null,
    authorName: extra.authorName ?? null,
  };
}

/**
 * Whether My Network access should be suspended, by 0215's rule.
 *
 * Called with the CURRENT count of active (non-reversed) strikes, which is
 * what makes a reversal able to move the answer back down — the original
 * implementation incremented a counter and never had a way to undo it.
 */
export function shouldBanForStrikes(activeStrikeCount: number): boolean {
  return activeStrikeCount >= NETWORK_STRIKE_BAN_THRESHOLD;
}

/**
 * What a strike reversal should do to the ban, and — just as importantly —
 * what it should NOT do.
 *
 * Decided deliberately, and flagged rather than silently chosen: the
 * product's only existing rule is "reaching 3 strikes suspends". There has
 * never been a rule for lifting a suspension, and §15 of the request is
 * explicit that strike reversal and ban reversal are related but distinct
 * and that the existing logic is the source of truth. So a reversal that
 * drops the count below the threshold does NOT auto-lift the ban — that
 * stays an explicit moderator decision (the "Lift ban" control), because
 * inventing an auto-lift would be inventing policy.
 *
 * What it must not do either is leave that state invisible: an actor still
 * banned while below the threshold is surfaced as `banNoLongerRequired`, so
 * the Strikes tab can show "banned, but the strike count no longer requires
 * it" instead of a moderator having to notice by arithmetic.
 */
export function describeBanState(params: { activeStrikeCount: number; suspendedAt: string | null }): {
  banned: boolean;
  banRequiredByStrikes: boolean;
  banNoLongerRequired: boolean;
} {
  const banned = !!params.suspendedAt;
  const banRequiredByStrikes = shouldBanForStrikes(params.activeStrikeCount);
  return { banned, banRequiredByStrikes, banNoLongerRequired: banned && !banRequiredByStrikes };
}

// ---------------------------------------------------------------------------
// The privacy boundary.
//
// Everything above this line is shared. Everything below builds the ONLY
// shape a reported startup is ever allowed to receive.

/** Fields that must never reach the reported startup, in any response, by
 *  any route. Exported so the test can assert against the same list the
 *  projection is written against rather than a second copy of it. */
export const REPORTER_PRIVATE_FIELDS = [
  'reporterId', 'reporter_id', 'reporterName', 'reporterEmail', 'reporterOrgId', 'reporterOrgName',
  'reportReason', 'report_reason', 'reporterMessage', 'reportCategory', 'reportCount',
  'ticketId', 'ticket_id', 'reversalReason', 'decisionNote', 'internalNote',
] as const;

/** What the startup sees about a strike against it. Nothing here identifies
 *  the reporter, quotes their reason, counts how many people reported, or
 *  exposes an internal moderator note — §§21-23, 34, 39-44. Even the
 *  support-ticket id is withheld: it is a handle to the reporter's own
 *  message. */
export interface StartupStrikeView {
  strikeId: string;
  appliedAt: string;
  status: StrikeStatus;
  /** The moderation outcome in SherlockDeal's own words — never the
   *  reporter's complaint. */
  outcome: string;
  contentRemoved: boolean;
  /** The content that received the strike, from the snapshot, so it is
   *  still identifiable after the post was removed (§20, §37). */
  content: ReportedContentSnapshot | null;
  appeal: { status: AppealStatus; submittedAt: string; decidedAt: string | null } | null;
  canAppeal: boolean;
}

const OUTCOME_ACTIVE = 'SherlockDeal found this content in breach of the My Network rules.';
const OUTCOME_ACTIVE_REMOVED = 'SherlockDeal found this content in breach of the My Network rules and removed it from My Network.';
const OUTCOME_REVERSED = 'This strike was reviewed and reversed. It no longer counts against your account.';

/**
 * Projects a strike row into the startup-facing shape.
 *
 * Written as an explicit constructor of allowed fields, never as a
 * blacklist over a row: a "delete row.reporter_id" style filter silently
 * starts leaking the day someone adds a column. The input type here does not
 * even name a reporter field, so a leak would have to be added on purpose.
 */
export function toStartupStrikeView(strike: {
  id: string;
  appliedAt: string;
  status: StrikeStatus;
  contentRemoved: boolean;
  snapshot: ReportedContentSnapshot | null;
  appeal: { status: AppealStatus; createdAt: string; decidedAt: string | null } | null;
}): StartupStrikeView {
  const outcome = strike.status === 'reversed'
    ? OUTCOME_REVERSED
    : strike.contentRemoved ? OUTCOME_ACTIVE_REMOVED : OUTCOME_ACTIVE;
  return {
    strikeId: strike.id,
    appliedAt: strike.appliedAt,
    status: strike.status,
    outcome,
    contentRemoved: strike.contentRemoved,
    content: strike.snapshot,
    appeal: strike.appeal
      ? { status: strike.appeal.status, submittedAt: strike.appeal.createdAt, decidedAt: strike.appeal.decidedAt }
      : null,
    // Contest is offered once per strike, and only while it still counts.
    canAppeal: strike.status === 'active' && !strike.appeal,
  };
}

/** The one-line consequence the startup is told alongside a strike. Uses the
 *  real threshold, so it can never drift from the rule that enforces it. */
export function strikeConsequenceLine(activeStrikeCount: number, banned: boolean): string {
  if (banned) return 'Your My Network access is currently suspended. Your SherlockDeal account is not affected.';
  const remaining = NETWORK_STRIKE_BAN_THRESHOLD - activeStrikeCount;
  return remaining <= 0
    ? 'Your My Network access is under review.'
    : `${activeStrikeCount} of ${NETWORK_STRIKE_BAN_THRESHOLD} strikes. ${remaining} more would suspend your My Network access (your SherlockDeal account is not affected).`;
}
