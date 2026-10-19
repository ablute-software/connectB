// Prompt 914 — the reads behind effective-plan.ts: one function, effectivePlanForOrg(admin, orgId), that every plan-dependent limit
// asks instead of reading orgs.plan itself. Takes a service-role client on purpose: promo_redemptions / promo_codes are
// platform-admin-only under RLS (0040), so an ordinary session cannot read them, and the limits this feeds (the investor quota, the
// monthly delivery, the MatchDeal deck, the AI wallet's viewer mirror) are computed server-side with the service role anyway.
//
// Revoked badges are read too and dropped by the rule itself (bestFreeBadge re-checks revoked_at, the same way the SQL does): fewer
// builder methods, so the same code runs over the smallest fake database.
//
// A failed read (a table that is not there yet, a PostgREST error) degrades to "no free trial / no badge", i.e. to the stored plan —
// the same thing the old plan-server.ts did — never to an exception that takes a whole route down for want of a nice-to-have.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  effectivePlanFromRows, type BadgeFreeRow, type EffectivePlan, type TrialRedemptionRow,
} from './effective-plan';
import type { PlanTier } from './types';

export const TRIAL_COLUMNS = 'benefit_ends_at, promo_codes(code, discount_pct, applicable_plans, deleted_at)';
export const BADGE_COLUMNS = 'badge, free_tier, free_until, revoked_at';

const CHUNK = 100;

const rows = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

/**
 * The plan an org is on right now, with where it comes from. `opts.storedPlan` spares the orgs read when the caller already has the
 * row (`undefined` = read it; `null` = the row says no plan, which is the free tier). `opts.now` is for tests.
 */
export async function effectivePlanDetailForOrg(
  admin: SupabaseClient, orgId: string, opts: { storedPlan?: string | null; now?: Date } = {},
): Promise<EffectivePlan> {
  const [stored, { data: redemptions }, { data: badges }] = await Promise.all([
    opts.storedPlan !== undefined
      ? Promise.resolve(opts.storedPlan)
      : admin.from('orgs').select('plan').eq('id', orgId).maybeSingle().then(({ data }) => (data?.plan as string | null | undefined) ?? null),
    admin.from('promo_redemptions').select(TRIAL_COLUMNS).eq('org_id', orgId),
    admin.from('platform_badges').select(BADGE_COLUMNS).eq('org_id', orgId),
  ]);
  return effectivePlanFromRows(stored, rows<TrialRedemptionRow>(redemptions), rows<BadgeFreeRow>(badges), opts.now ?? new Date());
}

/** The one the limits use: just the tier. */
export async function effectivePlanForOrg(
  admin: SupabaseClient, orgId: string, opts: { storedPlan?: string | null; now?: Date } = {},
): Promise<PlanTier> {
  return (await effectivePlanDetailForOrg(admin, orgId, opts)).plan;
}

/**
 * Many orgs at once — two queries, not 2 × N — for the screens that show a number per org (the back-office Startups table). Same
 * rule, same function underneath; an org with nothing special simply resolves to its stored plan.
 */
export async function effectivePlansForOrgs(
  admin: SupabaseClient, orgs: { id: string; plan: string | null | undefined }[], now: Date = new Date(),
): Promise<Map<string, EffectivePlan>> {
  const redemptionsByOrg = new Map<string, TrialRedemptionRow[]>();
  const badgesByOrg = new Map<string, BadgeFreeRow[]>();
  for (let i = 0; i < orgs.length; i += CHUNK) {
    const ids = orgs.slice(i, i + CHUNK).map((o) => o.id);
    const [{ data: redemptions }, { data: badges }] = await Promise.all([
      admin.from('promo_redemptions').select(`org_id, ${TRIAL_COLUMNS}`).in('org_id', ids),
      admin.from('platform_badges').select(`org_id, ${BADGE_COLUMNS}`).in('org_id', ids),
    ]);
    for (const r of rows<TrialRedemptionRow & { org_id: string }>(redemptions)) (redemptionsByOrg.get(r.org_id) ?? redemptionsByOrg.set(r.org_id, []).get(r.org_id)!).push(r);
    for (const b of rows<BadgeFreeRow & { org_id: string }>(badges)) (badgesByOrg.get(b.org_id) ?? badgesByOrg.set(b.org_id, []).get(b.org_id)!).push(b);
  }
  return new Map(orgs.map((o) => [o.id, effectivePlanFromRows(o.plan ?? null, redemptionsByOrg.get(o.id), badgesByOrg.get(o.id), now)]));
}
