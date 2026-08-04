// MatchDeal QR pairing — shared server-only helpers. Token generation and
// status live in Next.js API routes (the caller is a browser session,
// cookie-based); consuming a token happens in a Supabase Edge Function
// (supabase/functions/matchdeal-qr-pair) because the caller there is the
// MatchDeal mobile app with its own Supabase session, not a browser —
// same split the existing matchdeal-pair function already uses. Both
// sides hash with sha256 hex so a token generated here validates there.
import 'server-only';
import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logEvent } from './analytics-events';
import { resolveActiveInvestorMember } from './investor-membership';
import { MATCHDEAL_WEEKLY, normalizePlan } from './plans';

export const PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000; // spec Section 4 — 5 minutes
export const PAIRING_RATE_LIMIT_PER_HOUR = 10; // spec Section 8

// Prompt 114 Fase 4.1 — device_id's resilient copy. localStorage is what the
// client reads/writes day-to-day; this httpOnly cookie is the fallback that
// survives a localStorage clear (Safari ITP, "clear site data", etc.) — set
// once at consume time, read (never written) by pairing/self.
export const DEVICE_ID_COOKIE = 'sd_pwa_device_id';
export const DEVICE_ID_COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // ~400 days — Chrome's own cookie cap

// Prompt 114 Fase 4.3 — last_seen_at is only useful as a "is this pair still
// alive" signal if it's actually written; throttled so a PWA left open
// doesn't hammer the row on every focus/poll.
export const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

export function generateRawToken(): string {
  return randomBytes(32).toString('base64url'); // opaque, unpredictable, URL-safe
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export type PairingKind = 'startup' | 'investor';

// Resolves which org this browser session may generate/manage a MatchDeal
// pairing for, given which kind the modal is asking for. A dual-role
// account (both a founder and an investor, like the @ablute.pt QA
// account) can hold both — the caller decides which one it wants, the
// same way every other kind-scoped route in this app already works
// (admin_org_actions, matchdeal_profiles' own write policy).
export async function resolveCallerOrgId(
  sb: SupabaseClient, admin: SupabaseClient, userId: string, kind: PairingKind,
): Promise<string | null> {
  if (kind === 'startup') {
    const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
    return (data?.org_id as string | undefined) ?? null;
  }
  const member = await resolveActiveInvestorMember(admin, userId);
  return member?.catalog_entity_id ?? null;
}

export type ConsumeResult =
  | {
      ok: true; pairingId: string; pairedAt: string; orgId: string; kind: PairingKind; userId: string;
      session: { access_token: string; refresh_token: string };
    }
  | { ok: false; error: 'MATCHDEAL_TOKEN_INVALID' | 'MATCHDEAL_TOKEN_EXPIRED' | 'MATCHDEAL_SERVER_ERROR' };

// Prompt 114 Fase 1.2 — issues a real session for an existing user, with
// zero interaction and without sending anything anywhere. GoTrue's admin
// API has no direct "create session for this user_id" method (confirmed by
// reading GoTrueAdminApi's full public surface: signOut, inviteUserByEmail,
// generateLink, createUser, listUsers, getUserById, updateUserById,
// deleteUser — nothing else). The documented zero-interaction workaround is
// this two-step exchange, entirely server-side:
//   1. admin.generateLink({type:'magiclink', email}) — this only GENERATES
//      a hashed_token; unlike signInWithOtp, it never sends an email.
//   2. admin.auth.verifyOtp({token_hash, type:'magiclink'}) — redeems that
//      same token_hash immediately, server-side, and returns a real session
//      (access_token + refresh_token) for the user, exactly as if they'd
//      clicked a real magic link.
// Not a forged token (it's a genuine, single-use, short-lived GoTrue OTP)
// and no email is ever sent — satisfies both constraints Prompt 114 set.
async function issueSessionForUser(
  admin: SupabaseClient, userId: string,
): Promise<{ access_token: string; refresh_token: string } | null> {
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userErr || !email) return null;

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashedToken = linkData?.properties?.hashed_token;
  if (linkErr || !hashedToken) return null;

  const { data: verifyData, error: verifyErr } = await admin.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' });
  if (verifyErr || !verifyData.session) return null;

  return { access_token: verifyData.session.access_token, refresh_token: verifyData.session.refresh_token };
}

// The PWA's own consume path (app.sherlockdeal.com/pair). Logically
// identical to supabase/functions/matchdeal-qr-pair (same hash, same
// validation order, same atomic single-use claim) — kept as a separate
// implementation rather than a shared import because the two callers are
// genuinely different runtimes (Next.js/Node here, Deno at the edge) with
// no code-sharing path between them; a future native app keeps using the
// Edge Function's Bearer-token path, this is only for a browser on this
// domain family.
//
// Prompt 114 Fase 1 — the token alone is the authorization now; there is
// no caller session to compare it against (the whole point is a phone that
// has never signed in anywhere). The user comes from tokenRow.user_id,
// set when the token was generated on an already-authenticated desktop.
// resolveCallerOrgId's wrong-account comparison is removed, not migrated
// to the admin client — a check that no longer checks anything is worse
// than no check, since it misleads whoever reads it next (Prompt 114 §2.1
// instruction, verbatim).
export async function consumePairingToken(
  admin: SupabaseClient, rawToken: string, deviceId: string,
): Promise<ConsumeResult> {
  const tokenHash = hashToken(rawToken);
  const { data: tokenRow } = await admin.from('matchdeal_pairing_tokens').select('*').eq('token_hash', tokenHash).maybeSingle();

  async function audit(result: string, tokenOrgId?: string | null, attemptedByUserId?: string | null) {
    await admin.from('matchdeal_pairing_audit').insert({
      token_hash: tokenHash, token_org_id: tokenOrgId ?? null, attempted_by_user_id: attemptedByUserId ?? null,
      attempted_org_id: tokenOrgId ?? null, result,
    }).then(() => {}, () => {});
  }

  if (!tokenRow) {
    await audit('unknown_token');
    return { ok: false, error: 'MATCHDEAL_TOKEN_INVALID' };
  }
  if (tokenRow.status !== 'active') {
    const category = tokenRow.status === 'used' ? 'already_used' : 'other';
    await audit(category, tokenRow.org_id, tokenRow.user_id);
    await logEvent(admin, { organizationId: tokenRow.org_id, organizationType: tokenRow.kind, eventType: 'matchdeal_pair_failed', failureCategory: category });
    return { ok: false, error: 'MATCHDEAL_TOKEN_INVALID' };
  }
  if (new Date(tokenRow.expires_at) <= new Date()) {
    await admin.from('matchdeal_pairing_tokens').update({ status: 'expired' }).eq('id', tokenRow.id).eq('status', 'active');
    await audit('expired', tokenRow.org_id, tokenRow.user_id);
    await logEvent(admin, { organizationId: tokenRow.org_id, organizationType: tokenRow.kind, eventType: 'matchdeal_pair_failed', failureCategory: 'expired' });
    return { ok: false, error: 'MATCHDEAL_TOKEN_EXPIRED' };
  }

  const { data: claimed } = await admin.from('matchdeal_pairing_tokens')
    .update({ status: 'used', used_at: new Date().toISOString(), used_by_device: deviceId })
    .eq('id', tokenRow.id).eq('status', 'active').select('id').maybeSingle();
  if (!claimed) {
    await audit('already_used', tokenRow.org_id, tokenRow.user_id);
    return { ok: false, error: 'MATCHDEAL_TOKEN_INVALID' };
  }

  const userId = tokenRow.user_id as string;

  // Prompt 75 follow-up (found live, 31/07): this used to always insert a
  // new row, so re-pairing the SAME browser (device_id is a localStorage
  // UUID, not a hardware fingerprint — re-generating a code and consuming
  // it again on the same browser is a completely normal thing to do, e.g.
  // testing "Show QR / pairing code" from the modal, or re-scanning after
  // a session expired) accumulated a fresh `active` row every time,
  // with no unique constraint stopping it. Reuse the existing active
  // pairing for this exact (org, kind, user, device) instead of stacking —
  // same "reopen, don't duplicate" pattern matchdeal_grant_dataroom()
  // already uses for access_grants.
  const { data: existing } = await admin.from('matchdeal_pairings')
    .select('id, paired_at').eq('org_id', tokenRow.org_id).eq('kind', tokenRow.kind)
    .eq('user_id', userId).eq('device_id', deviceId).eq('status', 'active').maybeSingle();

  // Prompt 114 Fase 2.1 — one active device per (org, kind), enforced by a
  // real unique partial index (matchdeal_pairings_one_active_per_org, §3.1)
  // as well as this logic. That index is exactly why this MUST run before
  // the insert below, not after: with the index in place, a second device's
  // INSERT would violate the constraint (there's already an active row for
  // this org+kind) before Fase 2's own disconnect ever got a chance to run.
  // Excludes this exact device_id — a same-device reuse leaves its own row
  // alone rather than disconnecting-then-reinserting it.
  await admin.from('matchdeal_pairings')
    .update({ status: 'disconnected', disconnected_at: new Date().toISOString() })
    .eq('org_id', tokenRow.org_id).eq('kind', tokenRow.kind).eq('status', 'active')
    .neq('device_id', deviceId);

  let pairing: { id: string; paired_at: string } | null = existing ?? null;
  if (pairing) {
    await admin.from('matchdeal_pairings').update({ last_seen_at: new Date().toISOString() }).eq('id', pairing.id);
  } else {
    const { data: inserted, error: pairingErr } = await admin.from('matchdeal_pairings').insert({
      org_id: tokenRow.org_id, kind: tokenRow.kind, user_id: userId, device_id: deviceId,
    }).select('id, paired_at').single();
    if (pairingErr || !inserted) return { ok: false, error: 'MATCHDEAL_SERVER_ERROR' };
    pairing = inserted;
  }

  const session = await issueSessionForUser(admin, userId);
  if (!session) {
    await audit('session_issue_failed', tokenRow.org_id, userId);
    return { ok: false, error: 'MATCHDEAL_SERVER_ERROR' };
  }

  await audit('completed', tokenRow.org_id, userId);
  await logEvent(admin, { organizationId: tokenRow.org_id, organizationType: tokenRow.kind, eventType: 'matchdeal_pair_completed', sourceOfAction: 'manual' });

  return { ok: true, pairingId: pairing.id, pairedAt: pairing.paired_at, orgId: tokenRow.org_id, kind: tokenRow.kind as PairingKind, userId, session };
}

// The viewer's OWN matchdeal_profiles.id — what matchdeal_eligible_deck
// and matchdeal_record_swipe both key off. Distinct from resolveCallerOrgId
// (which returns the ORG the pairing belongs to): membership_id for a
// startup profile is orgs.id, but for an investor profile it's
// matchdeal_investor_members.id, NOT catalog_entities.id — the same
// distinction the RLS fix in migration "matchdeal_pairings_rls_fix" had
// to correct once already.
export async function resolveOwnMatchdealProfileId(
  admin: SupabaseClient, userId: string, kind: PairingKind,
): Promise<string | null> {
  let membershipId: string | null = null;
  if (kind === 'startup') {
    const { data } = await admin.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
    membershipId = (data?.org_id as string | undefined) ?? null;
  } else {
    const member = await resolveActiveInvestorMember(admin, userId);
    membershipId = member?.id ?? null;
  }
  if (!membershipId) return null;
  const { data: profile } = await admin.from('matchdeal_profiles').select('id').eq('membership_id', membershipId).eq('kind', kind).maybeSingle();
  return (profile?.id as string | undefined) ?? null;
}

// Prompt 114 Fase 4.3 — throttled last_seen_at write. Only pairing/self
// calls this (consumePairingToken already stamps it on every claim/reuse).
export async function touchLastSeenIfStale(admin: SupabaseClient, pairingId: string, lastSeenAt: string | null): Promise<void> {
  const staleSince = lastSeenAt ? Date.now() - new Date(lastSeenAt).getTime() : Infinity;
  if (staleSince < LAST_SEEN_THROTTLE_MS) return;
  await admin.from('matchdeal_pairings').update({ last_seen_at: new Date().toISOString() }).eq('id', pairingId);
}

// Prompt 121 §2.7-b's completeness-tier cap here (5/15/999 by profile %) was
// REVOKED by Prompt 123 §0 — replaced for the CRM Pipeline by the milestone
// formula in pipeline-unlock.ts (a different surface: that one governs the
// Investor Pipeline's total unlocked count, not this deck's per-request
// size). This reverts to the plan's own real weekly deck allowance
// (MATCHDEAL_WEEKLY), so p_limit stops being an artificial completeness
// gate and just reflects what the startup's plan actually promises — the
// RPC's own `least(p_limit, v_remaining)` still enforces the real weekly
// quota on top of this. Shared by both entry points that resolve a
// startup's own MatchDeal profile (pairing/self for "open on this device",
// pairing/consume for a fresh QR scan) so it's computed once, not
// duplicated per route.
export async function startupDeckLimit(admin: SupabaseClient, profileId: string): Promise<number> {
  const { data: profile } = await admin.from('matchdeal_profiles').select('membership_id').eq('id', profileId).maybeSingle();
  const orgId = profile?.membership_id as string | undefined;
  if (!orgId) return 10; // unchanged fallback — matches the deck's pre-existing hardcoded default
  const { data: org } = await admin.from('orgs').select('plan').eq('id', orgId).maybeSingle();
  if (!org) return 10;
  return MATCHDEAL_WEEKLY[normalizePlan(org.plan as string | null)].deck;
}
