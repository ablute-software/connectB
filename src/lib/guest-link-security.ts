// Prompt 537 §4 — the two hardening pieces the guest route needs, pure and
// testable, kept out of the route so both can be unit-tested without a
// Supabase client.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashToken } from './matchdeal-pairing';

// §4.2 — 30 requests per minute per IP. Token guessing is infeasible at 256
// bits; this exists to stop cheap enumeration of the invalid/expired
// responses, which otherwise let someone probe whether a given token ever
// existed. Same table-counted-per-window shape as support_rate_limit (0036)
// and investor_access_request_rate_limit — checked before adding anything
// new, per this prompt's own instruction.
export const GUEST_LINK_RATE_LIMIT_PER_MINUTE = 30;
export const GUEST_LINK_RATE_WINDOW_MS = 60 * 1000;

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Records this attempt and reports whether the caller has now exceeded the
 * window. Records FIRST, exactly like support/submit: a client that keeps
 * hammering after being limited still burns its own budget instead of
 * resetting it by backing off for less than the window.
 *
 * Fail-OPEN on a database error, and that is deliberate: this limiter
 * protects against scraping, not against data loss, and a transient
 * Postgres blip must not take a founder's shared data room offline for
 * every guest. The trade is stated rather than silent.
 */
export async function guestLinkRateLimited(admin: SupabaseClient, ip: string): Promise<boolean> {
  try {
    await admin.from('guest_link_rate_limit').insert({ ip });
    const since = new Date(Date.now() - GUEST_LINK_RATE_WINDOW_MS).toISOString();
    const { count, error } = await admin.from('guest_link_rate_limit')
      .select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since);
    if (error) return false;
    return (count ?? 0) > GUEST_LINK_RATE_LIMIT_PER_MINUTE;
  } catch {
    return false;
  }
}

/**
 * §4.1 — resolve a guest grant from a RAW token, by hash first.
 *
 * The database now stores sha256(token); a read of access_grants no longer
 * yields a working link. The raw column still exists and is still matched as
 * a FALLBACK, because links minted before this change are already sitting in
 * recipients' inboxes — every one of them expires by 2026-09-30, and the raw
 * column is dropped in a later migration once they have. Removing the
 * fallback today would break live, legitimately-shared links.
 *
 * Order matters: hash first, so a row that has been migrated resolves
 * through the hash path and the fallback is only ever reached by rows that
 * genuinely predate it.
 */
export async function findGrantByGuestToken(
  admin: SupabaseClient, rawToken: string,
): Promise<{ grant: Record<string, unknown> | null; matchedBy: 'hash' | 'raw' | null }> {
  const tokenHash = hashToken(rawToken);

  const { data: byHash } = await admin.from('access_grants').select('*')
    .eq('guest_token_hash', tokenHash).is('revoked_at', null).maybeSingle();
  if (byHash) return { grant: byHash as Record<string, unknown>, matchedBy: 'hash' };

  const { data: byRaw } = await admin.from('access_grants').select('*')
    .eq('guest_token', rawToken).is('revoked_at', null).maybeSingle();
  if (byRaw) {
    // Self-heal, and this is load-bearing rather than tidy-up.
    //
    // Migration 0297's backfill is a one-shot statement: it hashed every row
    // that existed WHEN IT RAN. Production kept minting raw-only tokens after
    // that, because the code that writes the hash is on this branch and the
    // deployed build is not (observed directly: two invites at 17:10 and
    // 17:15 UTC on 2026-09-02, both raw-only, minted while this was being
    // built). Any window between applying a migration and shipping the code
    // produces the same gap, and a second backfill migration would only move
    // the window rather than close it.
    //
    // Writing the hash the first time such a row is resolved means the raw
    // column stops accumulating new dependents on its own, so the later
    // migration that drops it has a shrinking set to wait on instead of a
    // moving target. Errors are ignored on purpose: failing to upgrade a row
    // must never fail the guest's request — the raw match already succeeded.
    const row = byRaw as Record<string, unknown>;
    if (!row.guest_token_hash) {
      await admin.from('access_grants').update({ guest_token_hash: tokenHash }).eq('id', row.id as string)
        .then(() => {}, () => {});
    }
    return { grant: row, matchedBy: 'raw' };
  }

  return { grant: null, matchedBy: null };
}
