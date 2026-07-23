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
}

// Names and prices are verbatim per the founder's spec — treated as brand copy,
// not paraphrasable. Kept here so the Plans page and any pricing surface share
// one definition.
export const PLANS: PlanRow[] = [
  { tier: 'idea', name: 'Mom, I have an idea', monthly: '€0', paid: false },
  { tier: 'garage', name: "Dad, I'm leaving the garage", monthly: '€85/mês', annual: '€756/ano (equivale a €63/mês)', paid: true },
  { tier: 'motherfunding', name: 'Motherfunding', monthly: '€149/mês', annual: '€1.308/ano (equivale a €109/mês)', paid: true },
];

// Success-fee copy (Portuguese, verbatim). NOT accepted terms — the plans page
// must present this with the "Termos sujeitos a contrato" caveat and no
// consent checkbox; the binding contract comes later.
export const SUCCESS_FEE_COPY =
  '1,3% sobre capital efetivamente levantado junto de investidores fornecidos pela plataforma; '
  + 'aplica-se até 18 meses após o cancelamento do serviço; ao valor do fee são deduzidos os '
  + 'montantes pagos em planos até à data do investimento.';
export const SUCCESS_FEE_CAVEAT = 'Termos sujeitos a contrato';

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
