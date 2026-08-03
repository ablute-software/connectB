// Prompt 113 §2(a)/(b) — the side-effects a change to orgs.plan must carry
// with it so the plan copy never promises what the product doesn't deliver.
// Two writers of orgs.plan exist (backoffice manual override, Stripe
// webhook) and both must call this in the same request, or the two systems
// drift again exactly the way they already had.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CATALOG_QUOTA, PLAN_TO_MATCHDEAL_TIER, type PlanTier } from './plans';

export async function applyPlanChangeSideEffects(admin: SupabaseClient, orgId: string, tier: PlanTier): Promise<void> {
  // matchdeal_profiles.plan_tier — what matchdeal_tier_limits() actually
  // enforces server-side. membership_id = orgs.id for kind='startup' (see
  // matchdeal-pairing.ts's own note on the same distinction). A plain
  // upsert on the (membership_id, kind) constraint only touches this one
  // column — every other field on an existing row is left alone.
  await admin.from('matchdeal_profiles')
    .upsert({ membership_id: orgId, kind: 'startup', plan_tier: PLAN_TO_MATCHDEAL_TIER[tier] }, { onConflict: 'membership_id,kind' });

  // orgs.catalog_quota — an accumulating counter (RLS reads this column
  // directly, never the CATALOG_QUOTA constant), never lowered so an org
  // never loses entities it already unlocked.
  const { data: org } = await admin.from('orgs').select('catalog_quota').eq('id', orgId).maybeSingle();
  const floor = CATALOG_QUOTA[tier];
  if (org && (org.catalog_quota ?? 0) < floor) {
    await admin.from('orgs').update({ catalog_quota: floor }).eq('id', orgId);
  }
}
