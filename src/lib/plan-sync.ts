// Prompt 113 §2(a)/(b) — the side-effects a change to orgs.plan must carry
// with it so the plan copy never promises what the product doesn't deliver.
// Two writers of orgs.plan exist (backoffice manual override, Stripe
// webhook) and both must call this in the same request, or the two systems
// drift again exactly the way they already had.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PLAN_TO_MATCHDEAL_TIER, type PlanTier } from './plans';
import { computeVisiblePipelineSize, raiseCatalogQuotaFloor } from './pipeline-unlock-server';

export async function applyPlanChangeSideEffects(admin: SupabaseClient, orgId: string, tier: PlanTier): Promise<void> {
  // matchdeal_profiles.plan_tier — what matchdeal_tier_limits() actually
  // enforces server-side. membership_id = orgs.id for kind='startup' (see
  // matchdeal-pairing.ts's own note on the same distinction). A plain
  // upsert on the (membership_id, kind) constraint only touches this one
  // column — every other field on an existing row is left alone.
  await admin.from('matchdeal_profiles')
    .upsert({ membership_id: orgId, kind: 'startup', plan_tier: PLAN_TO_MATCHDEAL_TIER[tier] }, { onConflict: 'membership_id,kind' });

  // orgs.catalog_quota — Prompt 180: no longer floored against the retired
  // CATALOG_QUOTA[tier] constant (plans.ts). Both callers of this function
  // (Stripe webhook, backoffice set-plan) already write orgs.plan = tier to
  // the DB BEFORE calling this, so re-deriving the target from the org row
  // read fresh here already reflects the NEW tier — same formula/inputs as
  // the pipeline-unlock badge (computeVisiblePipelineSize, uncapped by the
  // eligible pool), never a second calculation.
  const { catalogQuotaTarget } = await computeVisiblePipelineSize(admin, orgId);
  await raiseCatalogQuotaFloor(admin, orgId, catalogQuotaTarget);
}
