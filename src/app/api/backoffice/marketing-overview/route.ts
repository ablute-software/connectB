// Prompt 875 — Backoffice Marketing "Overview" tab. Read-only dashboard,
// single GET returning all four sections in one payload (no per-widget round
// trips — this page has no per-widget interactivity to justify them).
// requirePlatformAdmin, same defense-in-depth pattern as every other
// /api/backoffice/* route.
//
// The two heavier aggregates (per-org AI cost sums against ai_call_log,
// monthly revenue against billing_invoices — both tables the prompt itself
// names as growing without bound) are computed in Postgres via the RPC
// functions from migration 20260910090000, not by pulling every row into
// Node. Everything else here (promo_codes, promo_redemptions,
// promo_outreach_targets) is a small, admin-authored table — no such
// concern, plain supabase-js queries reduced in JS.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { PLANS, planLabelForSlug, type PlanTier } from '@/lib/plans';
import type { OutreachCategory } from '@/lib/promo';

// Prompt 875 §4 — "paying plan" tier list read from plans.ts's own `paid`
// flag, not hand-typed, per the prompt's own instruction not to guess.
const PAYING_PLAN_TIERS = new Set(PLANS.filter((p) => p.paid).map((p) => p.tier));

// Nuno's four categories collapse the DB's five onto four display rows:
// accelerator + incubator merge into one ("Aceleradoras/incubadoras") — the
// prompt's own instruction is to merge them for DISPLAY only, never in the
// DB, so promo_outreach_targets.category keeps writing five distinct values.
const CATEGORY_DISPLAY_GROUPS: { label: string; categories: OutreachCategory[] }[] = [
  { label: 'Contacto directo', categories: ['startup'] },
  { label: 'VC', categories: ['vc'] },
  { label: 'Programas patrocinados', categories: ['program'] },
  { label: 'Aceleradoras/incubadoras', categories: ['accelerator', 'incubator'] },
];

interface PromoCodeRow { id: string; applicable_plans: string[]; deleted_at: string | null }
interface RedemptionRow { promo_code_id: string; org_id: string; orgs: { plan: string } | null }
interface OutreachRow { category: OutreachCategory; promo_code_id: string | null; deleted_at: string | null }

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [
    { data: promoCodes, error: codesErr },
    { data: redemptions, error: redemptionsErr },
    { data: outreachTargets, error: outreachErr },
    { data: netCostRows, error: netCostErr },
    { data: revenueByMonth, error: revenueErr },
  ] = await Promise.all([
    // Prompt 875 §1 — "created by plan" counts every code ever created,
    // deleted or not: a deleted code was still created, and this stat is
    // about marketing/outreach activity, not the live catalog (that's what
    // the Promo codes & offers page itself already shows). Explicit choice,
    // not an oversight — flagged in this prompt's own reply.
    admin.from('promo_codes').select('id, applicable_plans, deleted_at'),
    admin.from('promo_redemptions').select('promo_code_id, org_id, orgs(plan)'),
    admin.from('promo_outreach_targets').select('category, promo_code_id, deleted_at').is('deleted_at', null),
    admin.rpc('marketing_overview_promo_net_cost'),
    admin.rpc('marketing_overview_revenue_by_month'),
  ]);
  const firstError = codesErr ?? redemptionsErr ?? outreachErr ?? netCostErr ?? revenueErr;
  if (firstError) return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });

  // ---------- §1: promo codes created / redeemed, by plan ----------
  // "Redeemed by plan" is ambiguous for a multi-plan code (confirmed:
  // promo_codes.applicable_plans allows more than one at once, and
  // promo_redemptions has no plan column recording which one a given
  // redemption was actually on) — attributed here to the redeeming org's
  // CURRENT orgs.plan, a real fact readable today, not necessarily the plan
  // the code targeted. "Created by plan" counts a multi-plan code once under
  // EACH plan it applies to, which double-counts such codes across rows —
  // both call-outs surfaced as an "ⓘ" on the card, per the prompt's own
  // instruction to label the ambiguity rather than hide it.
  const codesCreatedByPlan = new Map<string, number>();
  for (const c of (promoCodes ?? []) as PromoCodeRow[]) {
    for (const plan of c.applicable_plans ?? []) codesCreatedByPlan.set(plan, (codesCreatedByPlan.get(plan) ?? 0) + 1);
  }
  const redeemedByPlan = new Map<string, number>();
  for (const r of (redemptions ?? []) as unknown as RedemptionRow[]) {
    const plan = r.orgs?.plan ?? 'idea';
    redeemedByPlan.set(plan, (redeemedByPlan.get(plan) ?? 0) + 1);
  }
  const promoByPlan = PLANS.map((p) => ({
    plan: p.tier,
    planLabel: planLabelForSlug(p.tier),
    created: codesCreatedByPlan.get(p.tier) ?? 0,
    redeemed: redeemedByPlan.get(p.tier) ?? 0,
  }));

  // ---------- §2: offered / redeemed by category ----------
  // "Offered" = a code was actually generated for the target (promo_code_id
  // set) — a row still sitting in to_contact with no code yet was never
  // actually offered anything, per the prompt's own definition. "Redeemed" =
  // count of THOSE targets whose code has >=1 row in promo_redemptions (not
  // a redemption count — a code redeemed by 3 orgs still counts as 1 target
  // redeemed here, matching "por categoria: offered/redeemed" as a target
  // tally, the same unit "Offered" uses).
  const redeemedCodeIds = new Set((redemptions ?? []).map((r) => r.promo_code_id as string));
  const offeredByCategory = new Map<OutreachCategory, number>();
  const redeemedByCategory = new Map<OutreachCategory, number>();
  for (const t of (outreachTargets ?? []) as OutreachRow[]) {
    if (!t.promo_code_id) continue;
    offeredByCategory.set(t.category, (offeredByCategory.get(t.category) ?? 0) + 1);
    if (redeemedCodeIds.has(t.promo_code_id)) redeemedByCategory.set(t.category, (redeemedByCategory.get(t.category) ?? 0) + 1);
  }
  const byCategory = CATEGORY_DISPLAY_GROUPS.map((g) => ({
    label: g.label,
    offered: g.categories.reduce((s, c) => s + (offeredByCategory.get(c) ?? 0), 0),
    redeemed: g.categories.reduce((s, c) => s + (redeemedByCategory.get(c) ?? 0), 0),
  }));

  // ---------- §3: net cost of the promo program ----------
  // netCostRows already carries one row per ORG (not per redemption — see
  // the RPC's own header comment on why overlapping redemptions collapse to
  // one window), with net_eur = amount_paid_eur − ai_cost_eur so a program
  // that is net-costing the platform (the expected early-stage case) shows
  // as negative, matching Nuno's own worked example's sign.
  interface NetCostRow {
    org_id: string; org_name: string; redeemed_at: string; benefit_ends_at: string | null;
    ai_cost_eur: number; amount_paid_eur: number; net_eur: number;
  }
  const netCostByOrg = (netCostRows ?? []) as NetCostRow[];
  const netTotalEur = netCostByOrg.reduce((s, r) => s + Number(r.net_eur), 0);

  // ---------- §4: converted after promo ended ----------
  // Prefer a billing_invoices row (status='paid', dated after benefit_ends_at)
  // over the live plan field — stronger evidence, per the prompt. Both
  // billing_invoices and orgs are queried here scoped to just the redeeming
  // orgs (a handful of rows), not a full-table scan.
  const redeemingOrgIds = netCostByOrg.map((r) => r.org_id);
  const [{ data: orgPlans }, { data: paidInvoices }] = redeemingOrgIds.length
    ? await Promise.all([
        admin.from('orgs').select('id, plan').in('id', redeemingOrgIds),
        admin.from('billing_invoices').select('org_id, paid_at').eq('kind', 'org').eq('status', 'paid').in('org_id', redeemingOrgIds),
      ])
    : [{ data: [] as { id: string; plan: string }[] }, { data: [] as { org_id: string; paid_at: string | null }[] }];
  const planByOrg = new Map((orgPlans ?? []).map((o) => [o.id, o.plan as PlanTier]));
  const paidInvoicesByOrg = new Map<string, string[]>();
  for (const inv of paidInvoices ?? []) {
    if (!inv.paid_at) continue;
    const list = paidInvoicesByOrg.get(inv.org_id as string) ?? [];
    list.push(inv.paid_at as string);
    paidInvoicesByOrg.set(inv.org_id as string, list);
  }
  const now = Date.now();
  let convertedAfterPromo = 0;
  let convertedByPlanFieldOnly = 0; // the weaker fallback signal, reported separately
  for (const r of netCostByOrg) {
    if (!r.benefit_ends_at || new Date(r.benefit_ends_at).getTime() >= now) continue; // promo still active
    const plan = planByOrg.get(r.org_id) ?? 'idea';
    if (!PAYING_PLAN_TIERS.has(plan)) continue;
    const invoicesAfter = (paidInvoicesByOrg.get(r.org_id) ?? []).some((paidAt) => new Date(paidAt) > new Date(r.benefit_ends_at!));
    if (invoicesAfter) convertedAfterPromo++;
    else convertedByPlanFieldOnly++; // on a paying plan, promo ended, but no paid invoice dated after it (yet)
  }

  return NextResponse.json({
    ok: true,
    promoByPlan,
    byCategory,
    netCost: { byOrg: netCostByOrg, totalEur: netTotalEur },
    convertedAfterPromo,
    convertedByPlanFieldOnly,
    revenueByMonth: revenueByMonth ?? [],
  });
}
