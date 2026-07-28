// Server-side plan resolution, shared by /api/me and the compose route so the
// entitlement gate is computed the same way in both places. Reads through the
// caller's own RLS-scoped client — the orgs select policy (is_org_member) lets
// a member read their own org row, so no service-role is needed for that part.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizePlan, PLAN_TIERS } from './plans';
import { benefitStillActive } from './promo';
import type { PlanTier } from './types';

function tierRank(t: PlanTier): number {
  return PLAN_TIERS.indexOf(t);
}

export async function resolveUserPlan(
  userId: string,
  sb: SupabaseClient,
): Promise<{ orgId: string | null; plan: PlanTier }> {
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  const orgId = (member?.org_id as string | undefined) ?? null;
  if (!orgId) return { orgId: null, plan: 'idea' };
  const { data: org } = await sb.from('orgs').select('plan').eq('id', orgId).maybeSingle();
  const storedPlan = normalizePlan(org?.plan as string | null | undefined);

  // A redeemed promo never writes org.plan — it's a billing-display concern
  // (see /api/promo/redeem), not a real subscription change. But a genuine
  // FREE TRIAL (100% off) still has to grant the actual entitlements of the
  // plan it covers, or "3 months free of It's the buttler!" would just be a
  // price preview with nothing to try. A PARTIAL discount (30% off, say)
  // does NOT do this — the org still has to actually subscribe/request at
  // the discounted price to get that tier's features; only a 0-euro
  // redemption has no payment gap left to bridge. Computed live on every
  // read, never written anywhere, so the boost reverts automatically the
  // moment benefit_ends_at passes — no cron, nothing to remember to clean up.
  const trialTier = await bestFreeTrialTier(orgId);
  const effectivePlan = trialTier && tierRank(trialTier) > tierRank(storedPlan) ? trialTier : storedPlan;

  return { orgId, plan: effectivePlan };
}

async function bestFreeTrialTier(orgId: string): Promise<PlanTier | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // promo_redemptions/promo_codes RLS is platform_admin-only (0040) — an
  // ordinary founder session can't read them directly, so this one lookup
  // goes through the service role, same as every promo write already does.
  if (!url || !service) return null;
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: redemptions } = await admin
    .from('promo_redemptions')
    .select('benefit_ends_at, promo_codes(discount_pct, applicable_plans)')
    .eq('org_id', orgId);
  if (!redemptions) return null;

  const now = new Date();
  let best: PlanTier | null = null;
  for (const r of redemptions) {
    if (!benefitStillActive(r.benefit_ends_at, now)) continue;
    const promo = r.promo_codes as unknown as { discount_pct: number; applicable_plans: PlanTier[] } | null;
    if (!promo || promo.discount_pct !== 100) continue;
    for (const tier of promo.applicable_plans) {
      if (!best || tierRank(tier) > tierRank(best)) best = tier;
    }
  }
  return best;
}
