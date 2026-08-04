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

// Day-one catalog-investor quota BASELINE per tier (pipeline "vidro fosco"
// blocking — DECISIONS.md, migration 0042). Display/reference copy ONLY,
// and only accurate for a freshly-seeded org: the real, live number is
// `orgs.catalog_quota` in Postgres, an accumulating counter seeded from
// these values but never reset (a monthly delivery job — not yet built —
// is meant to grow it further; this constant does not). RLS on entities
// enforces against `orgs.catalog_quota` via plan_catalog_quota(), never
// against this TypeScript constant. Applies only to entities.source
// ='catalog'; 'manual' and 'match_deal' entities are always unlocked and
// don't count against this.
export const CATALOG_QUOTA: Record<PlanTier, number> = {
  idea: 3,
  garage: 15,
  motherfunding: 40,
};

// Watson (AI composer) monthly draft quota — Prompt 106 §B / confirmed by
// Nuno 2026-08-03 as 90/210 (not the 100/300 that appeared in an earlier,
// never-committed draft of the plan copy). The bullet text and the real
// gate in /api/compose/route.ts both read this single constant — never
// hand-write the number in two places again, that's exactly how the
// 100/300 vs 90/210 divergence happened.
export const WATSON_DRAFT_QUOTA: Record<PlanTier, number> = {
  idea: 0,
  garage: 90,
  motherfunding: 210,
};

// MatchDeal weekly allowance per startup plan tier. These are DISPLAY copy for
// the plan cards; the enforced numbers live in the Postgres function
// matchdeal_tier_limits(tier_a|tier_b|tier_c) and are keyed on
// matchdeal_profiles.plan_tier, NOT on orgs.plan. The map below is the bridge
// between the two, and PLAN_TO_MATCHDEAL_TIER must be applied on every plan
// change (see plan-sync.ts) or the copy promises what the deck does not
// deliver (Prompt 113 §1.1).
export const PLAN_TO_MATCHDEAL_TIER: Record<PlanTier, 'tier_a' | 'tier_b' | 'tier_c'> = {
  idea: 'tier_a', garage: 'tier_b', motherfunding: 'tier_c',
};
export const MATCHDEAL_WEEKLY: Record<PlanTier, { deck: number; likes: number; undos: number | null }> = {
  idea: { deck: 3, likes: 1, undos: 0 },
  garage: { deck: 10, likes: 5, undos: 2 },
  motherfunding: { deck: 20, likes: 10, undos: null },
};

export interface PlanRow {
  tier: PlanTier;
  /** Verbatim plan name — do not translate or rephrase. */
  name: string;
  /** Monthly price label, e.g. "€85/month" (or "€0" for the free tier). */
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
  // Prompt 79 — deliberately NOT computed from price. The raw numbers don't
  // support a "cheapest" story (garage's annual rate, €63/mo, undercuts
  // motherfunding's €109/mo) — the founder's actual call is an editorial
  // "best value" pick on the top paid tier, not a price comparison, so it's
  // a plain per-plan flag instead of forcing a calculation to land on it.
  bestValue?: boolean;
  /** One line: who this plan is for. */
  tagline: string;
  /**
   * The FULL, cumulative list of what this plan includes — not a delta.
   * Each tier's array is the previous tier's array plus what's new, in that
   * order, so a generic renderer can diff consecutive entries to highlight
   * "what's new" without any extra data (see plans/PlanCards.tsx). Every
   * line maps to a real capability in the app today, or is explicitly
   * marked "(coming soon)" when it names something already built but
   * parked (Review & Optimization) rather than implying it ships now.
   */
  bullets: string[];
  /** Named, already-built-but-parked capabilities for this tier. Rendered UNDER
   *  the bullet list, in a lighter treatment, never inside it. A bullet list is a
   *  promise of what you get on the day you pay; anything that is not available
   *  that day does not belong in it (Prompt 113 §3.4). */
  comingSoon?: string[];
}

// Names and prices are verbatim per the founder's spec — treated as brand copy,
// not paraphrasable. Kept here so the Plans page and any pricing surface share
// one definition.
export const PLANS: PlanRow[] = [
  {
    tier: 'idea', name: 'Elementary, my dear', monthly: '€0', paid: false, monthlyEur: 0,
    tagline: 'For your very first steps',
    bullets: [
      'Investor pipeline — every conversation, its stage and its next step, in one place',
      'Agenda — what to do today, built from the pipeline itself',
      'Company profile with a completeness score that names what is still missing',
      'Vault Data Room — folders, documents, and access granted person by person',
      'Send discipline built in — kill-word linting, volume caps and contact locks, so a bad send never leaves',
      'Needs-review queue — nothing goes out without you seeing it first',
      'Bring your own investors — CSV import or manual entry, no limit',
      `${CATALOG_QUOTA.idea} investors unlocked from the Sherlock Deal catalogue`,
      'Message templates — mechanical, no AI',
      `MatchDeal — ${MATCHDEAL_WEEKLY.idea.deck} new investors a week, ${MATCHDEAL_WEEKLY.idea.likes} swipe right`,
    ],
  },
  {
    tier: 'garage', name: 'List of Suspects', monthly: '€85/month', annual: '€756/year (equivalent to €63/month)', paid: true, monthlyEur: 85, annualEur: 756, annualPerMonthEur: 63,
    tagline: 'For rounds already in motion',
    bullets: [
      'Investor pipeline — every conversation, its stage and its next step, in one place',
      'Agenda — what to do today, built from the pipeline itself',
      'Company profile with a completeness score that names what is still missing',
      'Vault Data Room — folders, documents, and access granted person by person',
      'Send discipline built in — kill-word linting, volume caps and contact locks, so a bad send never leaves',
      'Needs-review queue — nothing goes out without you seeing it first',
      'Bring your own investors — CSV import or manual entry, no limit',
      `${CATALOG_QUOTA.garage} investors unlocked from the Sherlock Deal catalogue`,
      'Message templates — mechanical, no AI',
      `MatchDeal — ${MATCHDEAL_WEEKLY.garage.deck} new investors a week, ${MATCHDEAL_WEEKLY.garage.likes} swipe rights, ${MATCHDEAL_WEEKLY.garage.undos} reconsiderations`,
      `${WATSON_DRAFT_QUOTA.garage} AI-written outreach drafts a month — each one built from that investor's thesis, not a mail merge`,
      'Automations — reminders and follow-ups that fire without you remembering them',
      'Share documents under NDA — the signature is captured and filed with the document',
      'Reawakening — when something changes on your side, the system re-reads your dormant investors and tells you which are worth reopening',
    ],
  },
  {
    tier: 'motherfunding', name: "It's the butler!", monthly: '€149/month', annual: '€1,308/year (equivalent to €109/month)', paid: true, monthlyEur: 149, annualEur: 1308, annualPerMonthEur: 109,
    bestValue: true,
    tagline: 'For serious, multi-investor raises',
    bullets: [
      'Investor pipeline — every conversation, its stage and its next step, in one place',
      'Agenda — what to do today, built from the pipeline itself',
      'Company profile with a completeness score that names what is still missing',
      'Vault Data Room — folders, documents, and access granted person by person',
      'Send discipline built in — kill-word linting, volume caps and contact locks, so a bad send never leaves',
      'Needs-review queue — nothing goes out without you seeing it first',
      'Bring your own investors — CSV import or manual entry, no limit',
      `${CATALOG_QUOTA.motherfunding} investors unlocked from the Sherlock Deal catalogue`,
      'Message templates — mechanical, no AI',
      `MatchDeal — ${MATCHDEAL_WEEKLY.motherfunding.deck} new investors a week, ${MATCHDEAL_WEEKLY.motherfunding.likes} swipe rights, and unlimited reconsiderations until those ${MATCHDEAL_WEEKLY.motherfunding.likes} are used`,
      `${WATSON_DRAFT_QUOTA.motherfunding} AI-written outreach drafts a month — each one built from that investor's thesis, not a mail merge`,
      'Automations — reminders and follow-ups that fire without you remembering them',
      'Share documents under NDA — the signature is captured and filed with the document',
      'Reawakening — when something changes on your side, the system re-reads your dormant investors and tells you which are worth reopening',
      'Priority support — a person who knows your round, not a queue',
    ],
    comingSoon: [
      'Advanced Review & Optimization',
      'Investability reports',
    ],
  },
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
export const AI_COMPOSER_LOCKED_COPY = 'AI personalization is part of the paid plans';
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
  // A — Review & Optimization (investability ranking et al.). Prompt 115
  // Fase 0: no longer parked for everyone — it's platform-only preview now,
  // open for `ablute_` (the platform org) to validate the v1 against real
  // documents before it opens to paid plans. Every customer plan still sees
  // the frosted-glass overlay. Lift further later by also returning true for
  // e.g. `plan === 'motherfunding'` — no schema change needed for that.
  reviewOptimization: boolean;
}

export function planEntitlements(plan: PlanTier, isPlatformOrg: boolean): Entitlements {
  return {
    // Platform org (platform_admins) has full access; paid plans get the AI
    // composer; the free 'idea' tier does not.
    aiComposer: isPlatformOrg || planIsPaid(plan),
    // Platform-only preview (Prompt 115 Fase 0) — see the note on the field above.
    reviewOptimization: isPlatformOrg,
  };
}

// --- Investor plans (Investor Workspace landing, /investors) -------------
// Separate from PlanTier/PLANS above: those gate the founder-side app's
// entitlements against org.plan in the DB. Investor plans have no DB column
// or gate yet — they exist only to price the /investors landing page (and,
// later, an investor Plans surface) from one place, the same way PLANS does
// for founders. No free tier for investors (product decision).
//
// PLAN-01 rename (2026-07-30): Boy Scout -> Pro Scout, Pro Spotter -> Ace
// Spotter, Ace Sleuth -> The Legendary Sleuth. Only the tier identifiers and
// display names changed here — the DB-facing MatchDeal tier codes
// (tier_a/tier_b/tier_c in matchdeal_profiles.plan_tier) are a separate,
// unrelated system (see InvestorPlansPanel.tsx's MATCHDEAL_TO_TIER map) and
// are untouched by this rename.
//
// bullets is the FULL card content per tier, verbatim from the spec — not a
// feature delta. Some lines repeat across tiers with an updated number
// (seats, qualified opportunities, Data Room/DD limits); that's intentional
// spec copy, not something to be deduped. The renderer prefixes tiers after
// the first with "Everything in {previous tier's name}, plus:" purely from
// array order (fixed: Pro Scout, Ace Spotter, The Legendary Sleuth) — no
// separate field needed, and it can't accidentally skip a tier the way a
// manually-written string could.
export type InvestorPlanTier = 'pro_scout' | 'ace_spotter' | 'legendary_sleuth';

export interface InvestorPlanRow {
  tier: InvestorPlanTier;
  name: string;
  tagline: string;
  monthlyEur: number;
  annualEur: number;
  annualPerMonthEur: number;
  /** True while the annual price is a placeholder pending founder confirmation. */
  annualPending?: boolean;
  seats: number;
  /** Qualified opportunities/month cap — also drives the landing page teaser line. */
  monthlyCap: number;
  bullets: string[];
}

// PLAN-05 — required on every card, per the spec's own footnote markers (*)
// used inline in the bullets above.
export const INVESTOR_PLAN_FOOTNOTES = {
  dataRoom: '*Requires permission from the startup.',
  dueDiligence: '**Requires a meeting with the startup and permission from the startup.',
};

export const INVESTOR_PLANS: InvestorPlanRow[] = [
  {
    tier: 'pro_scout', name: 'Pro Scout', tagline: 'For angels and first funds',
    monthlyEur: 130, annualEur: 1200, annualPerMonthEur: 100,
    seats: 1, monthlyCap: 10,
    bullets: [
      '1 seat',
      'Startup Pipeline & Smart Calendar',
      'Up to 10 qualified opportunities/month',
      'Access to shared private limited Vault Data Room content for up to 5 startups/month*',
      'Access to shared private limited Due Diligence files for up to 2 startups/month**',
      'Add & Invite Startups',
    ],
  },
  {
    tier: 'ace_spotter', name: 'Ace Spotter', tagline: 'For active VC and FO teams',
    monthlyEur: 240,
    // TODO: annual price pending confirmation — placeholder from the spec.
    annualEur: 2220, annualPerMonthEur: 185, annualPending: true,
    seats: 2, monthlyCap: 22,
    bullets: [
      '2 seats',
      'Startup Pipeline & Smart Calendar',
      'Up to 22 qualified opportunities/month',
      'Access to shared private limited Vault Data Room content for up to 11 startups/month*',
      'Access to shared private limited Due Diligence files for up to 5 startups/month**',
      'Access to MatchDeal mobile app',
      '10 new startups/week on MatchDeal',
      '5 Swipe Rights/week',
      '2 Reconsiderations/week',
      'Hype List limited to 5 startups',
    ],
  },
  {
    tier: 'legendary_sleuth', name: 'The Legendary Sleuth', tagline: 'For high-volume funds',
    monthlyEur: 450,
    // TODO: annual price pending confirmation — placeholder from the spec.
    annualEur: 4140, annualPerMonthEur: 345, annualPending: true,
    seats: 5, monthlyCap: 46,
    bullets: [
      '5 seats',
      'Startup Pipeline & Smart Calendar',
      'Up to 46 qualified opportunities/month',
      'Access to shared private limited Vault Data Room content for up to 23 startups/month*',
      'Access to shared private limited Due Diligence files for up to 11 startups/month**',
      'Access to MatchDeal mobile app',
      '20 new startups/week on MatchDeal',
      '10 Swipe Rights/week',
      'Unlimited Reconsiderations until the 10 weekly Swipe Rights have been used',
      'Access to the entire Startup Hype List',
    ],
  },
];

export function investorPlanRow(tier: InvestorPlanTier): InvestorPlanRow {
  return INVESTOR_PLANS.find((p) => p.tier === tier) ?? INVESTOR_PLANS[0];
}

// PLAN-02 — the 4th plan: no fixed price, a contact form instead of a
// checkout/request CTA. Deliberately NOT part of INVESTOR_PLANS (which
// models priced, structured plans with seats/caps/bullets) — the card and
// its behaviour are different enough that folding it in would mean
// nullable pricing fields leaking into every other reader of that array.
export const PRIVATE_DETECTIVE_PLAN = {
  name: 'Private Detective',
  description: 'Get a personalized service and pricing.',
  ctaLabel: 'Contact the Sherlock Team',
};
