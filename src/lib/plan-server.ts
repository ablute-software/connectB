// Server-side plan resolution, shared by /api/me and the compose route so the
// entitlement gate is computed the same way in both places. Reads through the
// caller's own RLS-scoped client — the orgs select policy (is_org_member) lets
// a member read their own org row, so no service-role is needed for that part.
//
// Prompt 914 — the RULE ("stored plan, raised by a 100% free trial that is still running and by a badge's free tier") moved out of
// here into effective-plan.ts / effective-plan-server.ts, so the limits that never went through this function (the investor quota,
// the monthly delivery, the AI wallet) can ask the same question. This file keeps what is specific to a request: finding the acting
// org and reading its stored plan under the caller's own session.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveEffectivePlan, type PlanOrigin } from './effective-plan';
import { effectivePlanDetailForOrg } from './effective-plan-server';
import type { PlanTier } from './types';
import type { ActingOrg } from './acting-org';

export interface UserPlanDetail {
  orgId: string | null;
  /** The plan the org is entitled to right now (stored ⊕ free trial ⊕ badge). */
  plan: PlanTier;
  /** What orgs.plan says. */
  stored: PlanTier;
  /** Why `plan` is what it is — shown next to the plan name so "I redeemed a code and it still says Elementary" has an answer. */
  origin: PlanOrigin;
}

// Prompt 904 — pass `acting` (resolveActingOrg's answer) when the route already has it: the plan is
// the ACTING org's, which in a Developer Viewer session is the viewed org, never the developer's own.
// Without it the org is the caller's own membership, as before.
export async function resolveUserPlanDetail(
  userId: string,
  sb: SupabaseClient,
  acting?: Pick<ActingOrg, 'orgId'>,
): Promise<UserPlanDetail> {
  let orgId: string | null;
  if (acting) {
    orgId = acting.orgId;
  } else {
    const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
    orgId = (member?.org_id as string | undefined) ?? null;
  }
  if (!orgId) return { orgId: null, plan: 'idea', stored: 'idea', origin: { kind: 'stored' } };
  const { data: org } = await sb.from('orgs').select('plan').eq('id', orgId).maybeSingle();
  const storedPlan = (org?.plan as string | null | undefined) ?? null;

  // A redeemed promo never writes org.plan — it's a billing-display concern (see /api/promo/redeem), not a real subscription change.
  // But a genuine FREE TRIAL (100% off) still has to grant the actual entitlements of the plan it covers, or "3 months free of It's
  // the butler!" would just be a price preview with nothing to try. Computed live on every read, never written anywhere, so the boost
  // reverts automatically the moment benefit_ends_at passes. promo_redemptions/promo_codes RLS is platform_admin-only (0040) — an
  // ordinary founder session can't read them, so the lookup goes through the service role, same as every promo write already does.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { orgId, ...resolveEffectivePlan(storedPlan, null, null) };
  const admin = createClient(url, service, { auth: { persistSession: false } });
  return { orgId, ...(await effectivePlanDetailForOrg(admin, orgId, { storedPlan })) };
}

export async function resolveUserPlan(
  userId: string,
  sb: SupabaseClient,
  acting?: Pick<ActingOrg, 'orgId'>,
): Promise<{ orgId: string | null; plan: PlanTier }> {
  const { orgId, plan } = await resolveUserPlanDetail(userId, sb, acting);
  return { orgId, plan };
}
