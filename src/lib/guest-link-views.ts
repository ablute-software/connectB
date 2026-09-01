import 'server-only';
// Prompt 526 Part C — recording that a guest link was opened, and from how many
// distinct places. Visibility for the founder; never a block.
//
// Nuno asked for IP-based blocking; that was argued against and this is the
// opposite of it. Nothing here refuses anyone, hides a link or revokes a grant.
// See 0293_guest_link_views.sql for why IP is not a usable signal (NAT, mobile
// networks, and the Outlook/Gmail link scanners that fetch the URL before the
// recipient ever clicks).
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeCapabilityProbe } from './capability-probe';

export const GUEST_VISITOR_COOKIE = 'sd_guest_visitor';
// Long enough that a genuine second visit weeks later is still recognised as
// the same device rather than inflating the count.
export const GUEST_VISITOR_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

/**
 * The count at which the founder is told. Three, chosen deliberately: one
 * device is the norm, two is a phone plus a laptop and completely unremarkable,
 * so three is the first number that is worth a second look — while still being
 * innocent often enough that this must never do anything by itself.
 */
export const MULTI_DEVICE_THRESHOLD = 3;

// Same probe pattern the access-request capabilities use, so nothing breaks in
// an environment where 0293 has not been applied yet: the table is simply
// absent, recording no-ops, and the founder-facing count stays hidden.
export const guestLinkViewsAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('guest_link_views').select('id').limit(1);
  return !error;
});

/** Opaque and random — it identifies a browser, never a person. */
export function newVisitorKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Record one open. Upserts on (grant_id, visitor_key) so a reload bumps the
 * existing row instead of counting as another device — the distinction the
 * whole feature rests on.
 *
 * Never throws and never blocks the response: a failure here must not stop a
 * legitimate visitor from seeing the data room they were invited to.
 */
export async function recordGuestLinkView(
  admin: SupabaseClient, grantId: string, visitorKey: string,
): Promise<void> {
  try {
    if (!(await guestLinkViewsAvailable())) return;
    const now = new Date().toISOString();
    const { data: existing } = await admin.from('guest_link_views')
      .select('id, view_count').eq('grant_id', grantId).eq('visitor_key', visitorKey).maybeSingle();
    if (existing) {
      await admin.from('guest_link_views')
        .update({ last_seen_at: now, view_count: ((existing.view_count as number) ?? 1) + 1 })
        .eq('id', existing.id as string);
      return;
    }
    await admin.from('guest_link_views')
      .insert({ grant_id: grantId, visitor_key: visitorKey, first_seen_at: now, last_seen_at: now, view_count: 1 });
  } catch (e) {
    console.error('[guest-link-views] could not record an open:', (e as Error).message);
  }
}

/** Distinct devices/sessions per grant — NOT total opens. */
export async function distinctDeviceCounts(
  admin: SupabaseClient, grantIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (grantIds.length === 0) return out;
  try {
    if (!(await guestLinkViewsAvailable())) return out;
    const { data } = await admin.from('guest_link_views').select('grant_id').in('grant_id', grantIds);
    for (const row of data ?? []) {
      const id = row.grant_id as string;
      out.set(id, (out.get(id) ?? 0) + 1);
    }
  } catch { /* absent table or transient failure — no count, never an error */ }
  return out;
}
