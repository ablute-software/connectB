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
