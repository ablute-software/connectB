// Prompt 161 — server-side orchestration for the Pioneer badge/referral
// mechanism. Pure decision logic lives in pioneer.ts; this file is only the
// DB reads/writes composing it, same split as catalog-monthly-delivery.ts/
// -server.ts earlier this session.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isPioneerBadgeDue, buildReferralCodeDrafts } from './pioneer';
import { generatePromoCode } from './promo';
import type { PlanTier } from './types';

export interface GrantPioneerResult {
  badgeGranted: boolean;
  referralCodesCreated: number;
}

/**
 * Idempotent: safe to call repeatedly for the same org (retries, a
 * duplicate cron tick, a second redemption that also qualifies). The
 * badge-set UPDATE only ever matches a row the FIRST time (guarded by
 * `.eq('pioneer_badge', false)`), and referral codes are only ever created
 * once per org — checked by existence, not by whether this call is the one
 * that set the badge, so a badge granted through some other future path
 * (e.g. a manual back-office grant) still gets its 3 codes exactly once.
 */
export async function grantPioneerBadgeAndReferrals(
  admin: SupabaseClient, orgId: string, originatingApplicablePlans: PlanTier[],
): Promise<GrantPioneerResult> {
  const { data: updated } = await admin
    .from('orgs').update({ pioneer_badge: true }).eq('id', orgId).eq('pioneer_badge', false)
    .select('id').maybeSingle();
  const badgeGranted = !!updated;

  const { count: existingReferrals } = await admin
    .from('promo_codes').select('id', { count: 'exact', head: true }).eq('referral_of_org_id', orgId);
  if ((existingReferrals ?? 0) > 0) return { badgeGranted, referralCodesCreated: 0 };

  const drafts = buildReferralCodeDrafts(orgId, originatingApplicablePlans, generatePromoCode);
  const { error } = await admin.from('promo_codes').insert(drafts);
  return { badgeGranted, referralCodesCreated: error ? 0 : drafts.length };
}

/**
 * The daily sweep (called from /api/automations, no day-of-month gate —
 * unlike the monthly catalog job, a Pioneer redemption can expire on any
 * day). Scans every promo_redemptions row with a pioneer-sourced,
 * time-boxed benefit; for each org whose benefit has just (or already)
 * expired and doesn't have the badge yet, grants it. Never touches
 * orgs.plan — see migration 0167's own header for why no downgrade write
 * is needed here at all.
 */
export async function runPioneerExpiryJob(admin: SupabaseClient, nowIso: string): Promise<{ orgsGranted: number }> {
  const { data: redemptions } = await admin
    .from('promo_redemptions')
    .select('org_id, benefit_ends_at, promo_codes(is_pioneer, applicable_plans)')
    .not('benefit_ends_at', 'is', null);

  const now = new Date(nowIso);
  const dueOrgIds = new Map<string, PlanTier[]>();
  for (const r of redemptions ?? []) {
    const promo = r.promo_codes as unknown as { is_pioneer: boolean; applicable_plans: PlanTier[] } | null;
    if (!promo || !isPioneerBadgeDue(promo.is_pioneer, r.benefit_ends_at as string | null, now)) continue;
    const orgId = r.org_id as string;
    if (!dueOrgIds.has(orgId)) dueOrgIds.set(orgId, promo.applicable_plans ?? []);
  }
  if (dueOrgIds.size === 0) return { orgsGranted: 0 };

  const { data: orgRows } = await admin.from('orgs').select('id, pioneer_badge').in('id', [...dueOrgIds.keys()]);
  const alreadyBadged = new Set((orgRows ?? []).filter((o) => o.pioneer_badge).map((o) => o.id as string));

  let orgsGranted = 0;
  for (const [orgId, plans] of dueOrgIds) {
    if (alreadyBadged.has(orgId)) continue;
    const result = await grantPioneerBadgeAndReferrals(admin, orgId, plans);
    if (result.badgeGranted) orgsGranted++;
  }
  return { orgsGranted };
}
