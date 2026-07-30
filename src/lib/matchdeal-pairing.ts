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

export const PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000; // spec Section 4 — 5 minutes
export const PAIRING_RATE_LIMIT_PER_HOUR = 10; // spec Section 8

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
  const { data } = await admin.from('matchdeal_investor_members').select('catalog_entity_id')
    .eq('user_id', userId).eq('status', 'active').maybeSingle();
  return (data?.catalog_entity_id as string | undefined) ?? null;
}

export type ConsumeResult =
  | { ok: true; pairingId: string; pairedAt: string; orgId: string; kind: PairingKind }
  | { ok: false; error: 'MATCHDEAL_TOKEN_INVALID' | 'MATCHDEAL_TOKEN_EXPIRED' | 'MATCHDEAL_WRONG_ACCOUNT' | 'MATCHDEAL_SERVER_ERROR' };

// The PWA's own consume path (app.sherlockdeal.com/pair, cookie session).
// Logically identical to supabase/functions/matchdeal-qr-pair (same hash,
// same validation order, same atomic single-use claim) — kept as a
// separate implementation rather than a shared import because the two
// callers are genuinely different runtimes (Next.js/Node here, Deno at
// the edge) with no code-sharing path between them; a future native app
// keeps using the Edge Function's Bearer-token path, this is only for a
// browser session already on this domain family.
export async function consumePairingToken(
  admin: SupabaseClient, sb: SupabaseClient, rawToken: string, userId: string, deviceId: string,
): Promise<ConsumeResult> {
  const tokenHash = hashToken(rawToken);
  const { data: tokenRow } = await admin.from('matchdeal_pairing_tokens').select('*').eq('token_hash', tokenHash).maybeSingle();

  async function audit(result: string, tokenOrgId?: string | null, attemptedOrgId?: string | null) {
    await admin.from('matchdeal_pairing_audit').insert({
      token_hash: tokenHash, token_org_id: tokenOrgId ?? null, attempted_by_user_id: userId,
      attempted_org_id: attemptedOrgId ?? null, result,
    }).then(() => {}, () => {});
  }

  if (!tokenRow) {
    await audit('unknown_token');
    return { ok: false, error: 'MATCHDEAL_TOKEN_INVALID' };
  }
  if (tokenRow.status !== 'active') {
    const category = tokenRow.status === 'used' ? 'already_used' : 'other';
    await audit(category, tokenRow.org_id);
    await logEvent(admin, { organizationId: tokenRow.org_id, organizationType: tokenRow.kind, eventType: 'matchdeal_pair_failed', failureCategory: category });
    return { ok: false, error: 'MATCHDEAL_TOKEN_INVALID' };
  }
  if (new Date(tokenRow.expires_at) <= new Date()) {
    await admin.from('matchdeal_pairing_tokens').update({ status: 'expired' }).eq('id', tokenRow.id).eq('status', 'active');
    await audit('expired', tokenRow.org_id);
    await logEvent(admin, { organizationId: tokenRow.org_id, organizationType: tokenRow.kind, eventType: 'matchdeal_pair_failed', failureCategory: 'expired' });
    return { ok: false, error: 'MATCHDEAL_TOKEN_EXPIRED' };
  }

  const callerOrgId = await resolveCallerOrgId(sb, admin, userId, tokenRow.kind as PairingKind);
  if (!callerOrgId || callerOrgId !== tokenRow.org_id) {
    await audit('wrong_account', tokenRow.org_id, callerOrgId);
    await logEvent(admin, { organizationId: tokenRow.org_id, organizationType: tokenRow.kind, eventType: 'matchdeal_pair_failed', failureCategory: 'wrong_account' });
    return { ok: false, error: 'MATCHDEAL_WRONG_ACCOUNT' };
  }

  const { data: claimed } = await admin.from('matchdeal_pairing_tokens')
    .update({ status: 'used', used_at: new Date().toISOString(), used_by_device: deviceId })
    .eq('id', tokenRow.id).eq('status', 'active').select('id').maybeSingle();
  if (!claimed) {
    await audit('already_used', tokenRow.org_id, callerOrgId);
    return { ok: false, error: 'MATCHDEAL_TOKEN_INVALID' };
  }

  const { data: pairing, error: pairingErr } = await admin.from('matchdeal_pairings').insert({
    org_id: tokenRow.org_id, kind: tokenRow.kind, user_id: userId, device_id: deviceId,
  }).select('id, paired_at').single();
  if (pairingErr || !pairing) return { ok: false, error: 'MATCHDEAL_SERVER_ERROR' };

  await audit('completed', tokenRow.org_id, callerOrgId);
  await logEvent(admin, { organizationId: tokenRow.org_id, organizationType: tokenRow.kind, eventType: 'matchdeal_pair_completed', sourceOfAction: 'manual' });

  return { ok: true, pairingId: pairing.id, pairedAt: pairing.paired_at, orgId: tokenRow.org_id, kind: tokenRow.kind as PairingKind };
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
    const { data } = await admin.from('matchdeal_investor_members').select('id').eq('user_id', userId).eq('status', 'active').maybeSingle();
    membershipId = (data?.id as string | undefined) ?? null;
  }
  if (!membershipId) return null;
  const { data: profile } = await admin.from('matchdeal_profiles').select('id').eq('membership_id', membershipId).eq('kind', kind).maybeSingle();
  return (profile?.id as string | undefined) ?? null;
}
