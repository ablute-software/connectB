// Prompt 316 — My Network 1/9. Pure, mechanical rules only — same discipline
// as company-claims.ts/company-gaps.ts: nothing here calls out to a
// database or an AI model, so every rule is independently testable and
// gives the same answer twice on the same input.
//
// Two structural rules apply to the WHOLE 316-324 series, not just this
// file:
//   - Anti-spam: no connection without verifiable context — there is no
//     free-text people search anywhere in this feature.
//   - Anti-ranking: nothing here ever produces a value one founder could be
//     ranked or compared against another founder by.

export const MAX_PENDING_INVITES_PER_ACTOR = 5;
export const INVITE_EXPIRY_DAYS = 14;

// Prompt 335 §D3a — sessionStorage key the connect-link landing page
// stashes an unauthenticated opener's token under before redirecting to
// /signup; network/page.tsx reads and clears it once a session exists.
export const PENDING_CONNECT_TOKEN_KEY = 'sd_pending_connect_token';

// ---------------------------------------------------------------------------
// Canonical pair ordering for network_connections' "smaller id first"
// storage convention — one row per pair regardless of who acted first.
export function canonicalPair(actorAId: string, actorBId: string): [string, string] {
  return actorAId < actorBId ? [actorAId, actorBId] : [actorBId, actorAId];
}

// ---------------------------------------------------------------------------
// The pending-invite cap. The real enforcement lives server-side in the DB
// trigger (enforce_network_invite_pending_cap, migration 0209) — this is
// the same rule expressed as a pure predicate, so the API route can give a
// clear error BEFORE attempting the insert, and so the rule itself is
// unit-testable without a database.
export function canSendInvite(pendingCount: number): boolean {
  return pendingCount < MAX_PENDING_INVITES_PER_ACTOR;
}

// ---------------------------------------------------------------------------
// Prompt 335 §D1 — the rate cap on email-based direct invites (the cold-
// start mechanism itself). Numbers deliberately mirror rules.ts's own
// outreach caps (5/day, 20/week) — a founder's outbound-to-investors budget
// and their network-invite budget are different things that happen to use
// the same round numbers, not the same constant reused across two
// unrelated features. Same rolling-window shape as rules.ts's own
// outboundCounts: `now` is an explicit parameter so this stays pure and
// testable, midnight/Monday computed fresh from it rather than from a
// stored "period start".
export const NETWORK_DIRECT_INVITE_DAILY_CAP = 5;
export const NETWORK_DIRECT_INVITE_WEEKLY_CAP = 20;

export function emailInviteRateCounts(createdAts: string[], now: Date): { today: number; week: number } {
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const day = now.getDay(); // 0 = Sunday
  const monday = new Date(now); monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((day + 6) % 7));
  const dates = createdAts.map((c) => new Date(c));
  return {
    today: dates.filter((d) => d >= startOfDay).length,
    week: dates.filter((d) => d >= monday).length,
  };
}

export function canSendDirectInvite(counts: { today: number; week: number }): boolean {
  return counts.today < NETWORK_DIRECT_INVITE_DAILY_CAP && counts.week < NETWORK_DIRECT_INVITE_WEEKLY_CAP;
}

// ---------------------------------------------------------------------------
// Prompt 335 §D3a — a connect link auto-pauses once it's generated too many
// still-outstanding invites in the trailing week, rather than needing a
// stored "paused" flag that could go stale. Counts ALL connect_link-sourced
// invites created in the window regardless of status — a founder whose link
// got hammered by 20 people in a day shouldn't have it immediately usable
// again just because those 20 got declined; the cool-down is on generation
// volume, not on how many are still pending.
export const CONNECT_LINK_WEEKLY_PAUSE_THRESHOLD = 20;

export function connectLinkPaused(invitesGeneratedThisWeek: number): boolean {
  return invitesGeneratedThisWeek >= CONNECT_LINK_WEEKLY_PAUSE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Prompt 335 §D2 — the discoverable-founders directory. NOT an open people
// search: only rows the caller has already filtered to
// network_discoverable=true ever reach this function — it just applies the
// name/sector/geography match on top, case-insensitively, substring-based
// (never a ranked/scored result — that would violate the anti-ranking rule
// just as much as scoring connections would).
export interface DiscoverableFounderRow { orgId: string; name: string; sectors: string[]; geography: string | null }

export function searchDiscoverableFounders(rows: DiscoverableFounderRow[], query: string): DiscoverableFounderRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return rows.filter((r) =>
    r.name.toLowerCase().includes(q)
    || r.sectors.some((s) => s.toLowerCase().includes(q))
    || (r.geography ?? '').toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// "Silêncio = expira, nunca vira rejeição visível": rather than requiring a
// cron to flip the stored status (this app has no sub-daily cron capacity
// on Vercel Hobby — see CLAUDE.md), expiry is computed at read time. A
// 'pending' invite past its expires_at reads as 'expired' everywhere the
// app looks at it; the stored column only ever changes on an explicit
// accept/decline.
export function effectiveInviteStatus(
  invite: { status: 'pending' | 'accepted' | 'declined' | 'expired'; expiresAt: string },
  now: Date,
): 'pending' | 'accepted' | 'declined' | 'expired' {
  if (invite.status === 'pending' && new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  return invite.status;
}

// ---------------------------------------------------------------------------
// Shared-investor suggestions (Prompt 316 §B). The DB adapter
// (network-db.ts) reads WIDE, unfiltered rows — every catalog_deliveries
// row joined to its entity's status and the delivering org's
// network_discoverable flag — and this function applies the actual product
// rules on top, so "no bilateral opt-in -> never suggest" and "no invested
// stage -> never suggest" are each independently testable without a
// database, per the prompt's own required test list.
//
// Deliberately narrow: only catalog-sourced investors match (a shared
// catalog_id is an exact identity; a founder-typed 'manual' entity has no
// canonical id to match against, and fuzzy name-matching across orgs' own
// pipeline text is exactly the kind of general-case problem this codebase
// has repeatedly declined to solve — see company-claims.ts's own findings
// on Prompt 311). A manually-added investor simply never produces a
// suggestion; documented here as the accepted scope, not a bug.
export interface DeliveryRow {
  orgId: string;
  catalogId: string;
  investorName: string;
  entityStatus: string;
  orgDiscoverable: boolean;
}

export interface SharedInvestorSuggestion {
  otherOrgId: string;
  investorName: string;
  catalogId: string;
}

export function computeSharedInvestorSuggestions(rows: DeliveryRow[], viewingOrgId: string): SharedInvestorSuggestion[] {
  const eligible = rows.filter((r) => r.entityStatus === 'invested' && r.orgDiscoverable);
  const mine = eligible.filter((r) => r.orgId === viewingOrgId);
  if (mine.length === 0) return [];

  const suggestions: SharedInvestorSuggestion[] = [];
  const seen = new Set<string>();
  for (const my of mine) {
    for (const other of eligible) {
      if (other.orgId === viewingOrgId || other.catalogId !== my.catalogId) continue;
      const key = `${other.orgId}:${other.catalogId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ otherOrgId: other.orgId, investorName: other.investorName, catalogId: other.catalogId });
    }
  }
  return suggestions;
}

// ---------------------------------------------------------------------------
// Prompt 317 — groups. Same pure/adapter split: network-db.ts reads every
// active membership row (wide, unfiltered) and this function decides which
// pairs share a group.
export interface GroupMembershipRow { groupId: string; groupName: string; actorId: string }
export interface SharedGroupSuggestion { otherActorId: string; groupName: string; groupId: string }

export function computeSharedGroupSuggestions(memberships: GroupMembershipRow[], viewingActorId: string): SharedGroupSuggestion[] {
  const mine = memberships.filter((m) => m.actorId === viewingActorId);
  if (mine.length === 0) return [];

  const suggestions: SharedGroupSuggestion[] = [];
  const seen = new Set<string>();
  for (const my of mine) {
    for (const other of memberships) {
      if (other.actorId === viewingActorId || other.groupId !== my.groupId) continue;
      const key = `${other.actorId}:${my.groupId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ otherActorId: other.actorId, groupName: my.groupName, groupId: my.groupId });
    }
  }
  return suggestions;
}

export interface SuggestionReason { kind: 'shared_investor' | 'shared_group'; label: string }
export interface MergedConnectionSuggestion { otherActorId: string; reasons: SuggestionReason[] }

// The ONE suggestion engine both sources feed — Prompt 317's own explicit
// instruction was not to build a second, parallel one. Both inputs must
// already be actor-keyed by the caller: the shared-investor signal is
// inherently org-keyed (catalog_deliveries has no other identity), so
// network-db.ts resolves org id -> actor id before calling this, same as
// it already does when shaping the API response.
export function mergeConnectionSuggestions(
  sharedInvestor: { otherActorId: string; investorName: string }[],
  sharedGroup: { otherActorId: string; groupName: string }[],
): MergedConnectionSuggestion[] {
  const byActor = new Map<string, SuggestionReason[]>();
  for (const s of sharedInvestor) {
    const list = byActor.get(s.otherActorId) ?? [];
    list.push({ kind: 'shared_investor', label: `Shares the investor ${s.investorName}` });
    byActor.set(s.otherActorId, list);
  }
  for (const s of sharedGroup) {
    const list = byActor.get(s.otherActorId) ?? [];
    list.push({ kind: 'shared_group', label: `Both in ${s.groupName}` });
    byActor.set(s.otherActorId, list);
  }
  return [...byActor.entries()].map(([otherActorId, reasons]) => ({ otherActorId, reasons }));
}

// ---------------------------------------------------------------------------
// Group creation/membership eligibility. Deliberately conservative: for
// accelerator_batch/topic, a candidate must already be one of the acting
// actor's own active connections (Nuno's own rule: "cria-se uma vez
// incorporando entidades já ligadas, e mais tarde podem ser adicionadas
// novas" — the SAME requirement applies whether it's the founding member
// list or a later addition, so this one function covers both moments).
// investor_portfolio replaces that requirement entirely with the verified
// invested-relationship signal (316's own shared-investor evidence, not a
// second heuristic) — an investor doesn't need a pre-existing
// network_connections row with each portfolio company to build this group.
export type NetworkGroupKind = 'accelerator_batch' | 'investor_portfolio' | 'topic';

export function canCreateGroup(kind: NetworkGroupKind, creatorIsInvestor: boolean): boolean {
  if (kind === 'investor_portfolio') return creatorIsInvestor;
  return true;
}

export function canAddGroupMember(params: {
  groupKind: NetworkGroupKind;
  ownerIsInvestor: boolean;
  activeConnectionActorIds: string[];
  investedActorIdsForOwner: string[];
  candidateActorId: string;
}): boolean {
  if (params.groupKind === 'investor_portfolio') {
    return params.ownerIsInvestor && params.investedActorIdsForOwner.includes(params.candidateActorId);
  }
  return params.activeConnectionActorIds.includes(params.candidateActorId);
}

// ---------------------------------------------------------------------------
// Prompt 318 — referrals, the heart of the feature. Founder A (invested by
// X) refers startup B (A's own connection) to X; investor X refers a
// portfolio startup B to another investor Z in X's own network. Both
// directions reduce to the exact same shape: the referrer has a VERIFIED
// invested relationship with one side, and a normal active connection with
// the other — one function, not two nearly-identical ones.
export function canCreateReferral(params: { referrerHasInvestedRelationship: boolean; otherPartyIsActiveConnection: boolean }): boolean {
  return params.referrerHasInvestedRelationship && params.otherPartyIsActiveConnection;
}

export type NetworkReferralState = 'pending_referred_consent' | 'pending_target_decision' | 'accepted' | 'declined_by_referred' | 'declined_by_target';

// A referral for the same (referred org, target) pair is blocked while an
// earlier one for that exact pair is still live — mirrored by a partial
// unique DB index (migration 0212) for the same reason 316's pending-cap
// trigger exists alongside canSendInvite: the DB is the real guarantee, this
// is the same rule made independently testable.
const LIVE_REFERRAL_STATES: NetworkReferralState[] = ['pending_referred_consent', 'pending_target_decision', 'accepted'];
export function isLiveReferralState(state: NetworkReferralState): boolean {
  return LIVE_REFERRAL_STATES.includes(state);
}
export function isDuplicateReferral(existingStatesForSamePair: NetworkReferralState[]): boolean {
  return existingStatesForSamePair.some(isLiveReferralState);
}

export const MAX_REFERRALS_PER_MONTH = 5;
export function canSendReferral(sentThisCalendarMonth: number): boolean {
  return sentThisCalendarMonth < MAX_REFERRALS_PER_MONTH;
}

// The central guarantee of this prompt, made an explicit ALLOWLIST rather
// than a blocklist on purpose: a blocklist that only excludes
// 'pending_referred_consent' would (and, mid-implementation, briefly did)
// let a 'declined_by_referred' row leak to the target too — B saying no
// must be exactly as invisible to the target as the request never having
// existed ("controla o que X chega a ver"). Only these three states were
// ever meant to reach the target's own view.
const TARGET_VISIBLE_STATES: NetworkReferralState[] = ['pending_target_decision', 'accepted', 'declined_by_target'];
export function isReferralVisibleToTarget(state: NetworkReferralState): boolean {
  return TARGET_VISIBLE_STATES.includes(state);
}

// The route-level version of the same guarantee: given every referral row
// naming this actor as target (raw, unfiltered — exactly what a bare
// .eq('target_actor_id', ...) query would return), which of them the target
// is actually allowed to receive in an API response. Pure — takes and
// returns plain data, no DB — so this is unit-testable end to end, not just
// via the underlying predicate: the required proof for this prompt is that
// a referral still in 'pending_referred_consent' NEVER survives this filter,
// not even to prove it exists.
export function referralsVisibleToTarget<T extends { targetActorId: string; state: NetworkReferralState }>(
  referrals: T[],
  targetActorId: string,
): T[] {
  return referrals.filter((r) => r.targetActorId === targetActorId && isReferralVisibleToTarget(r.state));
}

// Each of the two stages gets its OWN 14-day clock (referred_decided_at
// resets the second one) — same "read-time computed, never a stored value,
// no cron needed" approach as 316's effectiveInviteStatus. Crucially, this
// is a DISPLAY-only concept: it never changes what's visible to the
// target (isReferralVisibleToTarget above checks the raw stored state,
// which a referral stuck in 'pending_referred_consent' keeps forever even
// once its clock has run out — B never consenting must stay invisible to
// the target even after the window closes, not flip open on a technicality).
export function effectiveReferralState(
  referral: { state: NetworkReferralState; createdAt: string; referredDecidedAt: string | null },
  now: Date,
): NetworkReferralState | 'expired' {
  if (referral.state === 'pending_referred_consent' && daysSince(referral.createdAt, now) >= INVITE_EXPIRY_DAYS) return 'expired';
  if (referral.state === 'pending_target_decision' && referral.referredDecidedAt && daysSince(referral.referredDecidedAt, now) >= INVITE_EXPIRY_DAYS) return 'expired';
  return referral.state;
}

function daysSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

// ---------------------------------------------------------------------------
// Prompt 319 — follow-on signal ("estou interessado em voltar a investir").
// Declared BY the investor, about a startup they already hold a verified
// 'invested' relationship with — this is the investor's own opinion, never
// something the platform derives about the founder, so it doesn't collide
// with CLAUDE.md's root startup-performance-privacy rule (same category as
// the founder's own round_secured_eur: a party stating their own fact).
export type FollowOnVisibility = 'named' | 'anonymous';
export const FOLLOWON_VALIDITY_MONTHS = 6;

export function canSignalFollowOn(hasInvestedRelationship: boolean): boolean {
  return hasInvestedRelationship;
}

// Read-time computed, same "no cron" reasoning as every other expiry in this
// series — revokedAt always wins even if expiresAt hasn't passed yet
// (silent revocation, per the prompt's own "desaparece... sem notificar
// ninguém").
export function isFollowOnActive(signal: { expiresAt: string | null; revokedAt: string | null } | null, now: Date): boolean {
  if (!signal?.expiresAt || signal.revokedAt) return false;
  return new Date(signal.expiresAt).getTime() > now.getTime();
}

// Pedido B — the round_progress_visible_to_investors discipline
// (src/app/api/portal/access/route.ts): "absent" and "anonymous" are two
// distinct, separately-testable payload shapes, and the identity field is
// stripped server-side, never merely hidden client-side.
export type FollowOnPayload =
  | { active: false }
  | { active: true; visibility: 'anonymous' }
  | { active: true; visibility: 'named'; investorName: string };

export function shapeFollowOnPayload(active: boolean, visibility: FollowOnVisibility | null, investorName: string | null): FollowOnPayload {
  if (!active || !visibility) return { active: false };
  if (visibility === 'anonymous') return { active: true, visibility: 'anonymous' };
  return { active: true, visibility: 'named', investorName: investorName ?? 'An investor' };
}

// Pedido C.2 — propagates onto a referral card ONLY when the referrer IS the
// signaling investor AND the referral is about the SAME startup the signal
// covers; never onto another investor's referral, and never onto a referral
// about a different startup even from the same investor.
export function referralCarriesFollowOnBadge(params: {
  referrerInvestorCatalogEntityId: string | null;
  referredOrgId: string;
  activeSignals: { investorCatalogEntityId: string; orgId: string }[];
}): boolean {
  if (!params.referrerInvestorCatalogEntityId) return false;
  return params.activeSignals.some((s) => s.investorCatalogEntityId === params.referrerInvestorCatalogEntityId && s.orgId === params.referredOrgId);
}

// ---------------------------------------------------------------------------
// Prompt 320 — Pathfinder ("who opens this door for me"). Which of MY
// connections already has a verified invested relationship with the
// investor I'm looking at, so I can ask them for an intro instead of
// cold-approaching. Deliberately calls canCreateReferral directly rather
// than re-deriving the check — the prompt's own explicit requirement is
// that Pathfinder and 318's referral composer NEVER disagree about who's
// eligible, since one leads straight into the other.
export interface PathfinderConnectionRow {
  actorId: string;
  isDiscoverable: boolean; // Pedido C — same network_discoverable opt-in guard as 316's own suggestions.
  hasInvestedRelationshipWithTarget: boolean;
  hasLiveReferralForThisAsk: boolean;
}
export interface PathfinderMatch { actorId: string; alreadyRequested: boolean }

export function computePathfinderMatches(connections: PathfinderConnectionRow[]): PathfinderMatch[] {
  return connections
    .filter((c) => c.isDiscoverable && canCreateReferral({ referrerHasInvestedRelationship: c.hasInvestedRelationshipWithTarget, otherPartyIsActiveConnection: true }))
    .map((c) => ({ actorId: c.actorId, alreadyRequested: c.hasLiveReferralForThisAsk }));
}

// ---------------------------------------------------------------------------
// Prompt 321 — post visibility. A pure restatement of the RLS policy
// (migration 0215's network_posts_visible_read) so the rule is testable
// without a database: both inputs (connection status, group membership)
// MUST be resolved live by the caller at read time — never a snapshot
// stored when the post was published (Pedido A's own explicit requirement:
// remove a connection later and their past posts disappear too).
export interface FeedPostRow { authorActorId: string; target: 'all' | 'group'; groupId: string | null; excludedActorIds: string[] }

export function isPostVisibleToViewer(
  post: FeedPostRow, viewerActorId: string, viewerIsActiveConnectionOfAuthor: boolean, viewerIsActiveGroupMember: boolean,
): boolean {
  if (post.authorActorId === viewerActorId) return true;
  if (post.target === 'group') return viewerIsActiveGroupMember;
  return viewerIsActiveConnectionOfAuthor && !post.excludedActorIds.includes(viewerActorId);
}

// ---------------------------------------------------------------------------
// Prompt 322 — structured updates + round milestones. The original concept
// measured and showed update CADENCE as an effort signal, comparable
// between founders — Nuno caught this before it shipped ("quão frustrante
// será mostrar que é a startup que mais esforço faz mas não consegue
// levantar capital"): public effort + unequal outcome is a cruel ranking
// between peers. The correction, binding for this whole prompt: NO cadence
// counter is ever visible between founders, anywhere — no streak badge, no
// "posts every N weeks", no sorted list, no effort/outcome juxtaposition.
// Cadence coaching is PRIVATE to the founder themselves (Pedido B below),
// never a public showcase.

// Pedido A — the four fixed, all-optional sections a structured update can
// fill in. NO round-state field exists here, on purpose — a founder can
// still mention numbers in FREE TEXT (not blocked by 321's linter, which
// only catches sales language) but the structured FORM itself never offers
// the field; the friction of having to type it by hand is deliberate.
export interface NetworkUpdateStructured {
  productProgress?: string;
  customers?: string;
  team?: string;
  learnings?: string;
}
export const NETWORK_UPDATE_STRUCTURED_KEYS = ['productProgress', 'customers', 'team', 'learnings'] as const;

// Pedido B — the private cadence coach. Deliberately simpler than the
// claims-engine's own gap detection (Prompt 313) — same spirit as
// outboundsAwaitingFollowUp (rules.ts): one threshold, one reminder, never
// escalating, never shown to anyone but the founder themselves. A founder
// who has never posted an update has nothing to measure "since" — no nudge
// fires for them from this function (documented, literal scope; a
// first-update nudge would need a different reference point entirely).
export const UPDATE_GAP_REMINDER_DAYS = 60;

export function lastUpdateGapCheck(lastUpdateCreatedAt: string | null, now: Date): { shouldNudge: boolean; daysSince: number | null } {
  if (!lastUpdateCreatedAt) return { shouldNudge: false, daysSince: null };
  const daysSince = Math.floor((now.getTime() - new Date(lastUpdateCreatedAt).getTime()) / 86_400_000);
  return { shouldNudge: daysSince >= UPDATE_GAP_REMINDER_DAYS, daysSince };
}

// Pedido C — round milestones. Percentage ONLY, never the exact € amount,
// even with orgs.round_progress_visible_to_investors on — MORE restrictive
// than that toggle strictly requires (it protects the figure for one
// individual investor's own dossier; broadcasting to the whole network is a
// wider, less controlled audience, and that difference in audience size is
// exactly why this surface earns a stricter rule of its own, not a copy of
// the dossier's).
export function canShareRoundMilestone(roundProgressVisibleToInvestors: boolean): boolean {
  return roundProgressVisibleToInvestors;
}

export function formatRoundMilestoneText(params: { orgName: string; percent: number; stageLabel?: string | null }): string {
  const roundPhrase = params.stageLabel ? `${params.stageLabel} round` : 'round';
  return `${params.orgName} has secured ${params.percent}% of their ${roundPhrase}.`;
}

// ---------------------------------------------------------------------------
// Prompt 323 — reciprocity: office hours + reverse scout. Both follow the
// same SOFT reciprocity principle as the rest of this series: visibility
// and reputation, never hard currency — no tradeable points, nothing that
// looks like payment for favors. Hard currency would make this
// transactional, exactly what 321's sales prohibition exists to prevent.

// Pedido A — office hours. "Disappears from the feed automatically" on
// expiry OR on exhausting every slot is the SAME condition, expressed once.
// The actual atomicity guarantee (never claiming past slots_total under
// concurrent claims) lives in the DB function network_claim_offer_slot
// (migration 0217, row-locked with SELECT … FOR UPDATE) — this is the
// read-side mirror, for feed filtering.
export type NetworkOfferKind = 'deck_review' | 'intro' | 'advice' | 'other';

export function isOfferActive(offer: { slotsTotal: number; slotsClaimed: number; expiresAt: string }, now: Date): boolean {
  return offer.slotsClaimed < offer.slotsTotal && new Date(offer.expiresAt).getTime() > now.getTime();
}

// Pedido B — reverse scout. Eligibility EXCEPTION to 318's canCreateReferral:
// a referral originating from an investor's own scout request does NOT
// require the referrer to have a verified `invested` relationship with that
// investor — the investor's own request already IS the implicit invitation.
// The other half of 318's rule still applies unchanged: the referred
// startup must still be the referrer's own active connection, never
// invented, never from outside the network. This function is intentionally
// separate from canCreateReferral (never rewritten there) — this is a
// documented, additional entry point into eligibility, not a modification
// of the original rule.
export function canReferViaScoutRequest(referredIsActiveConnectionOfReferrer: boolean): boolean {
  return referredIsActiveConnectionOfReferrer;
}

// Pedido C — soft reputation, always read ONE actor at a time (never a
// ranked/sorted list, never comparable to another actor in the same
// response) — same anti-ranking discipline as referralReputation (318).
export function reciprocityReputation(
  offers: { actorId: string }[], scoutReferrals: { referrerActorId: string }[], actorId: string,
): { officeHoursOffered: number; startupsReferredViaScout: number } {
  return {
    officeHoursOffered: offers.filter((o) => o.actorId === actorId).length,
    startupsReferredViaScout: scoutReferrals.filter((r) => r.referrerActorId === actorId).length,
  };
}

// Reputation (Pedido D) — live-computed from network_referrals alone, no
// new table, never comparable between actors in the same response (the
// anti-ranking rule): only ever "MY sent/accepted counts", read one actor
// at a time.
export function referralReputation(referrals: { referrerActorId: string; state: NetworkReferralState }[], actorId: string): { sent: number; accepted: number } {
  const mine = referrals.filter((r) => r.referrerActorId === actorId);
  return { sent: mine.length, accepted: mine.filter((r) => r.state === 'accepted').length };
}
