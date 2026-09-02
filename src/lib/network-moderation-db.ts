// Prompt 531 — server-only glue between the pure moderation logic
// (network-moderation.ts) and the tables migration 0291 added. Every
// back-office moderation route and the startup's own moderation view go
// through here, so the strike→ban recomputation, the idempotency handling
// and the audit trail are written once rather than per route.
//
// Deliberate boundaries:
//   * reports stay support_tickets rows (0215's choice, unchanged);
//   * the ban stays network_actors.network_suspended_at (0215's choice,
//     unchanged) and the threshold stays 3;
//   * the audit trail is admin_audit_log via logAdminAction — this codebase
//     already has an admin audit architecture and the request is explicit
//     about not building a second one.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAdminAction } from './audit';
import {
  buildContentSnapshot, describeBanState, shouldBanForStrikes, toStartupStrikeView,
  type AppealStatus, type ReportedContentSnapshot, type StartupStrikeView, type StrikeStatus,
} from './network-moderation';
import { resolveActorDisplays } from './network-db';

export const NETWORK_REPORT_CATEGORY = 'network_content_report';

/** Parses the machine-readable tag /api/network/report writes into
 *  support_tickets.context. Kept here next to its only consumers rather
 *  than duplicated inline in each route, as it was. */
export function parseNetworkReportContext(context: string | null): { postId?: string; actorId?: string } {
  const actorMatch = context?.match(/^network_actor:([0-9a-f-]{36})$/);
  if (actorMatch) return { actorId: actorMatch[1] };
  const postMatch = context?.match(/^network_post:([0-9a-f-]{36})$/);
  if (postMatch) return { postId: postMatch[1] };
  return {};
}

// ---------------------------------------------------------------------------
// Snapshot capture, at report time.

/**
 * Freezes the reported post alongside the report. Best-effort by design:
 * a snapshot that fails to write must never stop a report being filed —
 * losing the report is worse than losing the evidence, and the live post is
 * still there in the common case.
 */
export async function captureReportSnapshot(admin: SupabaseClient, params: {
  ticketId: string; postId?: string | null; reportedActorId?: string | null;
}): Promise<void> {
  try {
    let snapshot: ReportedContentSnapshot | null = null;
    let authorActorId = params.reportedActorId ?? null;

    if (params.postId) {
      const { data: post } = await admin.from('network_posts')
        .select('id, author_actor_id, body, kind, structured, target, group_id, created_at')
        .eq('id', params.postId).maybeSingle();
      if (post) {
        authorActorId = (post.author_actor_id as string) ?? authorActorId;
        const [displays, group] = await Promise.all([
          resolveActorDisplays(admin, [post.author_actor_id as string]),
          post.group_id
            ? admin.from('network_groups').select('name').eq('id', post.group_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        snapshot = buildContentSnapshot(post as Parameters<typeof buildContentSnapshot>[0], {
          groupName: (group.data?.name as string | undefined) ?? null,
          authorName: displays.get(post.author_actor_id as string)?.name ?? null,
        });
      }
    }
    if (!snapshot) {
      // An actor report (no post) still gets a row, so the case has a
      // consistent shape and the strike can reference it.
      snapshot = {
        postId: null, body: '', kind: 'actor_report', structured: null, target: null,
        groupName: null, createdAt: null, authorActorId, authorName: null,
      };
      if (authorActorId) {
        const displays = await resolveActorDisplays(admin, [authorActorId]);
        snapshot.authorName = displays.get(authorActorId)?.name ?? null;
      }
    }

    await admin.from('network_report_snapshots').insert({
      ticket_id: params.ticketId, post_id: params.postId ?? null,
      author_actor_id: authorActorId, snapshot,
    });
  } catch {
    /* never blocks the report */
  }
}

// ---------------------------------------------------------------------------
// Reading a moderation case.

export interface ModerationCase {
  snapshot: ReportedContentSnapshot | null;
  snapshotId: string | null;
  capturedAt: string | null;
  postId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorKind: 'founder' | 'investor' | null;
  /** The post as it stands NOW — null when it never existed or was hard
   *  deleted; `deleted` distinguishes "gone" from "never captured". */
  live: { body: string; createdAt: string; deletedAt: string | null; moderationRemovedAt: string | null } | null;
  activeStrikeCount: number;
  suspendedAt: string | null;
  /** This case's own strike, if one was already applied. */
  strike: { id: string; status: StrikeStatus; appliedAt: string; contentRemoved: boolean } | null;
  /** Other reports about the SAME post — so a moderator sees five reports
   *  as one piece of content, not five unrelated cases (§36). Reporter
   *  identities are not included: the count and the case links are what a
   *  moderator needs here. */
  relatedTicketIds: string[];
}

export async function readModerationCase(admin: SupabaseClient, ticket: {
  id: string; category: string; context: string | null;
}): Promise<ModerationCase | null> {
  if (ticket.category !== NETWORK_REPORT_CATEGORY) return null;
  const parsed = parseNetworkReportContext(ticket.context);

  const { data: snapRow } = await admin.from('network_report_snapshots')
    .select('id, post_id, author_actor_id, snapshot, captured_at').eq('ticket_id', ticket.id).maybeSingle();

  const postId = (snapRow?.post_id as string | undefined) ?? parsed.postId ?? null;
  let actorId = (snapRow?.author_actor_id as string | undefined) ?? parsed.actorId ?? null;

  let live: ModerationCase['live'] = null;
  if (postId) {
    const { data: post } = await admin.from('network_posts')
      .select('author_actor_id, body, created_at, deleted_at, moderation_removed_at').eq('id', postId).maybeSingle();
    if (post) {
      actorId = actorId ?? (post.author_actor_id as string);
      live = {
        body: post.body as string, createdAt: post.created_at as string,
        deletedAt: (post.deleted_at as string | null) ?? null,
        moderationRemovedAt: (post.moderation_removed_at as string | null) ?? null,
      };
    }
  }

  let actorName: string | null = null;
  let actorKind: 'founder' | 'investor' | null = null;
  let activeStrikeCount = 0;
  let suspendedAt: string | null = null;
  if (actorId) {
    const [displays, actorRow, strikeCount] = await Promise.all([
      resolveActorDisplays(admin, [actorId]),
      admin.from('network_actors').select('network_suspended_at, org_id').eq('id', actorId).maybeSingle(),
      admin.from('network_strikes').select('id', { count: 'exact', head: true }).eq('actor_id', actorId).eq('status', 'active'),
    ]);
    const display = displays.get(actorId);
    actorName = display?.name ?? null;
    actorKind = display?.kind ?? (actorRow.data?.org_id ? 'founder' : 'investor');
    suspendedAt = (actorRow.data?.network_suspended_at as string | null) ?? null;
    activeStrikeCount = strikeCount.count ?? 0;
  }

  const { data: strikeRow } = await admin.from('network_strikes')
    .select('id, status, applied_at, content_removed').eq('ticket_id', ticket.id).maybeSingle();

  let relatedTicketIds: string[] = [];
  if (postId) {
    const { data: related } = await admin.from('network_report_snapshots')
      .select('ticket_id').eq('post_id', postId).neq('ticket_id', ticket.id);
    relatedTicketIds = (related ?? []).map((r) => r.ticket_id as string);
  }

  return {
    snapshot: (snapRow?.snapshot as ReportedContentSnapshot | undefined) ?? null,
    snapshotId: (snapRow?.id as string | undefined) ?? null,
    capturedAt: (snapRow?.captured_at as string | undefined) ?? null,
    postId, actorId, actorName, actorKind, live, activeStrikeCount, suspendedAt,
    strike: strikeRow
      ? {
        id: strikeRow.id as string, status: strikeRow.status as StrikeStatus,
        appliedAt: strikeRow.applied_at as string, contentRemoved: !!strikeRow.content_removed,
      }
      : null,
    relatedTicketIds,
  };
}

// ---------------------------------------------------------------------------
// Strike state, derived rather than incremented.

/**
 * Recomputes network_actors.network_strikes_count from the actual active
 * strike rows, and applies 0215's ban rule to the result.
 *
 * The original code did `count + 1` and set network_suspended_at at 3 — a
 * one-way door: nothing could ever move it back down. Deriving the count is
 * what makes reversal real rather than cosmetic (§13: "Do not simply change
 * a visual counter").
 *
 * It never LIFTS a ban — see describeBanState's own note. Applying one is an
 * existing rule; lifting one is a moderator decision (setActorBan).
 */
export async function recomputeActorStrikeState(admin: SupabaseClient, actorId: string): Promise<{
  activeStrikeCount: number; banned: boolean; banApplied: boolean;
}> {
  const { count } = await admin.from('network_strikes')
    .select('id', { count: 'exact', head: true }).eq('actor_id', actorId).eq('status', 'active');
  const activeStrikeCount = count ?? 0;

  const { data: actor } = await admin.from('network_actors')
    .select('network_suspended_at').eq('id', actorId).maybeSingle();
  const alreadySuspended = !!actor?.network_suspended_at;

  const patch: Record<string, unknown> = { network_strikes_count: activeStrikeCount };
  let banApplied = false;
  if (!alreadySuspended && shouldBanForStrikes(activeStrikeCount)) {
    patch.network_suspended_at = new Date().toISOString();
    banApplied = true;
  }
  await admin.from('network_actors').update(patch).eq('id', actorId);

  return { activeStrikeCount, banned: alreadySuspended || banApplied, banApplied };
}

// ---------------------------------------------------------------------------
// Moderator actions. Each records itself in admin_audit_log with the
// previous and resulting state, which is what makes the history answer
// "who / what / when / from what / to what" (§16).

export interface ActionResult {
  ok: boolean;
  error?: string;
  strikeId?: string;
  /** True only when this call actually created the strike. A retried or
   *  double-clicked "Apply strike" returns ok with created=false, so the
   *  caller can be idempotent about its SIDE EFFECTS too — without this the
   *  second click sent the startup a second "you received a strike" email
   *  for a strike that was never applied twice. */
  created?: boolean;
}

export async function applyStrike(admin: SupabaseClient, params: {
  ticket: { id: string; category: string; context: string | null };
  adminUserId: string;
}): Promise<ActionResult> {
  const moderationCase = await readModerationCase(admin, params.ticket);
  if (!moderationCase) return { ok: false, error: 'Only valid for network content reports.' };
  if (!moderationCase.actorId) return { ok: false, error: 'Could not resolve the reported actor from this report.' };

  // Idempotency layer 1 — an existing strike for this case is returned, not
  // duplicated. Layer 2 is the unique index (migration 0291), which also
  // catches two concurrent requests that both passed this check.
  if (moderationCase.strike) {
    return moderationCase.strike.status === 'active'
      ? { ok: true, strikeId: moderationCase.strike.id, created: false }
      : { ok: false, error: 'This report already produced a strike, which was reversed.' };
  }

  const previous = {
    activeStrikeCount: moderationCase.activeStrikeCount,
    banned: !!moderationCase.suspendedAt,
  };

  const { data: inserted, error } = await admin.from('network_strikes').insert({
    actor_id: moderationCase.actorId, ticket_id: params.ticket.id, post_id: moderationCase.postId,
    snapshot_id: moderationCase.snapshotId, applied_by: params.adminUserId,
  }).select('id').single();

  if (error) {
    // The unique indexes speak for themselves: the same case, or the same
    // post, already carries an active strike. Reported as success-shaped
    // "already done" rather than an error the moderator has to interpret.
    if (error.code === '23505') {
      const { data: existing } = await admin.from('network_strikes')
        .select('id').eq('ticket_id', params.ticket.id).maybeSingle();
      if (existing) return { ok: true, strikeId: existing.id as string, created: false };
      return { ok: false, error: 'This content already has an active strike.' };
    }
    return { ok: false, error: error.message };
  }

  const state = await recomputeActorStrikeState(admin, moderationCase.actorId);

  await logAdminAction(admin, {
    adminUserId: params.adminUserId, action: 'network_strike_applied',
    subjectType: 'network_actor', subjectId: moderationCase.actorId,
    detail: {
      strikeId: inserted.id, ticketId: params.ticket.id, postId: moderationCase.postId,
      previous, resulting: { activeStrikeCount: state.activeStrikeCount, banned: state.banned },
    },
  });
  if (state.banApplied) {
    await logAdminAction(admin, {
      adminUserId: params.adminUserId, action: 'network_ban_applied',
      subjectType: 'network_actor', subjectId: moderationCase.actorId,
      detail: { reason: 'strike_threshold', strikeId: inserted.id, previous: { banned: false }, resulting: { banned: true } },
    });
  }

  return { ok: true, strikeId: inserted.id as string, created: true };
}

export async function reverseStrike(admin: SupabaseClient, params: {
  strikeId: string; adminUserId: string; reason?: string;
}): Promise<ActionResult> {
  const { data: strike } = await admin.from('network_strikes')
    .select('id, actor_id, status').eq('id', params.strikeId).maybeSingle();
  if (!strike) return { ok: false, error: 'Strike not found.' };
  if (strike.status === 'reversed') return { ok: true, strikeId: params.strikeId };

  const actorId = strike.actor_id as string;
  const { count: beforeCount } = await admin.from('network_strikes')
    .select('id', { count: 'exact', head: true }).eq('actor_id', actorId).eq('status', 'active');

  // An UPDATE, never a DELETE — §17: the original strike must remain in
  // history. The row stays, its status changes, and who/when/why are
  // recorded on it.
  const { error } = await admin.from('network_strikes').update({
    status: 'reversed', reversed_by: params.adminUserId, reversed_at: new Date().toISOString(),
    reversal_reason: params.reason?.trim() || null,
  }).eq('id', params.strikeId);
  if (error) return { ok: false, error: error.message };

  const state = await recomputeActorStrikeState(admin, actorId);

  await logAdminAction(admin, {
    adminUserId: params.adminUserId, action: 'network_strike_reversed',
    subjectType: 'network_actor', subjectId: actorId,
    detail: {
      strikeId: params.strikeId, reason: params.reason?.trim() || null,
      previous: { activeStrikeCount: beforeCount ?? 0 },
      resulting: { activeStrikeCount: state.activeStrikeCount, banned: state.banned },
      // Stated in the log itself so a later reader does not have to infer
      // it: dropping below the threshold does not lift an existing ban.
      banStillApplied: state.banned,
    },
  });
  return { ok: true, strikeId: params.strikeId };
}

/**
 * Removes a reported post from My Network, server-side.
 *
 * Sets deleted_at as well as the moderation columns, on purpose: every
 * existing read path (readFeedForActor, the RLS policy,
 * readLastUpdatePostCreatedAt) already filters on deleted_at, so the post
 * disappears from every surface the day this ships instead of depending on
 * each query being found and patched. The moderation columns are what
 * distinguish this from an author's own delete.
 *
 * The moderation record is untouched — the snapshot and the strike survive
 * the removal (§8), which is the whole reason the snapshot exists.
 */
export async function removeReportedPost(admin: SupabaseClient, params: {
  postId: string; adminUserId: string; ticketId?: string; strikeId?: string;
}): Promise<ActionResult> {
  const { data: post } = await admin.from('network_posts')
    .select('id, author_actor_id, deleted_at, moderation_removed_at').eq('id', params.postId).maybeSingle();
  if (!post) return { ok: false, error: 'Post not found.' };
  if (post.moderation_removed_at) return { ok: true };

  const now = new Date().toISOString();
  const { error } = await admin.from('network_posts')
    .update({ deleted_at: post.deleted_at ?? now, moderation_removed_at: now, moderation_removed_by: params.adminUserId })
    .eq('id', params.postId);
  if (error) return { ok: false, error: error.message };

  if (params.strikeId) {
    await admin.from('network_strikes').update({ content_removed: true }).eq('id', params.strikeId);
  }

  await logAdminAction(admin, {
    adminUserId: params.adminUserId, action: 'network_post_removed',
    subjectType: 'network_post', subjectId: params.postId,
    detail: {
      ticketId: params.ticketId ?? null, strikeId: params.strikeId ?? null,
      actorId: post.author_actor_id,
      previous: { visible: !post.deleted_at }, resulting: { visible: false, removedByModeration: true },
    },
  });
  return { ok: true };
}

/** Applies or lifts the My Network ban directly. Distinct from the strike
 *  count on purpose (§15) — this is the explicit moderator decision. */
export async function setActorBan(admin: SupabaseClient, params: {
  actorId: string; banned: boolean; adminUserId: string; reason?: string;
}): Promise<ActionResult> {
  const { data: actor } = await admin.from('network_actors')
    .select('id, network_suspended_at').eq('id', params.actorId).maybeSingle();
  if (!actor) return { ok: false, error: 'Actor not found.' };

  const wasBanned = !!actor.network_suspended_at;
  if (wasBanned === params.banned) return { ok: true };

  const { error } = await admin.from('network_actors')
    .update({ network_suspended_at: params.banned ? new Date().toISOString() : null })
    .eq('id', params.actorId);
  if (error) return { ok: false, error: error.message };

  await logAdminAction(admin, {
    adminUserId: params.adminUserId,
    action: params.banned ? 'network_ban_applied' : 'network_ban_reversed',
    subjectType: 'network_actor', subjectId: params.actorId,
    detail: {
      reason: params.reason?.trim() || null,
      previous: { banned: wasBanned }, resulting: { banned: params.banned },
    },
  });
  return { ok: true };
}

export async function dismissReport(admin: SupabaseClient, params: {
  ticketId: string; adminUserId: string;
}): Promise<ActionResult> {
  await logAdminAction(admin, {
    adminUserId: params.adminUserId, action: 'network_report_dismissed',
    subjectType: 'support_ticket', subjectId: params.ticketId,
    detail: { previous: { decision: 'pending' }, resulting: { decision: 'no_violation' } },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Appeals.

export async function submitAppeal(admin: SupabaseClient, params: {
  strikeId: string; actorId: string; body: string;
}): Promise<ActionResult> {
  const { data: strike } = await admin.from('network_strikes')
    .select('id, actor_id, status').eq('id', params.strikeId).maybeSingle();
  if (!strike) return { ok: false, error: 'Strike not found.' };
  // The appeal is scoped to the appellant's own strike — a guessed strike id
  // belonging to another actor is inert.
  if (strike.actor_id !== params.actorId) return { ok: false, error: 'Strike not found.' };
  if (strike.status !== 'active') return { ok: false, error: 'This strike is no longer active.' };

  const body = params.body.trim();
  if (!body) return { ok: false, error: 'Tell us why you believe this was a mistake.' };
  if (body.length > 4000) return { ok: false, error: 'Please keep it under 4000 characters.' };

  const { error } = await admin.from('network_strike_appeals')
    .insert({ strike_id: params.strikeId, actor_id: params.actorId, body });
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'You already have an appeal pending on this strike.' };
    return { ok: false, error: error.message };
  }
  return { ok: true, strikeId: params.strikeId };
}

export async function decideAppeal(admin: SupabaseClient, params: {
  appealId: string; outcome: 'upheld' | 'reversed'; adminUserId: string; note?: string;
}): Promise<ActionResult> {
  const { data: appeal } = await admin.from('network_strike_appeals')
    .select('id, strike_id, actor_id, status').eq('id', params.appealId).maybeSingle();
  if (!appeal) return { ok: false, error: 'Appeal not found.' };
  if (appeal.status !== 'pending') return { ok: false, error: 'This appeal has already been decided.' };

  const { error } = await admin.from('network_strike_appeals').update({
    status: params.outcome, decided_by: params.adminUserId, decided_at: new Date().toISOString(),
    decision_note: params.note?.trim() || null,
  }).eq('id', params.appealId);
  if (error) return { ok: false, error: error.message };

  // Reversing via an appeal is the SAME reversal path as a moderator-
  // initiated one — one place where the count is recomputed and the history
  // written, not a second implementation that could drift.
  if (params.outcome === 'reversed') {
    const result = await reverseStrike(admin, {
      strikeId: appeal.strike_id as string, adminUserId: params.adminUserId,
      reason: `Reversed on appeal${params.note?.trim() ? `: ${params.note.trim()}` : ''}`,
    });
    if (!result.ok) return result;
  }

  await logAdminAction(admin, {
    adminUserId: params.adminUserId, action: 'network_appeal_decided',
    subjectType: 'network_actor', subjectId: appeal.actor_id as string,
    detail: {
      appealId: params.appealId, strikeId: appeal.strike_id,
      previous: { appealStatus: 'pending' }, resulting: { appealStatus: params.outcome },
    },
  });
  return { ok: true, strikeId: appeal.strike_id as string };
}

// ---------------------------------------------------------------------------
// Back-office reading: the Strikes tab.

export interface StrikeListRow {
  actorId: string;
  actorKind: 'founder' | 'investor';
  orgId: string | null;
  name: string;
  activeStrikes: number;
  totalStrikes: number;
  suspendedAt: string | null;
  banned: boolean;
  banNoLongerRequired: boolean;
  pendingAppeals: number;
  lastStrikeAt: string | null;
}

export async function readStrikeList(admin: SupabaseClient): Promise<StrikeListRow[]> {
  // Everyone who has ever had a strike, plus anyone currently suspended
  // (a ban applied by hand with no strikes behind it must still be visible
  // and liftable here).
  const [{ data: strikes }, { data: suspended }] = await Promise.all([
    admin.from('network_strikes').select('id, actor_id, status, applied_at'),
    admin.from('network_actors').select('id, org_id, network_suspended_at').not('network_suspended_at', 'is', null),
  ]);

  const byActor = new Map<string, { active: number; total: number; last: string | null }>();
  for (const s of strikes ?? []) {
    const id = s.actor_id as string;
    const cur = byActor.get(id) ?? { active: 0, total: 0, last: null };
    cur.total += 1;
    if (s.status === 'active') cur.active += 1;
    const at = s.applied_at as string;
    if (!cur.last || at > cur.last) cur.last = at;
    byActor.set(id, cur);
  }
  for (const a of suspended ?? []) {
    if (!byActor.has(a.id as string)) byActor.set(a.id as string, { active: 0, total: 0, last: null });
  }
  const actorIds = [...byActor.keys()];
  if (actorIds.length === 0) return [];

  const [{ data: actors }, { data: appeals }, displays] = await Promise.all([
    admin.from('network_actors').select('id, org_id, network_suspended_at').in('id', actorIds),
    admin.from('network_strike_appeals').select('actor_id').eq('status', 'pending').in('actor_id', actorIds),
    resolveActorDisplays(admin, actorIds),
  ]);
  const pendingByActor = new Map<string, number>();
  for (const a of appeals ?? []) {
    const id = a.actor_id as string;
    pendingByActor.set(id, (pendingByActor.get(id) ?? 0) + 1);
  }
  const actorById = new Map((actors ?? []).map((a) => [a.id as string, a]));

  return actorIds.map((id) => {
    const counts = byActor.get(id)!;
    const actor = actorById.get(id);
    const suspendedAt = (actor?.network_suspended_at as string | null) ?? null;
    const ban = describeBanState({ activeStrikeCount: counts.active, suspendedAt });
    const display = displays.get(id);
    return {
      actorId: id,
      actorKind: display?.kind ?? (actor?.org_id ? 'founder' : 'investor'),
      orgId: (actor?.org_id as string | null) ?? null,
      name: display?.name ?? 'Unknown actor',
      activeStrikes: counts.active,
      totalStrikes: counts.total,
      suspendedAt,
      banned: ban.banned,
      banNoLongerRequired: ban.banNoLongerRequired,
      pendingAppeals: pendingByActor.get(id) ?? 0,
      lastStrikeAt: counts.last,
    };
  }).sort((a, b) => (b.activeStrikes - a.activeStrikes) || a.name.localeCompare(b.name));
}

export interface StrikeDetailRow {
  id: string;
  status: StrikeStatus;
  appliedAt: string;
  appliedByEmail: string | null;
  reversedAt: string | null;
  reversedByEmail: string | null;
  reversalReason: string | null;
  contentRemoved: boolean;
  ticketId: string;
  postId: string | null;
  contentPreview: string | null;
  contentCreatedAt: string | null;
  postRemovedAt: string | null;
  appeal: { id: string; status: AppealStatus; body: string; createdAt: string; decidedAt: string | null; decisionNote: string | null } | null;
}

export async function readStrikeDetail(admin: SupabaseClient, actorId: string): Promise<StrikeDetailRow[]> {
  const { data: strikes } = await admin.from('network_strikes')
    .select('id, status, applied_at, applied_by, reversed_at, reversed_by, reversal_reason, content_removed, ticket_id, post_id, snapshot_id')
    .eq('actor_id', actorId).order('applied_at', { ascending: false });
  if (!strikes?.length) return [];

  const snapshotIds = strikes.map((s) => s.snapshot_id as string | null).filter((v): v is string => !!v);
  const postIds = strikes.map((s) => s.post_id as string | null).filter((v): v is string => !!v);
  const adminIds = [...new Set(strikes.flatMap((s) => [s.applied_by, s.reversed_by]).filter((v): v is string => !!v))];

  const [{ data: snaps }, { data: posts }, { data: appeals }] = await Promise.all([
    snapshotIds.length ? admin.from('network_report_snapshots').select('id, snapshot').in('id', snapshotIds) : Promise.resolve({ data: [] as { id: string; snapshot: ReportedContentSnapshot }[] }),
    postIds.length ? admin.from('network_posts').select('id, moderation_removed_at').in('id', postIds) : Promise.resolve({ data: [] as { id: string; moderation_removed_at: string | null }[] }),
    admin.from('network_strike_appeals').select('id, strike_id, status, body, created_at, decided_at, decision_note')
      .in('strike_id', strikes.map((s) => s.id as string)).order('created_at', { ascending: false }),
  ]);
  const snapById = new Map((snaps ?? []).map((s) => [s.id as string, s.snapshot as ReportedContentSnapshot]));
  const postById = new Map((posts ?? []).map((p) => [p.id as string, p.moderation_removed_at as string | null]));
  const appealByStrike = new Map<string, NonNullable<StrikeDetailRow['appeal']>>();
  for (const a of appeals ?? []) {
    const key = a.strike_id as string;
    if (!appealByStrike.has(key)) {
      appealByStrike.set(key, {
        id: a.id as string, status: a.status as AppealStatus, body: a.body as string,
        createdAt: a.created_at as string, decidedAt: (a.decided_at as string | null) ?? null,
        decisionNote: (a.decision_note as string | null) ?? null,
      });
    }
  }

  const emailById = new Map<string, string>();
  await Promise.all(adminIds.map(async (id) => {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emailById.set(id, data.user.email);
  }));

  return strikes.map((s) => {
    const snap = s.snapshot_id ? snapById.get(s.snapshot_id as string) : undefined;
    return {
      id: s.id as string,
      status: s.status as StrikeStatus,
      appliedAt: s.applied_at as string,
      appliedByEmail: emailById.get(s.applied_by as string) ?? null,
      reversedAt: (s.reversed_at as string | null) ?? null,
      reversedByEmail: s.reversed_by ? emailById.get(s.reversed_by as string) ?? null : null,
      reversalReason: (s.reversal_reason as string | null) ?? null,
      contentRemoved: !!s.content_removed,
      ticketId: s.ticket_id as string,
      postId: (s.post_id as string | null) ?? null,
      contentPreview: snap?.body ?? null,
      contentCreatedAt: snap?.createdAt ?? null,
      postRemovedAt: s.post_id ? postById.get(s.post_id as string) ?? null : null,
      appeal: appealByStrike.get(s.id as string) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Startup-facing reading. Everything that crosses this function is bound by
// the privacy rule; toStartupStrikeView is the only builder used.

export async function readStrikesForActor(admin: SupabaseClient, actorId: string): Promise<{
  strikes: StartupStrikeView[]; activeStrikeCount: number; banned: boolean;
}> {
  const [{ data: strikes }, { data: actor }] = await Promise.all([
    admin.from('network_strikes')
      .select('id, status, applied_at, content_removed, snapshot_id')
      .eq('actor_id', actorId).order('applied_at', { ascending: false }),
    admin.from('network_actors').select('network_suspended_at').eq('id', actorId).maybeSingle(),
  ]);
  const rows = strikes ?? [];
  if (rows.length === 0) {
    return { strikes: [], activeStrikeCount: 0, banned: !!actor?.network_suspended_at };
  }

  const snapshotIds = rows.map((s) => s.snapshot_id as string | null).filter((v): v is string => !!v);
  const [{ data: snaps }, { data: appeals }] = await Promise.all([
    snapshotIds.length ? admin.from('network_report_snapshots').select('id, snapshot').in('id', snapshotIds) : Promise.resolve({ data: [] as { id: string; snapshot: ReportedContentSnapshot }[] }),
    admin.from('network_strike_appeals').select('strike_id, status, created_at, decided_at')
      .in('strike_id', rows.map((s) => s.id as string)).order('created_at', { ascending: false }),
  ]);
  const snapById = new Map((snaps ?? []).map((s) => [s.id as string, s.snapshot as ReportedContentSnapshot]));
  const appealByStrike = new Map<string, { status: AppealStatus; createdAt: string; decidedAt: string | null }>();
  for (const a of appeals ?? []) {
    const key = a.strike_id as string;
    if (!appealByStrike.has(key)) {
      appealByStrike.set(key, {
        status: a.status as AppealStatus, createdAt: a.created_at as string,
        decidedAt: (a.decided_at as string | null) ?? null,
      });
    }
  }

  return {
    strikes: rows.map((s) => toStartupStrikeView({
      id: s.id as string,
      appliedAt: s.applied_at as string,
      status: s.status as StrikeStatus,
      contentRemoved: !!s.content_removed,
      snapshot: s.snapshot_id ? snapById.get(s.snapshot_id as string) ?? null : null,
      appeal: appealByStrike.get(s.id as string) ?? null,
    })),
    activeStrikeCount: rows.filter((s) => s.status === 'active').length,
    banned: !!actor?.network_suspended_at,
  };
}
