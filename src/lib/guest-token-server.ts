// Prompt 530 — the guest-token mint/reuse that /api/data-room/guest-invite
// grew inline, extracted so the access-change notification can hand a guest
// the SAME live link instead of minting a second one beside it. Two copies
// of this logic is exactly how a recipient ends up with two valid tokens
// for one relationship.
//
// Behaviour is unchanged from the inline version, plus one fix (§B below).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateRawToken } from './matchdeal-pairing';

// Decision (2026-08-07): 14 days. Only the FALLBACK — used when none of the
// pending grants behind the link carry an expires_at of their own.
export const GUEST_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface GuestTokenResult {
  ok: boolean;
  token?: string;
  expiresAt?: string;
  error?: string;
}

/**
 * Returns the live guest-preview token for `email` in `orgId`, minting one
 * if there isn't a usable one. Idempotent by design: a link already shared
 * with a recipient must keep working, so a live token is handed back rather
 * than rotated.
 *
 * §B (Prompt 530) — one behaviour change: when the recipient's grants have
 * been extended past the token's own expiry, the LIVE token's expiry moves
 * out with them (same token, so nothing already sent breaks). Without this,
 * extending a grant left the founder with a link that died before the
 * access it unlocks — the guest route checks guest_token_expires_at first
 * and would have shown "this link has expired" over perfectly valid grants.
 */
export async function ensureGuestToken(
  admin: SupabaseClient, orgId: string, email: string,
  opts: { retries?: number; delayMs?: number } = {},
): Promise<GuestTokenResult> {
  const retries = opts.retries ?? 1;
  const delayMs = opts.delayMs ?? 300;

  type PendingGrant = { id: string; guest_token: string | null; guest_token_expires_at: string | null };
  let grant: PendingGrant | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    const { data } = await admin.from('access_grants').select('id, guest_token, guest_token_expires_at')
      .eq('org_id', orgId).eq('invited_email', email).is('confirmed_at', null).is('revoked_at', null)
      .order('granted_at', { ascending: false }).limit(1).maybeSingle();
    if (data) { grant = data as PendingGrant; break; }
    if (attempt < retries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  if (!grant) return { ok: false, error: 'No pending invite found for that email yet.' };

  // The link's own expiry follows the REAL access it unlocks: the latest
  // expires_at among the currently-pending grants for this email. Only when
  // none of them have one at all does the flat 14-day fallback apply.
  const { data: pendingGrants } = await admin.from('access_grants').select('expires_at')
    .eq('org_id', orgId).eq('invited_email', email).is('confirmed_at', null).is('revoked_at', null);
  const rows = pendingGrants ?? [];
  const datedExpiries = rows.map((g) => g.expires_at as string | null).filter((e): e is string => !!e);
  // An undated grant is indefinite access — it must not be shortened by a
  // dated sibling, so the link stays open on the 14-day fallback instead.
  const anyUndated = rows.some((g) => !g.expires_at);
  const latestGrantExpiry = !anyUndated && datedExpiries.length > 0
    ? datedExpiries.reduce((a, b) => (a > b ? a : b))
    : null;

  const now = new Date();

  // Prompt 530 — every grant behind this link has already expired. Minting
  // a token whose expiry is that same past date produced a link that was
  // dead on arrival: "Resend" appeared to work and the recipient got
  // "this link has expired". Say so instead, so the founder extends the
  // access first — a resend has to represent access that actually exists.
  if (latestGrantExpiry && new Date(latestGrantExpiry) <= now) {
    return { ok: false, error: 'This recipient\'s access has expired — extend it before resending the link.' };
  }

  const stillLive = grant.guest_token && grant.guest_token_expires_at && new Date(grant.guest_token_expires_at) > now;

  if (stillLive) {
    const currentExpiry = grant.guest_token_expires_at as string;
    if (latestGrantExpiry && latestGrantExpiry > currentExpiry) {
      const { error } = await admin.from('access_grants')
        .update({ guest_token_expires_at: latestGrantExpiry }).eq('id', grant.id);
      if (error) return { ok: false, error: error.message };
      return { ok: true, token: grant.guest_token as string, expiresAt: latestGrantExpiry };
    }
    return { ok: true, token: grant.guest_token as string, expiresAt: currentExpiry };
  }

  const token = generateRawToken();
  const expiresAt = latestGrantExpiry ?? new Date(Date.now() + GUEST_TOKEN_TTL_MS).toISOString();
  const { error } = await admin.from('access_grants')
    .update({ guest_token: token, guest_token_expires_at: expiresAt })
    .eq('id', grant.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, token, expiresAt };
}
