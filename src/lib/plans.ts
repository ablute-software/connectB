// Plans & entitlements — pure, no I/O, unit-tested. Single source of truth for
// the three plan tiers (names/prices verbatim from the founder), how a stored
// org.plan value maps to a tier, and what each tier is entitled to. Both the
// client (Plans page, /log composer, Review & Optimization frost) and the
// server (compose route, /api/me) resolve entitlements through here so the
// gate is defined once and enforced server-side.

// PlanTier ('idea' | 'garage' | 'motherfunding') is the single source of truth
// in types.ts. Legacy rows hold 'free'/'paid' (the old two-tier model) and are
// mapped by normalizePlan.
import type { PlanTier } from './types';
export type { PlanTier };
export const PLAN_TIERS: PlanTier[] = ['idea', 'garage', 'motherfunding'];

export interface PlanRow {
  tier: PlanTier;
  /** Verbatim plan name — do not translate or rephrase. */
  name: string;
  /** Monthly price label, e.g. "€85/mês" (or "€0" for the free tier). */
  monthly: string;
  /** Annual price label with the effective monthly in parentheses, if any. */
  annual?: string;
  paid: boolean;
  /** Raw euro amounts — the same numbers behind the labels above, so surfaces
   *  in another language (the English landing page) can format their own copy
   *  without parsing the Portuguese strings. */
  monthlyEur: number;
  /** Total billed once a year. */
  annualEur?: number;
  /** Effective per-month price when billed annually. */
  annualPerMonthEur?: number;
}

// Names and prices are verbatim per the founder's spec — treated as brand copy,
// not paraphrasable. Kept here so the Plans page and any pricing surface share
// one definition.
export const PLANS: PlanRow[] = [
  { tier: 'idea', name: 'Mom, I have an idea', monthly: '€0', paid: false, monthlyEur: 0 },
  { tier: 'garage', name: "Dad, I'm leaving the garage", monthly: '€85/mês', annual: '€756/ano (equivale a €63/mês)', paid: true, monthlyEur: 85, annualEur: 756, annualPerMonthEur: 63 },
  { tier: 'motherfunding', name: 'Motherfunding', monthly: '€149/mês', annual: '€1.308/ano (equivale a €109/mês)', paid: true, monthlyEur: 149, annualEur: 1308, annualPerMonthEur: 109 },
];

// Success fee SUSPENDED (founder decision, post legal consultation, 2026-07-23):
// pending regulatory clarity. All user-facing fee copy (the 1,3%, the 18-month
// tail, the plan-deduction, the "Termos sujeitos a contrato" caveat) is removed
// — subscriptions are the only thing a startup pays at this stage. Replaced on
// the Plans page by this one discreet, terms-free note. No percentages, no terms.
export const CONSULTANCY_TEASER = 'Brevemente: opção de consultoria para captação de capital.';
// English rendering of the same teaser, for the public (English) landing page.
// Same promise, no percentages, no terms — the fee stays suspended.
export const CONSULTANCY_TEASER_EN_LEAD = 'Coming soon:';
export const CONSULTANCY_TEASER_EN_REST = ' a capital-raising consultancy option, for founders who want hands-on help with their round.';

// Billing period toggle (Mensal / Anual). Annual falls back to the monthly
// label when a tier has no annual price (the free 'idea' tier is €0 either way).
export type BillingPeriod = 'monthly' | 'annual';
export const BILLING_PERIODS: BillingPeriod[] = ['monthly', 'annual'];

export function planPriceLabel(p: PlanRow, period: BillingPeriod): string {
  return period === 'annual' ? (p.annual ?? p.monthly) : p.monthly;
}

// A plan-change request records BOTH the tier and the chosen billing period.
// There is no DB column for the period (no migration), so it's encoded into the
// existing free-text plan_change_requested column: an annual request is
// `<tier>@annual`, a monthly one stays a bare `<tier>` (back-compatible with
// rows written before this change). parsePlanRequest is tolerant of both.
export function encodePlanRequest(tier: PlanTier, period: BillingPeriod): string {
  return period === 'annual' ? `${tier}@annual` : tier;
}
export function parsePlanRequest(raw: string | null | undefined): { tier: PlanTier; period: BillingPeriod } {
  if (!raw) return { tier: 'idea', period: 'monthly' };
  const [t, p] = raw.split('@');
  return { tier: normalizePlan(t), period: p === 'annual' ? 'annual' : 'monthly' };
}

// User-facing gate copy, kept beside the gate that produces it.
export const AI_COMPOSER_LOCKED_COPY = 'A personalização por AI faz parte dos planos pagos';
export const REVIEW_OPTIMIZATION_PREVIEW_COPY = 'Disponível em breve, na versão Premium';

export function planRow(plan: PlanTier): PlanRow {
  return PLANS.find((p) => p.tier === plan) ?? PLANS[0];
}

export function planName(plan: PlanTier): string {
  return planRow(plan).name;
}

// Maps any stored value to a valid tier. Legacy two-tier model: 'free' -> the
// free 'idea' tier, 'paid' -> the entry paid 'garage' tier. Unknown/empty/null
// -> 'idea' (the safe, least-privileged default).
export function normalizePlan(raw: string | null | undefined): PlanTier {
  if (raw === 'idea' || raw === 'garage' || raw === 'motherfunding') return raw;
  if (raw === 'paid') return 'garage';
  return 'idea';
}

export function planIsPaid(plan: PlanTier): boolean {
  return planRow(plan).paid;
}

// What a given org may do. Resolved from the (normalized) plan plus whether the
// org is the platform team's own org (platform_admins) — the platform org has
// full access to everything regardless of its stored plan.
export interface Entitlements {
  // C — AI-personalized outreach draft in the composer. Free ('idea') plan is
  // excluded; mechanical templates and manual writing stay available to all.
  // Composes ON TOP of the env-based capabilities.ai infra switch (both must
  // pass) — this function is only the plan half.
  aiComposer: boolean;
  // A — Review & Optimization (investability ranking et al.) is a premium
  // preview: parked behind the frosted-glass overlay for EVERY org, including
  // the platform org, so the founder sees the "coming soon" treatment in their
  // own session and the built tool stays parked (not deleted). Lift later by
  // returning e.g. `isPlatformOrg` or `plan === 'motherfunding'` from the one
  // line below — no schema change.
  reviewOptimization: boolean;
}

export function planEntitlements(plan: PlanTier, isPlatformOrg: boolean): Entitlements {
  return {
    // Platform org (platform_admins) has full access; paid plans get the AI
    // composer; the free 'idea' tier does not.
    aiComposer: isPlatformOrg || planIsPaid(plan),
    // Parked for all — see the note on the field above.
    reviewOptimization: false,
  };
}
