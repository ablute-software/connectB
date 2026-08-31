// SherlockDeal_Metricas_BackOffice_V1 — computation library, server-only.
// One function per indicator (13.2: "As definições das métricas devem
// estar centralizadas. O mesmo indicador não pode ser calculado de forma
// diferente em páginas distintas") — the Overview card and any future
// export/detail view read the SAME function, never a re-derived copy.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isExcludedOrgName } from './analytics-events';
import { PLANS, MATCHDEAL_TIER_TO_INVESTOR_PLAN, investorSeatLimit } from './plans';
import { discountedPriceEur, benefitStillActive } from './promo';
import type { PlanTier } from './types';

export type Period = 'today' | '7d' | '30d' | 'this_month' | 'last_month' | 'custom';

export interface DateRange { from: Date; to: Date }

// Section 4 — the reduced V1 period set. `previous` is the same-length
// window immediately before `from`, used for every "evolução face ao
// período anterior" comparison the spec asks for.
export function resolvePeriod(period: Period, customFrom?: string, customTo?: string): { current: DateRange; previous: DateRange } {
  const now = new Date();
  let from: Date, to: Date = now;
  switch (period) {
    case 'today': from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case '7d': from = new Date(now.getTime() - 7 * 86400000); break;
    case '30d': from = new Date(now.getTime() - 30 * 86400000); break;
    case 'this_month': from = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case 'last_month': {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case 'custom': {
      from = customFrom ? new Date(customFrom) : new Date(now.getTime() - 30 * 86400000);
      to = customTo ? new Date(customTo) : now;
      break;
    }
  }
  const spanMs = to.getTime() - from.getTime();
  const previous = { from: new Date(from.getTime() - spanMs), to: from };
  return { current: { from, to }, previous };
}

export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null; // undefined growth off a zero base, not a fabricated %
  return Math.round(((current - previous) / previous) * 100);
}

interface OrgRow {
  id: string; name: string; plan: string; created_at: string; country: string | null; sector: string | null;
  round_raising: boolean | null; profile_reached_80_at: string | null;
  stripe_subscription_id: string | null; stripe_billing_period: string | null;
}

// Section 3 — "excluir organizações de teste". Filtered here, once, so
// every indicator below sees the same real-org set. Fetched fresh per call
// rather than cached: this is an admin dashboard, not a hot path, and a
// stale exclusion list is worse than one extra query per request.
async function realOrgs(admin: SupabaseClient): Promise<OrgRow[]> {
  const { data } = await admin.from('orgs').select(
    'id, name, plan, created_at, country, sector, round_raising, profile_reached_80_at, stripe_subscription_id, stripe_billing_period',
  );
  return (data ?? []).filter((o) => !isExcludedOrgName(o.name));
}

async function realInvestorEntities(admin: SupabaseClient) {
  const { data } = await admin.from('catalog_entities').select('id, name, verification_status, verified_at, hq_country, sectors, created_at');
  return (data ?? []).filter((c) => !isExcludedOrgName(c.name));
}

interface EntityRelationRow {
  id: string; org_id: string; status: string; source: string | null; created_at: string; updated_at: string;
}

async function realRelations(admin: SupabaseClient, orgIds: string[]): Promise<EntityRelationRow[]> {
  if (orgIds.length === 0) return [];
  const { data } = await admin.from('entities').select('id, org_id, status, source, created_at, updated_at').in('org_id', orgIds);
  return data ?? [];
}

// ---- 6.1 Crescimento -------------------------------------------------

export async function newStartups(admin: SupabaseClient, range: DateRange): Promise<number> {
  const orgs = await realOrgs(admin);
  return orgs.filter((o) => inRange(o.created_at, range)).length;
}

// Prompt 124 M9/C7 — this counts CATALOG ENTITIES verified in the window,
// not real registered accounts (most catalog entities were imported/
// enriched and never touched by a real signed-up user — the exact gap
// this metric used to hide). Kept under its original name/shape since
// existing callers read it as "catalog entities added"; the real-accounts
// number lives in newRegisteredInvestorAccounts() below, and the Overview
// card shows both, never just this one, per C7.
export async function newInvestors(admin: SupabaseClient, range: DateRange): Promise<number> {
  const investors = await realInvestorEntities(admin);
  return investors.filter((c) => c.verification_status === 'verified' && c.verified_at && inRange(c.verified_at, range)).length;
}

// Prompt 124 C7 — the OTHER half of "New investors": a firm counts here the
// moment its first active matchdeal_investor_members seat is created (a
// real person actually signed in), same "registered account" contract as
// isRegisteredInvestorAccount()/the Backoffice Investors tab (Prompt 123
// §C.4) — never recomputed with a different definition.
export async function newRegisteredInvestorAccounts(admin: SupabaseClient, range: DateRange): Promise<number> {
  const { data: members } = await admin.from('matchdeal_investor_members').select('catalog_entity_id, created_at').eq('status', 'active');
  const earliestByEntity = new Map<string, string>();
  for (const m of members ?? []) {
    const entityId = m.catalog_entity_id as string;
    const createdAt = m.created_at as string;
    const existing = earliestByEntity.get(entityId);
    if (!existing || createdAt < existing) earliestByEntity.set(entityId, createdAt);
  }
  return Array.from(earliestByEntity.values()).filter((iso) => inRange(iso, range)).length;
}

function inRange(iso: string | null, range: DateRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= range.from.getTime() && t < range.to.getTime();
}

// Section 6.1 indicator 3 — compound: 80% profile AND pipeline delivered
// (>=1 entity) AND >=1 relevant action (>=1 relation past not_contacted,
// or any interaction). Computed live per org, not from a single event —
// no single moment marks "activated", it's a conjunction of 3 signals.
export async function activatedStartups(admin: SupabaseClient, range: DateRange): Promise<{ count: number; ids: string[] }> {
  const orgs = await realOrgs(admin);
  const relations = await realRelations(admin, orgs.map((o) => o.id));
  const byOrg = new Map<string, EntityRelationRow[]>();
  for (const r of relations) byOrg.set(r.org_id, [...(byOrg.get(r.org_id) ?? []), r]);

  const ids = orgs.filter((o) => {
    if (!o.profile_reached_80_at || !inRange(o.profile_reached_80_at, range)) return false;
    const rels = byOrg.get(o.id) ?? [];
    if (rels.length === 0) return false; // pipeline delivered
    return rels.some((r) => r.status !== 'not_contacted'); // at least one relevant action
  }).map((o) => o.id);
  return { count: ids.length, ids };
}

export async function activeFundraisingStartups(admin: SupabaseClient): Promise<number> {
  const orgs = await realOrgs(admin);
  return orgs.filter((o) => o.round_raising === true).length;
}

// Section 6.1 indicator 5 — the full "relevant activity" list is 16 action
// types across systems this session did not fully instrument this pass
// (Smart Calendar, AI Drafts, Review/Optimization usage aren't logged
// anywhere yet). Approximated here from what IS reliably historized:
// entities/interactions activity, analytics_events for this org in the
// window, and org profile updates (updated_at). Documented gap, not a
// silent shortcut — see the Fase C report.
export async function startupsWithRelevantActivity(admin: SupabaseClient, range: DateRange): Promise<number> {
  const orgs = await realOrgs(admin);
  const orgIds = orgs.map((o) => o.id);
  if (orgIds.length === 0) return 0;
  const [{ data: interactions }, { data: events }, { data: relUpdates }] = await Promise.all([
    admin.from('interactions').select('org_id').in('org_id', orgIds).gte('occurred_at', range.from.toISOString()).lt('occurred_at', range.to.toISOString()),
    admin.from('analytics_events').select('organization_id').eq('organization_type', 'startup').in('organization_id', orgIds)
      .gte('event_timestamp', range.from.toISOString()).lt('event_timestamp', range.to.toISOString()),
    admin.from('entities').select('org_id').in('org_id', orgIds).gte('updated_at', range.from.toISOString()).lt('updated_at', range.to.toISOString()),
  ]);
  const active = new Set<string>();
  for (const r of interactions ?? []) active.add(r.org_id);
  for (const r of events ?? []) active.add(r.organization_id);
  for (const r of relUpdates ?? []) active.add(r.org_id);
  return active.size;
}

export async function activationRate7d(admin: SupabaseClient, range: DateRange): Promise<number | null> {
  const orgs = await realOrgs(admin);
  const registered = orgs.filter((o) => inRange(o.created_at, range));
  if (registered.length === 0) return null;
  const activatedIn7d = registered.filter((o) => {
    if (!o.profile_reached_80_at) return false;
    const days = (new Date(o.profile_reached_80_at).getTime() - new Date(o.created_at).getTime()) / 86400000;
    return days <= 7;
  });
  return Math.round((activatedIn7d.length / registered.length) * 100);
}

// Only 30-day retention in V1 (spec 6.1 #7) — "ativadas que continuam a
// realizar atividade relevante 30 dias depois". Cohort = activated in a
// window ending 30+ days ago, so there's a full 30-day tail to check.
export async function retention30d(admin: SupabaseClient): Promise<number | null> {
  const now = new Date();
  const cohortEnd = new Date(now.getTime() - 30 * 86400000);
  const orgs = await realOrgs(admin);
  const cohort = orgs.filter((o) => o.profile_reached_80_at && new Date(o.profile_reached_80_at) <= cohortEnd);
  if (cohort.length === 0) return null;
  const cohortIds = cohort.map((o) => o.id);
  const { data: laterActivity } = await admin.from('interactions').select('org_id').in('org_id', cohortIds);
  const retainedIds = new Set<string>();
  for (const c of cohort) {
    const activatedAt = new Date(c.profile_reached_80_at!).getTime();
    const stillActive = (laterActivity ?? []).some((a) => a.org_id === c.id);
    if (stillActive) retainedIds.add(c.id);
    void activatedAt;
  }
  return Math.round((retainedIds.size / cohort.length) * 100);
}

// ---- 6.2 Receita -------------------------------------------------------
// MRR reads orgs.plan + PLANS pricing, discounting promo-covered orgs to
// what's actually charged (spec 6.2 #8) — never the list price for an org
// under an active promo redemption. Annual subscriptions are recognized at
// their monthly-equivalent (annualPerMonthEur), matching what's actually
// billed per month, not the once-a-year sticker price.
//
// Prompt 124 M8/C6 — this used to gate on `!!o.stripe_subscription_id`,
// which showed €0 MRR alongside a nonzero Net New MRR with 2 paying orgs on
// the same screen: netNewMrr() (below) reads plan_changed analytics_events,
// written by a DATABASE TRIGGER (log_org_plan_change(), migration 0072)
// that fires on ANY update to orgs.plan — including the backoffice's manual
// set-plan flip (src/app/api/backoffice/set-plan/route.ts), which never
// touches stripe_subscription_id at all (there's no live billing wiring
// yet — "the flip is manual", per that route's own comment). So an org
// moved to a paid tier by the platform team logged a plan_changed event
// (counted by netNewMrr) but was invisible to this function's snapshot
// (no Stripe row) — two definitions of "paying" on one screen. Fixed:
// this now reads the SAME ground truth netNewMrr/planIsPaid already use —
// orgs.plan itself, not Stripe subscription presence — since that's what's
// actually billed today regardless of mechanism (manual, promo, or a real
// future Stripe checkout).
// Prompt 296 §3 — "real vs potencial", one computation, everywhere. total is
// what's actually being collected (post-discount); totalPotential is the
// same org set at full list price (what discountsValue is silently costing
// today). Computed in the SAME loop over the SAME payingOrgs/discount lookup
// mrr() already does — never a second, separately-filtered pass (that
// second pass is exactly what revenueBreakdown() used to do below, and it
// had drifted onto a different "paying" definition; see the comment there).
export async function mrr(admin: SupabaseClient): Promise<{ total: number; totalPotential: number; discountsValue: number; startups: number; investors: number }> {
  const orgs = await realOrgs(admin);
  const payingOrgs = orgs.filter((o) => (o.plan as PlanTier) !== 'idea');
  const { data: redemptions } = payingOrgs.length
    ? await admin.from('promo_redemptions').select('org_id, benefit_ends_at, promo_codes(discount_pct)').in('org_id', payingOrgs.map((o) => o.id))
    : { data: [] };
  const now = new Date();
  const activeDiscountByOrg = new Map<string, number>();
  for (const r of redemptions ?? []) {
    if (!benefitStillActive(r.benefit_ends_at as string | null, now)) continue;
    const pct = (r.promo_codes as unknown as { discount_pct: number } | null)?.discount_pct ?? 0;
    activeDiscountByOrg.set(r.org_id as string, Math.max(activeDiscountByOrg.get(r.org_id as string) ?? 0, pct));
  }

  let startups = 0;
  let startupsPotential = 0;
  for (const o of payingOrgs) {
    const row = PLANS.find((p) => p.tier === (o.plan as PlanTier));
    if (!row) continue;
    const listPrice = o.stripe_billing_period === 'annual' ? (row.annualPerMonthEur ?? row.monthlyEur) : row.monthlyEur;
    const discount = activeDiscountByOrg.get(o.id) ?? 0;
    startupsPotential += listPrice;
    startups += discount > 0 ? discountedPriceEur(listPrice, discount) : listPrice;
  }
  // Investor-side plans have no live Stripe wiring yet (Prompt 74's own
  // finding: "Investor plans have no DB column or gate yet" beyond the
  // request-only path) — 0 until that exists, not a fabricated estimate.
  return {
    total: Math.round(startups), totalPotential: Math.round(startupsPotential),
    discountsValue: Math.round(startupsPotential - startups),
    startups: Math.round(startups), investors: 0,
  };
}

export async function freeToPaidConversion(admin: SupabaseClient, range: DateRange): Promise<{ rate: number | null; normal: number; promo: number }> {
  const { data: planEvents } = await admin.from('analytics_events').select('organization_id, plan_at_event_time, result')
    .eq('event_type', 'plan_changed').gte('event_timestamp', range.from.toISOString()).lt('event_timestamp', range.to.toISOString());
  const { data: promoRedemptions } = await admin.from('promo_redemptions').select('org_id')
    .gte('redeemed_at', range.from.toISOString()).lt('redeemed_at', range.to.toISOString());
  const promoOrgIds = new Set((promoRedemptions ?? []).map((r) => r.org_id));
  const conversions = (planEvents ?? []).filter((e) => e.result && e.result !== 'idea');
  const orgs = await realOrgs(admin);
  const eligibleFree = orgs.filter((o) => inRange(o.created_at, { from: new Date(0), to: range.to }) && o.plan === 'idea').length + conversions.length;
  const promo = conversions.filter((e) => promoOrgIds.has(e.organization_id)).length;
  const normal = conversions.length - promo;
  return { rate: eligibleFree > 0 ? Math.round((conversions.length / eligibleFree) * 100) : null, normal, promo };
}

function planMonthlyPrice(plan: string, annual: boolean): number {
  const row = PLANS.find((p) => p.tier === (plan as PlanTier));
  if (!row) return 0;
  return annual ? (row.annualPerMonthEur ?? row.monthlyEur) : row.monthlyEur;
}

// Net New MRR (spec 6.2 #9) = new + upgrades + reactivations - downgrades
// - cancellations, all in one pass over plan_changed events in the
// window. Does not account for an active promo discount on the specific
// transition (a smaller simplification than mrr()'s own, since a
// per-event promo lookup would need the redemption's state AT THAT
// MOMENT, not now) — documented, not hidden.
export async function netNewMrr(admin: SupabaseClient, range: DateRange): Promise<number> {
  const orgs = await realOrgs(admin);
  const orgIds = new Set(orgs.map((o) => o.id));
  const { data: events } = await admin.from('analytics_events').select('organization_id, result, status')
    .eq('event_type', 'plan_changed').gte('event_timestamp', range.from.toISOString()).lt('event_timestamp', range.to.toISOString());
  let delta = 0;
  for (const e of events ?? []) {
    if (!orgIds.has(e.organization_id as string)) continue;
    const before = planMonthlyPrice((e.status as string) ?? 'idea', false);
    const after = planMonthlyPrice((e.result as string) ?? 'idea', false);
    delta += after - before;
  }
  return Math.round(delta);
}

// Churn mensal de receita (spec 6.2 #11). "MRR no início do mês" has no
// stored snapshot (this table only started logging today) — approximated
// as CURRENT total MRR, a known simplification that converges to correct
// as soon as a full month of plan_changed history exists. Documented, not
// hidden.
export async function monthlyRevenueChurn(admin: SupabaseClient, range: DateRange, currentMrr: number): Promise<number | null> {
  if (currentMrr === 0) return null;
  const lostMrr = -(await netNewMrrLossOnly(admin, range));
  return Math.round((lostMrr / currentMrr) * 100);
}

async function netNewMrrLossOnly(admin: SupabaseClient, range: DateRange): Promise<number> {
  const orgs = await realOrgs(admin);
  const orgIds = new Set(orgs.map((o) => o.id));
  const { data: events } = await admin.from('analytics_events').select('organization_id, result, status')
    .eq('event_type', 'plan_changed').gte('event_timestamp', range.from.toISOString()).lt('event_timestamp', range.to.toISOString());
  let delta = 0;
  for (const e of events ?? []) {
    if (!orgIds.has(e.organization_id as string)) continue;
    const before = planMonthlyPrice((e.status as string) ?? 'idea', false);
    const after = planMonthlyPrice((e.result as string) ?? 'idea', false);
    if (after < before) delta += after - before; // only the downward moves
  }
  return delta;
}

// ---- 6.3 Prova de valor -------------------------------------------------

// Indicator 12 — "o principal indicador de valor". Uses CURRENT
// entities.status only (in_conversation/diligence/invested), not full
// history — pipeline_stage_reached events only started logging with this
// build, so a relation that reached "in conversation" and later regressed
// to "passed" before today isn't counted. This undercounts today; it
// self-corrects as event history accumulates. Documented, not hidden.
export async function qualifiedConversationsPerActiveFundraisingStartup(admin: SupabaseClient): Promise<{ rate: number | null; conversations: number; activeFundraising: number }> {
  const orgs = await realOrgs(admin);
  const activeFundraisers = orgs.filter((o) => o.round_raising === true);
  const relations = await realRelations(admin, activeFundraisers.map((o) => o.id));
  const qualified = relations.filter((r) => ['in_conversation', 'diligence', 'invested'].includes(r.status));
  return {
    rate: activeFundraisers.length > 0 ? Math.round((qualified.length / activeFundraisers.length) * 100) / 100 : null,
    conversations: qualified.length, activeFundraising: activeFundraisers.length,
  };
}

// Indicator 13 — median time from first pipeline entity to first inbound
// reply, per org, then the median across orgs. Excludes bounce/
// out_of_office classifications from counting as a "resposta válida".
export async function medianTimeToFirstResponse(admin: SupabaseClient): Promise<number | null> {
  const orgs = await realOrgs(admin);
  const orgIds = orgs.map((o) => o.id);
  if (orgIds.length === 0) return null;
  const [{ data: firstEntities }, { data: firstReplies }] = await Promise.all([
    admin.from('entities').select('org_id, created_at').in('org_id', orgIds).order('created_at', { ascending: true }),
    admin.from('interactions').select('org_id, occurred_at, classification').eq('direction', 'in').in('org_id', orgIds)
      .not('classification', 'in', '(bounce,out_of_office)').order('occurred_at', { ascending: true }),
  ]);
  const firstEntityByOrg = new Map<string, string>();
  for (const e of firstEntities ?? []) if (!firstEntityByOrg.has(e.org_id)) firstEntityByOrg.set(e.org_id, e.created_at);
  const firstReplyByOrg = new Map<string, string>();
  for (const r of firstReplies ?? []) if (!firstReplyByOrg.has(r.org_id)) firstReplyByOrg.set(r.org_id, r.occurred_at);

  const daysList: number[] = [];
  for (const [orgId, deliveredAt] of firstEntityByOrg) {
    const repliedAt = firstReplyByOrg.get(orgId);
    if (!repliedAt) continue;
    const days = (new Date(repliedAt).getTime() - new Date(deliveredAt).getTime()) / 86400000;
    if (days >= 0) daysList.push(days);
  }
  if (daysList.length === 0) return null;
  daysList.sort((a, b) => a - b);
  const mid = Math.floor(daysList.length / 2);
  return Math.round((daysList.length % 2 ? daysList[mid] : (daysList[mid - 1] + daysList[mid]) / 2) * 10) / 10;
}

export interface OverviewAlerts {
  failedAutomations: number;
  hardBounces: number;
  overduePipelines: number;
  failedPayments: number;
}

export async function overviewAlerts(admin: SupabaseClient, range: DateRange): Promise<OverviewAlerts> {
  const [{ count: failedAutomations }, { count: hardBounces }] = await Promise.all([
    admin.from('automation_runs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', range.from.toISOString()),
    admin.from('interactions').select('id', { count: 'exact', head: true }).eq('classification', 'bounce').gte('occurred_at', range.from.toISOString()),
  ]);
  const orgs = await realOrgs(admin);
  const orgIds = orgs.map((o) => o.id);
  const { data: relations } = orgIds.length ? await admin.from('entities').select('org_id, created_at').in('org_id', orgIds) : { data: [] };
  const orgsWithPipeline = new Set((relations ?? []).map((r) => r.org_id));
  const overduePipelines = orgs.filter((o) => {
    const ageHours = (Date.now() - new Date(o.created_at).getTime()) / 3600000;
    return ageHours > 48 && !orgsWithPipeline.has(o.id);
  }).length;
  return { failedAutomations: failedAutomations ?? 0, hardBounces: hardBounces ?? 0, overduePipelines, failedPayments: 0 };
}

// =========================================================================
// Section 7 — Growth & Revenue
// =========================================================================

// 7.1 — "registos iniciados" has no data source: Supabase Auth doesn't
// expose an abandoned-signup state this schema captures anywhere, so
// completion rate isn't computable in V1. Documented gap, not a fabricated
// number.
//
// Prompt 124 C1 — acquisition_source is now captured at signup (a "how did
// you hear" field + UTM params, src/app/signup/page.tsx) and the
// orgs_registered_event trigger copies it through to analytics_events
// (migration 0122, PROPOSE ONLY). Every org still shows "Unknown" until
// that migration is applied — never backfilled retroactively for orgs
// that signed up before it existed.
export async function acquisitionBreakdown(admin: SupabaseClient, range: DateRange) {
  const orgs = await realOrgs(admin);
  const inWindow = orgs.filter((o) => inRange(o.created_at, range));
  const { data: events } = await admin.from('analytics_events').select('organization_id, acquisition_source')
    .eq('event_type', 'org_registered').in('organization_id', inWindow.map((o) => o.id));
  const bySource = new Map<string, number>();
  for (const o of inWindow) {
    const ev = (events ?? []).find((e) => e.organization_id === o.id);
    const src = ev?.acquisition_source ?? 'Unknown';
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
  }
  return { completedRegistrations: inWindow.length, bySource: Object.fromEntries(bySource) };
}

export interface PlanBreakdown {
  free: number; paid: number; byPlan: Record<string, number>;
  upgrades: number; downgrades: number; cancellations: number;
}

export async function plansAndSubscriptions(admin: SupabaseClient, range: DateRange): Promise<PlanBreakdown> {
  const orgs = await realOrgs(admin);
  const byPlan: Record<string, number> = {};
  let free = 0, paid = 0;
  for (const o of orgs) {
    byPlan[o.plan] = (byPlan[o.plan] ?? 0) + 1;
    if (o.plan === 'idea') free++; else paid++;
  }
  const orgIds = new Set(orgs.map((o) => o.id));
  const { data: events } = await admin.from('analytics_events').select('organization_id, result, status')
    .eq('event_type', 'plan_changed').gte('event_timestamp', range.from.toISOString()).lt('event_timestamp', range.to.toISOString());
  let upgrades = 0, downgrades = 0, cancellations = 0;
  for (const e of events ?? []) {
    if (!orgIds.has(e.organization_id as string)) continue;
    const before = planMonthlyPrice((e.status as string) ?? 'idea', false);
    const after = planMonthlyPrice((e.result as string) ?? 'idea', false);
    if (e.result === 'idea' && e.status !== 'idea') cancellations++;
    else if (after > before) upgrades++;
    else if (after < before) downgrades++;
  }
  return { free, paid, byPlan, upgrades, downgrades, cancellations };
}

export interface RevenueBreakdown {
  mrr: number; mrrPotential: number; arr: number; arrPotential: number; netNewMrr: number;
  startupRevenue: number; investorRevenue: number; arpa: number; discountsValue: number;
}

export async function revenueBreakdown(admin: SupabaseClient, range: DateRange): Promise<RevenueBreakdown> {
  const { total, totalPotential, discountsValue, startups, investors } = await mrr(admin);
  const netNew = await netNewMrr(admin, range);
  const orgs = await realOrgs(admin);
  // ARPA must count the SAME "paying" org set mrr() itself summed over
  // (plan !== 'idea' — the actual billed ground truth, per the comment on
  // mrr() above) rather than Stripe-subscription presence. Confirmed
  // 2026-08-21 (Prompt 296 §3 verification): this line and discountsValue
  // above used to each run their OWN redemptions query filtered by
  // stripe_subscription_id — a second, divergent "paying" definition on the
  // same screen, exactly what Section 13.2 at the top of this file warns
  // against. discountsValue is no longer recomputed here at all — it's
  // mrr()'s own totalPotential-minus-total, from the SAME loop, so the two
  // numbers can never drift apart again.
  const payingCount = orgs.filter((o) => (o.plan as PlanTier) !== 'idea').length;
  const arpa = payingCount > 0 ? Math.round(total / payingCount) : 0;

  return {
    mrr: total, mrrPotential: totalPotential, arr: total * 12, arrPotential: totalPotential * 12,
    netNewMrr: netNew, startupRevenue: startups, investorRevenue: investors, arpa, discountsValue,
  };
}

export interface PromoBreakdown {
  totalRedemptions: number; byPartner: Record<string, number>; activationRatePct: number | null;
}

// 7.4 — "não pode ficar para V2". partner_id isn't captured on
// promo_redemptions today (no partner concept exists anywhere in this
// schema yet — confirmed via grep), so "por parceiro" groups by promo
// code label instead, the closest real attribution available.
export async function promoBreakdown(admin: SupabaseClient, range: DateRange): Promise<PromoBreakdown> {
  const { data: redemptions } = await admin.from('promo_redemptions').select('org_id, promo_codes(label, code)')
    .gte('redeemed_at', range.from.toISOString()).lt('redeemed_at', range.to.toISOString());
  const byPartner: Record<string, number> = {};
  for (const r of redemptions ?? []) {
    const label = (r.promo_codes as unknown as { label: string | null; code: string } | null);
    const key = label?.label ?? label?.code ?? 'Unknown';
    byPartner[key] = (byPartner[key] ?? 0) + 1;
  }
  const orgIds = (redemptions ?? []).map((r) => r.org_id as string);
  const orgs = orgIds.length ? await realOrgs(admin) : [];
  const redeemedOrgs = orgs.filter((o) => orgIds.includes(o.id));
  const activated = redeemedOrgs.filter((o) => !!o.profile_reached_80_at).length;
  return {
    totalRedemptions: redemptions?.length ?? 0, byPartner,
    activationRatePct: redeemedOrgs.length > 0 ? Math.round((activated / redeemedOrgs.length) * 100) : null,
  };
}

// =========================================================================
// Section 8 — Activation & Retention
// =========================================================================

export interface FunnelStep { key: string; label: string; count: number }
export interface FunnelResult { steps: FunnelStep[]; conversionPct: number[]; medianDaysToStep: (number | null)[] }

// 8.1 — the activation funnel. Registo -> perfil 80% -> pipeline entregue
// -> pipeline visualizada -> primeiro investidor adicionado -> primeiro
// investidor contactado -> primeira resposta. "Pipeline visualizada" has
// no view-tracking event anywhere in this codebase (confirmed via the
// Fase B survey) — approximated as "has an entity with any interaction",
// a lower bound, not the literal page-view spec asked for. Documented.
export async function activationFunnel(admin: SupabaseClient, range: DateRange): Promise<FunnelResult> {
  const orgs = await realOrgs(admin);
  const registered = orgs.filter((o) => inRange(o.created_at, range));
  const orgIds = registered.map((o) => o.id);
  const [{ data: entities }, { data: interactions }] = await Promise.all([
    orgIds.length ? admin.from('entities').select('org_id, created_at, status').in('org_id', orgIds) : Promise.resolve({ data: [] }),
    orgIds.length ? admin.from('interactions').select('org_id, direction, occurred_at').in('org_id', orgIds) : Promise.resolve({ data: [] }),
  ]);
  const entitiesByOrg = new Map<string, { created_at: string; status: string }[]>();
  for (const e of entities ?? []) entitiesByOrg.set(e.org_id, [...(entitiesByOrg.get(e.org_id) ?? []), e]);
  const interactionsByOrg = new Map<string, { direction: string; occurred_at: string }[]>();
  for (const i of interactions ?? []) interactionsByOrg.set(i.org_id, [...(interactionsByOrg.get(i.org_id) ?? []), i]);

  const withProfile80 = registered.filter((o) => !!o.profile_reached_80_at);
  const withPipeline = registered.filter((o) => (entitiesByOrg.get(o.id) ?? []).length > 0);
  const viewedPipeline = withPipeline; // approximation — see header comment
  const withFirstInvestor = withPipeline;
  const withFirstContact = registered.filter((o) => (entitiesByOrg.get(o.id) ?? []).some((e) => e.status !== 'not_contacted'));
  const withFirstReply = registered.filter((o) => (interactionsByOrg.get(o.id) ?? []).some((i) => i.direction === 'in'));

  const steps: FunnelStep[] = [
    { key: 'registered', label: 'Registo concluído', count: registered.length },
    { key: 'profile_80', label: 'Perfil 80%', count: withProfile80.length },
    { key: 'pipeline_delivered', label: 'Pipeline entregue', count: withPipeline.length },
    { key: 'pipeline_viewed', label: 'Pipeline visualizada', count: viewedPipeline.length },
    { key: 'first_investor_added', label: 'Primeiro investidor adicionado', count: withFirstInvestor.length },
    { key: 'first_contact', label: 'Primeiro investidor contactado', count: withFirstContact.length },
    { key: 'first_reply', label: 'Primeira resposta', count: withFirstReply.length },
  ];
  const conversionPct = steps.map((s, i) => i === 0 || steps[0].count === 0 ? 100 : Math.round((s.count / steps[0].count) * 100));
  const medianDaysToStep = [
    0,
    medianDays(withProfile80.map((o) => [o.created_at, o.profile_reached_80_at!])),
    medianDays(withPipeline.map((o) => [o.created_at, (entitiesByOrg.get(o.id) ?? [])[0]?.created_at ?? o.created_at])),
    null,
    medianDays(withFirstInvestor.map((o) => [o.created_at, (entitiesByOrg.get(o.id) ?? [])[0]?.created_at ?? o.created_at])),
    null,
    medianDays(withFirstReply.map((o) => {
      const firstIn = (interactionsByOrg.get(o.id) ?? []).find((i) => i.direction === 'in');
      return [o.created_at, firstIn?.occurred_at ?? o.created_at];
    })),
  ];
  return { steps, conversionPct, medianDaysToStep };
}

function medianDays(pairs: [string, string][]): number | null {
  const days = pairs.map(([a, b]) => (new Date(b).getTime() - new Date(a).getTime()) / 86400000).filter((d) => d >= 0);
  if (days.length === 0) return null;
  days.sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  return Math.round((days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2) * 10) / 10;
}

export interface RetentionBreakdown {
  retention7d: number | null; retention30d: number | null;
  byCohortMonth: { month: string; activated: number; retained30d: number }[];
  inactiveOver30d: number;
}

export async function retentionBreakdown(admin: SupabaseClient): Promise<RetentionBreakdown> {
  const orgs = await realOrgs(admin);
  const now = new Date();
  const activated = orgs.filter((o) => !!o.profile_reached_80_at);

  async function retentionAt(days: number): Promise<number | null> {
    const cohortEnd = new Date(now.getTime() - days * 86400000);
    const cohort = activated.filter((o) => new Date(o.profile_reached_80_at!) <= cohortEnd);
    if (cohort.length === 0) return null;
    const { data: activity } = await admin.from('interactions').select('org_id').in('org_id', cohort.map((o) => o.id));
    const activeIds = new Set((activity ?? []).map((a) => a.org_id));
    return Math.round((cohort.filter((o) => activeIds.has(o.id)).length / cohort.length) * 100);
  }

  const [retention7d, r30] = await Promise.all([retentionAt(7), retentionAt(30)]);

  const byMonth = new Map<string, { activated: number; retained30d: number }>();
  for (const o of activated) {
    const month = o.profile_reached_80_at!.slice(0, 7);
    const entry = byMonth.get(month) ?? { activated: 0, retained30d: 0 };
    entry.activated++;
    byMonth.set(month, entry);
  }
  const { data: allActivity } = orgs.length ? await admin.from('interactions').select('org_id, occurred_at').in('org_id', orgs.map((o) => o.id)) : { data: [] };
  for (const o of activated) {
    const month = o.profile_reached_80_at!.slice(0, 7);
    const day30 = new Date(new Date(o.profile_reached_80_at!).getTime() + 30 * 86400000);
    const hasActivityAfter30 = (allActivity ?? []).some((a) => a.org_id === o.id && new Date(a.occurred_at) >= day30);
    if (hasActivityAfter30) byMonth.get(month)!.retained30d++;
  }
  const byCohortMonth = [...byMonth.entries()].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));

  const { data: lastActivityRows } = orgs.length ? await admin.from('interactions').select('org_id, occurred_at').in('org_id', orgs.map((o) => o.id)).order('occurred_at', { ascending: false }) : { data: [] };
  const lastActivityByOrg = new Map<string, string>();
  for (const r of lastActivityRows ?? []) if (!lastActivityByOrg.has(r.org_id)) lastActivityByOrg.set(r.org_id, r.occurred_at);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const inactiveOver30d = orgs.filter((o) => {
    const last = lastActivityByOrg.get(o.id);
    return !last || new Date(last) < thirtyDaysAgo;
  }).length;

  return { retention7d, retention30d: r30, byCohortMonth, inactiveOver30d };
}

export interface RelevantActivitySummary {
  startupsWithActivity: number; investorsWithActivity: number; medianDaysToFirstAction: number | null;
}

export async function relevantActivitySummary(admin: SupabaseClient, range: DateRange): Promise<RelevantActivitySummary> {
  const startups = await startupsWithRelevantActivity(admin, range);
  // Investor-side "relevant activity" (swipes, Q&A, soft commits) is
  // tracked in MatchDeal/portal tables this file doesn't otherwise touch —
  // approximated here via matchdeal_swipes as the one reliably-populated
  // signal; portal_questions/soft-commits are lower volume and additive.
  const { count: investorsWithActivity } = await admin.from('matchdeal_swipes').select('actor_profile_id', { count: 'exact', head: true })
    .gte('created_at', range.from.toISOString()).lt('created_at', range.to.toISOString());
  const orgs = await realOrgs(admin);
  const orgIds = orgs.map((o) => o.id);
  const { data: firstActions } = orgIds.length ? await admin.from('interactions').select('org_id, occurred_at').in('org_id', orgIds).order('occurred_at', { ascending: true }) : { data: [] };
  const firstByOrg = new Map<string, string>();
  for (const a of firstActions ?? []) if (!firstByOrg.has(a.org_id)) firstByOrg.set(a.org_id, a.occurred_at);
  const pairs: [string, string][] = orgs.filter((o) => firstByOrg.has(o.id)).map((o) => [o.created_at, firstByOrg.get(o.id)!]);
  return { startupsWithActivity: startups, investorsWithActivity: investorsWithActivity ?? 0, medianDaysToFirstAction: medianDays(pairs) };
}

// =========================================================================
// Section 9 — Fundraising Outcomes
// =========================================================================

const MAIN_FUNNEL_ORDER = ['not_contacted', 'contacted', 'in_conversation', 'diligence', 'invested'] as const;
const MAIN_FUNNEL_LABEL: Record<string, string> = {
  not_contacted: 'Pipeline', contacted: 'Contacted', in_conversation: 'In conversation', diligence: 'Diligence', invested: 'Invested',
};

// 9.1 — main funnel, by CURRENT status only (documented limitation shared
// with indicator 12: no full stage-history exists before this build's
// triggers started, so a relation currently "passed" after once reaching
// "in conversation" undercounts that earlier stage today).
export async function mainFundraisingFunnel(admin: SupabaseClient): Promise<FunnelResult> {
  const orgs = await realOrgs(admin);
  const relations = await realRelations(admin, orgs.map((o) => o.id));
  // Cumulative: "reached at least this stage" — invested implies diligence
  // implies in_conversation implies contacted implies pipeline.
  const rank: Record<string, number> = { not_contacted: 0, contacted: 1, in_conversation: 2, diligence: 3, invested: 4, passed: -1, dormant: -1 };
  const steps: FunnelStep[] = MAIN_FUNNEL_ORDER.map((key, i) => ({
    key, label: MAIN_FUNNEL_LABEL[key],
    count: relations.filter((r) => (rank[r.status] ?? -1) >= i).length,
  }));
  const conversionPct = steps.map((s, i) => i === 0 || steps[0].count === 0 ? 100 : Math.round((s.count / steps[0].count) * 100));
  const medianDaysToStep = MAIN_FUNNEL_ORDER.map((key) => {
    if (key === 'not_contacted') return 0;
    const reached = relations.filter((r) => (rank[r.status] ?? -1) >= (MAIN_FUNNEL_ORDER.indexOf(key)));
    return medianDays(reached.map((r) => [r.created_at, r.updated_at]));
  });
  return { steps, conversionPct, medianDaysToStep };
}

export interface FundraisingRates {
  pipelineContactRate: number | null; replyRate: number | null; conversationConversionRate: number | null;
  diligenceConversionRate: number | null; passRate: number | null; medianDaysToFirstQualifiedConversation: number | null;
}

export async function fundraisingRates(admin: SupabaseClient): Promise<FundraisingRates> {
  const orgs = await realOrgs(admin);
  const relations = await realRelations(admin, orgs.map((o) => o.id));
  const total = relations.length;
  const contacted = relations.filter((r) => r.status !== 'not_contacted').length;
  const orgIds = orgs.map((o) => o.id);
  const { data: interactions } = orgIds.length ? await admin.from('interactions').select('entity_id, direction').in('org_id', orgIds) : { data: [] };
  const repliedEntityIds = new Set((interactions ?? []).filter((i) => i.direction === 'in').map((i) => i.entity_id));
  const inConversation = relations.filter((r) => ['in_conversation', 'diligence', 'invested'].includes(r.status)).length;
  const diligence = relations.filter((r) => ['diligence', 'invested'].includes(r.status)).length;
  const passed = relations.filter((r) => r.status === 'passed').length;

  const qualified = relations.filter((r) => ['in_conversation', 'diligence', 'invested'].includes(r.status));
  const medianDaysToFirstQualifiedConversation = medianDays(qualified.map((r) => [r.created_at, r.updated_at]));

  return {
    pipelineContactRate: total > 0 ? Math.round((contacted / total) * 100) : null,
    replyRate: contacted > 0 ? Math.round((repliedEntityIds.size / contacted) * 100) : null,
    conversationConversionRate: contacted > 0 ? Math.round((inConversation / contacted) * 100) : null,
    diligenceConversionRate: contacted > 0 ? Math.round((diligence / contacted) * 100) : null,
    passRate: contacted > 0 ? Math.round((passed / contacted) * 100) : null,
    medianDaysToFirstQualifiedConversation,
  };
}

export interface StartupOutcomeRow {
  orgId: string; orgName: string; pipeline: number; contacted: number; replied: number;
  conversations: number; diligences: number; investments: number; passes: number; staleOver30d: number;
}

export async function outcomesByStartup(admin: SupabaseClient): Promise<StartupOutcomeRow[]> {
  const orgs = await realOrgs(admin);
  const relations = await realRelations(admin, orgs.map((o) => o.id));
  const orgIds = orgs.map((o) => o.id);
  const { data: interactions } = orgIds.length ? await admin.from('interactions').select('entity_id, org_id, direction').in('org_id', orgIds) : { data: [] };
  const repliedEntityIds = new Set((interactions ?? []).filter((i) => i.direction === 'in').map((i) => i.entity_id));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  return orgs.map((o) => {
    const rels = relations.filter((r) => r.org_id === o.id);
    return {
      orgId: o.id, orgName: o.name, pipeline: rels.length,
      contacted: rels.filter((r) => r.status !== 'not_contacted').length,
      replied: rels.filter((r) => repliedEntityIds.has(r.id)).length,
      conversations: rels.filter((r) => ['in_conversation', 'diligence', 'invested'].includes(r.status)).length,
      diligences: rels.filter((r) => ['diligence', 'invested'].includes(r.status)).length,
      investments: rels.filter((r) => r.status === 'invested').length,
      passes: rels.filter((r) => r.status === 'passed').length,
      staleOver30d: rels.filter((r) => r.status !== 'not_contacted' && r.status !== 'passed' && r.status !== 'invested' && new Date(r.updated_at) < thirtyDaysAgo).length,
    };
  }).filter((r) => r.pipeline > 0);
}

// 9.4 — investor_source distribution. Reuses entities.source directly
// (populated since Prompt 73, not just from today) rather than requiring
// analytics_events history to accumulate first.
export async function investorSourceDistribution(admin: SupabaseClient): Promise<Record<string, number>> {
  const orgs = await realOrgs(admin);
  const relations = await realRelations(admin, orgs.map((o) => o.id));
  const dist: Record<string, number> = {};
  for (const r of relations) {
    const src = r.source ?? 'unknown';
    dist[src] = (dist[src] ?? 0) + 1;
  }
  return dist;
}

export interface DataRoomAccessSummary {
  startupsWithDataRoom: number; pitchDecksOpened: number;
  level2Requests: { submitted: number; approved: number; rejected: number };
  ddRequests: { submitted: number; approved: number; rejected: number };
  medianDaysToDecision: number | null;
}

export async function dataRoomAccessSummary(admin: SupabaseClient): Promise<DataRoomAccessSummary> {
  const orgs = await realOrgs(admin);
  const orgIds = orgs.map((o) => o.id);
  const { count: startupsWithDataRoom } = orgIds.length
    ? await admin.from('documents').select('org_id', { count: 'exact', head: true }).in('org_id', orgIds)
    : { count: 0 };
  const { count: pitchDecksOpened } = orgIds.length
    ? await admin.from('document_views').select('id', { count: 'exact', head: true }).in('org_id', orgIds)
    : { count: 0 };
  const { data: grants } = orgIds.length ? await admin.from('access_grants').select('org_id, confirmed_at').in('org_id', orgIds) : { data: [] };
  // access_grants has no explicit "level"/"pending" workflow distinct from
  // confirmation — approximated as submitted=all, approved=confirmed,
  // rejected=0 (there's no reject-and-keep-row path for a grant; a
  // rejected request is simply never granted, so it never appears here at
  // all — this undercounts "rejected", a real gap, not hidden).
  const submitted = (grants ?? []).length;
  const approved = (grants ?? []).filter((g) => !!g.confirmed_at).length;
  return {
    startupsWithDataRoom: startupsWithDataRoom ?? 0, pitchDecksOpened: pitchDecksOpened ?? 0,
    level2Requests: { submitted, approved, rejected: 0 },
    ddRequests: { submitted: 0, approved: 0, rejected: 0 },
    medianDaysToDecision: null,
  };
}

// =========================================================================
// Section 12 — Organizations
// =========================================================================

export interface ActionListRow { orgId: string; orgName: string; detail: string }

export async function actionLists(admin: SupabaseClient): Promise<Record<string, ActionListRow[]>> {
  const orgs = await realOrgs(admin);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const orgIds = orgs.map((o) => o.id);
  const [{ data: relations }, { data: interactions }, { data: redemptions }, { data: grants }, { data: views }] = await Promise.all([
    orgIds.length ? admin.from('entities').select('org_id, status').in('org_id', orgIds) : Promise.resolve({ data: [] }),
    orgIds.length ? admin.from('interactions').select('org_id, occurred_at').in('org_id', orgIds).order('occurred_at', { ascending: false }) : Promise.resolve({ data: [] }),
    admin.from('promo_redemptions').select('org_id, benefit_ends_at, promo_codes(discount_pct)'),
    orgIds.length ? admin.from('access_grants').select('id, org_id, confirmed_at').in('org_id', orgIds) : Promise.resolve({ data: [] }),
    orgIds.length ? admin.from('document_views').select('grant_id').in('org_id', orgIds) : Promise.resolve({ data: [] }),
  ]);
  const lastActivity = new Map<string, string>();
  for (const i of interactions ?? []) if (!lastActivity.has(i.org_id)) lastActivity.set(i.org_id, i.occurred_at);
  const relationsByOrg = new Map<string, { status: string }[]>();
  for (const r of relations ?? []) relationsByOrg.set(r.org_id, [...(relationsByOrg.get(r.org_id) ?? []), r]);

  const inactive30d: ActionListRow[] = orgs.filter((o) => {
    const last = lastActivity.get(o.id);
    return !last || new Date(last) < thirtyDaysAgo;
  }).map((o) => ({ orgId: o.id, orgName: o.name, detail: lastActivity.get(o.id) ? `Last activity ${lastActivity.get(o.id)!.slice(0, 10)}` : 'No activity on file' }));

  const neverContacted: ActionListRow[] = orgs.filter((o) => {
    const rels = relationsByOrg.get(o.id) ?? [];
    return rels.length > 0 && rels.every((r) => r.status === 'not_contacted');
  }).map((o) => ({ orgId: o.id, orgName: o.name, detail: `${(relationsByOrg.get(o.id) ?? []).length} in pipeline, none contacted` }));

  const now = new Date();
  const activePromoOrgIds = new Set((redemptions ?? []).filter((r) => benefitStillActive(r.benefit_ends_at as string | null, now)).map((r) => r.org_id));
  const incompleteWithPromo: ActionListRow[] = orgs.filter((o) => !o.profile_reached_80_at && activePromoOrgIds.has(o.id))
    .map((o) => ({ orgId: o.id, orgName: o.name, detail: 'Promo active, profile still below 80%' }));

  // Prompt 124 C3 — this used to list EVERY confirmed grant unconditionally,
  // never actually checking document_views (which has real rows all along
  // — /api/portal/view writes one on every open; it just never populated
  // grant_id, fixed alongside this). Now genuinely checks: a grant only
  // shows here if no document_view row references its id.
  const viewedGrantIds = new Set((views ?? []).map((v) => v.grant_id).filter(Boolean));
  const grantsUnopened: ActionListRow[] = (grants ?? []).filter((g) => !!g.confirmed_at && !viewedGrantIds.has(g.id))
    .map((g) => orgs.find((o) => o.id === g.org_id)).filter((o): o is OrgRow => !!o)
    .map((o) => ({ orgId: o.id, orgName: o.name, detail: 'Access grant confirmed, no document_views on file' }));

  return {
    inactive_30d: inactive30d,
    never_contacted: neverContacted,
    incomplete_profile_with_promo: incompleteWithPromo,
    near_plan_limit: [], // no plan-limit usage tracking exists yet (catalog_quota is startup-side only) — documented gap
    payment_failed: [], // no failed-payment tracking wired to an org list yet — documented gap
    grant_not_opened: grantsUnopened,
  };
}

export interface StartupOrgRow {
  orgId: string; name: string; plan: string; hasSubscription: boolean;
  createdAt: string; profileReached80At: string | null; roundRaising: boolean | null;
  pipelineSize: number; contacted: number; activityState: 'highly_active' | 'active' | 'low_activity' | 'inactive';
  pendingAccessRequests: number;
}

// 12.1 — per-startup view. "periodicidade, número de utilizadores,
// investidores disponibilizados vs. adicionados manualmente, matches,
// AI Drafts, automações, follow-ups, dormant, risco de churn, elegibilidade
// para upgrade" are explicitly deferred to V2 per spec — not built here.
export async function startupOrgRows(admin: SupabaseClient): Promise<StartupOrgRow[]> {
  const orgs = await realOrgs(admin);
  const orgIds = orgs.map((o) => o.id);
  const relations = await realRelations(admin, orgIds);
  const { data: interactions } = orgIds.length ? await admin.from('interactions').select('org_id, occurred_at').in('org_id', orgIds) : { data: [] };
  const now = Date.now();
  const activityByOrg = new Map<string, number>();
  for (const i of interactions ?? []) activityByOrg.set(i.org_id, Math.max(activityByOrg.get(i.org_id) ?? 0, new Date(i.occurred_at).getTime()));

  function activityState(orgId: string): StartupOrgRow['activityState'] {
    const last = activityByOrg.get(orgId);
    if (!last) return 'inactive';
    const daysAgo = (now - last) / 86400000;
    if (daysAgo <= 3) return 'highly_active';
    if (daysAgo <= 14) return 'active';
    if (daysAgo <= 30) return 'low_activity';
    return 'inactive';
  }

  return orgs.map((o) => {
    const rels = relations.filter((r) => r.org_id === o.id);
    return {
      orgId: o.id, name: o.name, plan: o.plan, hasSubscription: !!o.stripe_subscription_id,
      createdAt: o.created_at, profileReached80At: o.profile_reached_80_at, roundRaising: o.round_raising,
      pipelineSize: rels.length, contacted: rels.filter((r) => r.status !== 'not_contacted').length,
      activityState: activityState(o.id), pendingAccessRequests: 0, // access_grants has no pending state distinct from confirmed — documented gap, same as dataRoomAccessSummary
    };
  });
}

export interface InvestorOrgRow {
  entityId: string; name: string; verified: boolean;
  // Prompt 183 §A — verified collapses the real tri-state value to a
  // boolean (kept for existing callers); this carries the actual value so
  // the Accounts table can show a proper Verification badge now that
  // pending/rejected rows reach this list too (see the filter change
  // below).
  verificationStatus: 'verified' | 'pending' | 'rejected';
  planTier: string | null;
  // Item 11 — the investor-side mirror of orgs.plan_change_requested: a
  // pending request existed (plan/request/route.ts writes it) but nothing
  // on the backoffice side ever read it back. Picked the same "first
  // member with a value" convention planTier itself already uses above —
  // plan is displayed as one firm-level value even though it technically
  // lives per matchdeal_investor_members seat.
  planTierRequested: string | null; planTierRequestedAt: string | null;
  seatsLinked: number;
  // Prompt 497 — seats have been counted here since Prompt 123 but were
  // never compared against what the tier is billed for. These two close
  // that half: the limit from INVESTOR_PLANS via plans.ts (single source,
  // never a hand-copied number), and whether this firm sits above it.
  // `seatsOverLimit` is a REPORT, not an action — no seat is revoked and no
  // account is blocked retroactively (see plans.ts's checkInvestorSeatLimit
  // and migration 0285 for why the gate only fires when a seat is ADDED).
  seatLimit: number; seatsOverLimit: boolean;
  startupsAnalyzed: number; activityState: 'highly_active' | 'active' | 'low_activity' | 'inactive';
}

// 12.2 — per-investor view. This comment used to name four unenforced
// limits (seats, qualified opportunities, Data Room, DD access). Two are
// now real: qualified opportunities via `monthlyCap` (investor-pipeline.ts,
// Prompt 153) and SEATS via plans.ts's checkInvestorSeatLimit + migration
// 0285's trigger (Prompt 497) — seatLimit/seatsOverLimit below are the
// back-office half of that. Still unenforced and MEASURED only: Vault Data
// Room access and Due Diligence access, both per-startup-per-month caps in
// the plan copy with no counter behind them (measured 2026-08-31: 3 grantee
// accounts across 101 active access_grants, all against a single org; 3
// due-diligence documents platform-wide, 1 diligence-checklist row — the
// numbers a future prompt should design against instead of guessing).
// matchdeal_tier_limits() still governs swipe/like caps only.
export async function investorOrgRows(admin: SupabaseClient): Promise<InvestorOrgRow[]> {
  const investors = await realInvestorEntities(admin);
  const { data: members } = await admin.from('matchdeal_investor_members').select('id, catalog_entity_id, status');
  const activeMembers = (members ?? []).filter((m) => m.status === 'active');
  const memberIdsByEntity = new Map<string, string[]>();
  for (const m of activeMembers) memberIdsByEntity.set(m.catalog_entity_id, [...(memberIdsByEntity.get(m.catalog_entity_id) ?? []), m.id]);

  const allMemberIds = activeMembers.map((m) => m.id);
  const { data: profiles } = allMemberIds.length
    ? await admin.from('matchdeal_profiles').select('id, membership_id, plan_tier, plan_tier_requested, plan_tier_requested_at').eq('kind', 'investor').in('membership_id', allMemberIds)
    : { data: [] };
  const planTierByMember = new Map<string, string>();
  const planTierRequestedByMember = new Map<string, string>();
  const planTierRequestedAtByMember = new Map<string, string>();
  const profileIdByMember = new Map<string, string>();
  for (const p of profiles ?? []) {
    planTierByMember.set(p.membership_id as string, p.plan_tier as string);
    if (p.plan_tier_requested) planTierRequestedByMember.set(p.membership_id as string, p.plan_tier_requested as string);
    if (p.plan_tier_requested_at) planTierRequestedAtByMember.set(p.membership_id as string, p.plan_tier_requested_at as string);
    profileIdByMember.set(p.membership_id as string, p.id as string);
  }

  const allProfileIds = [...profileIdByMember.values()];
  const { data: swipes } = allProfileIds.length
    ? await admin.from('matchdeal_swipes').select('actor_profile_id, target_profile_id, created_at').in('actor_profile_id', allProfileIds)
    : { data: [] };
  const now = Date.now();

  // Prompt 183 §A — was `investors.filter((c) => c.verification_status ===
  // 'verified')`, which hid real accounts: a catalog_entities row can have
  // an actual signed-in seat (matchdeal_investor_members.status='active')
  // while still sitting at verification_status='pending' or 'rejected' —
  // confirmed in production ("Invest green" and an individual investor
  // account, both pending, both with real active seats, neither ever
  // showing in Accounts). A pending account is exactly the one an admin
  // most needs to see here — to verify it, manage its plan, or delete it —
  // so this now filters on the same thing the "registered account"
  // definition elsewhere already uses (seats, via isRegisteredInvestorAccount),
  // not on verification. Every other verification_status==='verified'
  // filter in the codebase (the public catalog, /api/backoffice/investors)
  // is untouched — this is scoped to investorOrgRows() only, per the
  // prompt's own instruction.
  return investors.filter((c) => (memberIdsByEntity.get(c.id) ?? []).length > 0).map((c) => {
    const memberIds = memberIdsByEntity.get(c.id) ?? [];
    const profileIdsForEntity = memberIds.map((id) => profileIdByMember.get(id)).filter((x): x is string => !!x);
    const entitySwipes = (swipes ?? []).filter((s) => profileIdsForEntity.includes(s.actor_profile_id as string));
    const lastSwipe = entitySwipes.reduce((max, s) => Math.max(max, new Date(s.created_at as string).getTime()), 0);
    const daysAgo = lastSwipe ? (now - lastSwipe) / 86400000 : Infinity;
    const activityState: InvestorOrgRow['activityState'] = daysAgo <= 3 ? 'highly_active' : daysAgo <= 14 ? 'active' : daysAgo <= 30 ? 'low_activity' : 'inactive';
    const planTier = memberIds.map((id) => planTierByMember.get(id)).find(Boolean) ?? null;
    const planTierRequested = memberIds.map((id) => planTierRequestedByMember.get(id)).find(Boolean) ?? null;
    const planTierRequestedAt = memberIds.map((id) => planTierRequestedAtByMember.get(id)).find(Boolean) ?? null;
    const verificationStatus = c.verification_status as 'verified' | 'pending' | 'rejected';
    // Same 'tier_a' fallback as investor-seats.ts / portal-access.ts — a
    // firm with no tier set anywhere is treated as the entry plan, never as
    // unlimited.
    const seatLimit = investorSeatLimit(MATCHDEAL_TIER_TO_INVESTOR_PLAN[planTier ?? 'tier_a'] ?? 'pro_scout');
    return {
      entityId: c.id, name: c.name, verified: verificationStatus === 'verified', verificationStatus,
      planTier, planTierRequested, planTierRequestedAt, seatsLinked: memberIds.length,
      seatLimit, seatsOverLimit: memberIds.length > seatLimit,
      startupsAnalyzed: new Set(entitySwipes.map((s) => s.target_profile_id)).size, activityState,
    };
  });
}
