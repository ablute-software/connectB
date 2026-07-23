// Server-side plan resolution, shared by /api/me and the compose route so the
// entitlement gate is computed the same way in both places. Reads through the
// caller's own RLS-scoped client — the orgs select policy (is_org_member) lets
// a member read their own org row, so no service-role is needed here.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePlan } from './plans';
import type { PlanTier } from './types';

export async function resolveUserPlan(
  userId: string,
  sb: SupabaseClient,
): Promise<{ orgId: string | null; plan: PlanTier }> {
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  const orgId = (member?.org_id as string | undefined) ?? null;
  if (!orgId) return { orgId: null, plan: 'idea' };
  const { data: org } = await sb.from('orgs').select('plan').eq('id', orgId).maybeSingle();
  return { orgId, plan: normalizePlan(org?.plan as string | null | undefined) };
}
