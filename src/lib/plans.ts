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
import type { PlanCardSection } from '@/components/plans/types';
import { PLAN_PIPELINE_MONTHLY_ADDITION } from './pipeline-unlock';
import { aiCreditGroupsForTier } from './ai-credit-groups';
export type { PlanTier };
export const PLAN_TIERS: PlanTier[] = ['idea', 'garage', 'motherfunding'];

// RETIRED (Prompt 180, 12/08) — this used to be a fixed 3/15/40 day-one
// catalog-investor quota baseline (migration 0042, 28/07), never updated
// when the REAL pipeline-unlock formula (PLAN_PIPELINE_BASE 5/10/25 + bonuses
// + PLAN_PIPELINE_MONTHLY_ADDITION 10/25/50/month — pipeline-unlock.ts,
// Prompt 123, 04/08) was built four days later. The two numbers were never
// reconciled: `orgs.catalog_quota` (what RLS actually lets unlockPack
// insert) stayed capped at the old 3/15/40 baseline while the pipeline-
// unlock badge already showed a theoretically larger unlocked count against
// it — confirmed in production (Prompt 179/180). Nuno's decision:
// `orgs.catalog_quota` is now computed from the SAME formula as
// visiblePipelineSize() (pipeline-unlock-server.ts's computeCatalogQuotaTarget/
// raiseCatalogQuotaFloor), not from a second, driftable constant here. See
// plan-sync.ts (plan-change floor) and /api/pipeline-unlock/route.ts (the
// live recompute trigger) for the call sites that replaced this.

// Watson (AI composer) monthly draft quota — Prompt 106 §B / confirmed by
// Nuno 2026-08-03 as 90/210 (not the 100/300 that appeared in an earlier,
// never-committed draft of the plan copy).
//
// Prompt 749 — RETIRED from the plan card. Dead since Prompt 706: nothing
// outside this file reads it any more (confirmed by grep — every remaining
// reference was the card's own bullet-string interpolation, now removed).
// compose_outreach draws from the shared AI-credits wallet
// (plans.monthly_ai_credits, ai-credits.ts) like every other metered
// action, not from this compose-only counter. Left defined, unused, per
// this prompt's own explicit instruction not to touch it — "a unificação
// com a carteira é outro prompt."
export const WATSON_DRAFT_QUOTA: Record<PlanTier, number> = {
  idea: 0,
  garage: 90,
  motherfunding: 210,
};

// Prompt 166 §B — monthly investability-review quota, per STARTUP plan (not
// the investor side). Nuno's decision: idea=0 (Review & Optimization is
// already excluded at that tier — see planEntitlements().reviewOptimization
// — so this is defense in depth, made explicit in the UI per his own
// instruction, not the primary gate), garage=5, motherfunding=null
// (unlimited, same null-means-unlimited convention as
// MATCHDEAL_WEEKLY.motherfunding.undos above). Enforced in
// /api/review/investability by counting review_runs created since the start
// of the current CALENDAR month — deliberately NOT the Watson-style rolling
// window anchored to a stored reset column, since review_runs already
// timestamps every run and the spec asks for calendar-month resets
// specifically ("resets on the 1st").
export const REVIEW_QUOTA: Record<PlanTier, number | null> = {
  idea: 0,
  garage: 5,
  motherfunding: null,
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
}

// Names and prices are verbatim per the founder's spec — treated as brand copy,
// not paraphrasable. Kept here so the Plans page and any pricing surface share
// one definition.
export const PLANS: PlanRow[] = [
  {
    tier: 'idea', name: 'Elementary, my dear', monthly: '€0', paid: false, monthlyEur: 0,
    tagline: 'For your very first steps',
  },
  {
    tier: 'garage', name: 'List of Suspects', monthly: '€85/month', annual: '€756/year (equivalent to €63/month)', paid: true, monthlyEur: 85, annualEur: 756, annualPerMonthEur: 63,
    tagline: 'For rounds already in motion',
  },
  {
    tier: 'motherfunding', name: "It's the butler!", monthly: '€149/month', annual: '€1,308/year (equivalent to €109/month)', paid: true, monthlyEur: 149, annualEur: 1308, annualPerMonthEur: 109,
    bestValue: true,
    tagline: 'For serious, multi-investor raises',
  },
];

// Prompt 749 — replaces the old `PlanRow.bullets: string[]` (with `\n` +
// `·`-prefixed sub-bullets baked into the strings) and the "each tier's
// array is the previous tier's plus what's new" cumulative-array contract
// that used to live here. Every tier's card now states its own COMPLETE,
// independent feature list via structured sections — nothing implied by
// array order, nothing filtered out at render time.
//
// This is a FUNCTION, not static data, because the AI-credits line's own
// number (plans.monthly_ai_credits, backoffice-editable) is the one thing
// on this card that is never hand-written — see this prompt's own
// "Os números não se escrevem à mão". Every caller fetches that number
// fresh (no long cache — see plan-credits-server.ts) and passes it in;
// `null` (fetch not done yet, or genuinely failed) renders the AI-credits
// line without a number ("AI credits included") rather than falling back
// to a guessed constant.
//
// Audit trail (full account in DECISIONS.md, Prompt 749): six lines that
// used to appear on the garage/motherfunding cards had no code behind
// them at all — "1 full pipeline reprioritization per month", "Smart
// follow-up for up to N active investor contacts", "1 active fundraising
// round" (the schema only ever represents one current round — nothing
// stops a second attempt, there's just nowhere to put it), "Automated
// reminders and follow-up sequencing" (no sequencing engine exists
// anywhere in this codebase), "Investor re-engagement engine" ("Ask
// Sherlock" is real but is NOT plan-gated — available on idea today
// despite the old copy implying paid-only), and the WATSON_DRAFT_QUOTA
// line (dead since Prompt 706 — compose_outreach draws from the shared
// AI-credits wallet now, folded into the AI-credits section below
// instead). All six are gone. The "N investors available once your core
// profile is complete" line moved out of the body and into the curated-
// pipeline asterisk note, per Nuno's own instruction. The Vault Data Room
// "Preset" vs "Customizable" distinction is dropped — no plan gate on
// folder customization was found anywhere in the codebase, so all three
// tiers now say the same thing rather than implying a difference that
// isn't real. The seat-count line ("1 user"/"2 users"/"5 users") stays,
// per Nuno's own instruction, marked enforcedBy: 'NOT_ENFORCED' — real
// commercial language, not currently backed by a limit check anywhere
// (api/invite/create has no seat-count comparison at all).
function matchDealLine(tier: PlanTier): string {
  const w = MATCHDEAL_WEEKLY[tier];
  const parts = [
    `${w.deck} new investors per week`,
    `${w.likes} Swipe Right${w.likes === 1 ? '' : 's'} per week`,
  ];
  if (w.undos === null) parts.push(`Unlimited Reconsiderations until you use the ${w.likes} weekly Swipe Rights`);
  else if (w.undos > 0) parts.push(`${w.undos} Reconsideration${w.undos === 1 ? '' : 's'} per week`);
  return `MatchDeal: ${parts.join(' · ')}`;
}

const SEAT_COUNT_LABEL: Record<PlanTier, string> = { idea: '1 user', garage: '2 users', motherfunding: '5 users' };

// Prompt 749 — the curated-pipeline asterisk, verbatim, shared by every
// tier's card footer (PlanCards.tsx collects and dedupes section notes
// rather than repeating this three times).
export const CURATED_PIPELINE_NOTE = '*Curation unlocks once your profile has enough information for a personalised curation.';

export function buildPlanSections(tier: PlanTier, aiCreditsForTier: number | null): PlanCardSection[] {
  const aiGroups = aiCreditGroupsForTier(tier);
  return [
    { title: SEAT_COUNT_LABEL[tier], enforcedBy: 'NOT_ENFORCED', items: [] },
    {
      title: aiCreditsForTier != null ? `${aiCreditsForTier} AI credits / month` : 'AI credits included',
      enforcedBy: 'ai-credits-wallet',
      items: aiGroups.map((g) => ({ text: g.name, enforcedBy: 'ai-credits-wallet' as const })),
    },
    {
      title: 'Curated pipeline*', enforcedBy: 'pipeline-unlock.ts',
      items: [
        { text: 'Curation by enriched database', enforcedBy: 'pipeline-unlock.ts' },
        { text: `Up to ${PLAN_PIPELINE_MONTHLY_ADDITION[tier]} new curated investors / month*`, enforcedBy: 'pipeline-unlock.ts' },
        { text: 'Unlimited manually added investors', enforcedBy: 'always-available' },
      ],
      note: CURATED_PIPELINE_NOTE,
    },
    { title: matchDealLine(tier), enforcedBy: 'matchdeal_tier_limits', items: [] },
    { title: 'Smart Calendar', enforcedBy: 'always-available', items: [] },
    // Prompt 749 — "Preset" (idea) vs "Customizable" (paid) dropped: no
    // plan gate on Vault folder customization exists anywhere in the
    // codebase (checked — folders are a free-text attribute on documents,
    // not a first-class resource with its own creation/limit route). Same
    // text on all three tiers rather than implying a difference that isn't real.
    { title: 'Vault Data Room with access control', enforcedBy: 'always-available', items: [] },
    { title: 'Protected Outreach (Linting, Volume Caps & Contact Locks)', enforcedBy: 'always-available', items: [] },
    { title: 'Actionable Review Queue', enforcedBy: 'always-available', items: [] },
    { title: 'Bulk Investor Import', enforcedBy: 'always-available', items: [] },
    { title: 'NDA-protected document sharing', enforcedBy: 'always-available', items: [] },
  ];
}

// Success fee SUSPENDED (founder decision, post legal consultation, 2026-07-23):
// pending regulatory clarity. All user-facing fee copy (the 1,3%, the 18-month
// tail, the plan-deduction, the "Termos sujeitos a contrato" caveat) is removed
// — subscriptions are the only thing a startup pays at this stage.
// Prompt 158 — the consultancy teaser itself ("Coming soon: a capital-raising
// consultancy option…") is also removed now, per Nuno (10/08): no fee copy,
// no consultancy teaser, no terms, nothing in its place.

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
// Prompt 117 Bloco G.2 — was hardcoded to 'the Premium plan', a tier name
// that has never existed in this product (see WATSON_DRAFT_QUOTA's own
// 100/300-vs-90/210 divergence bug for why hardcoded tier names rot).
// Prompt 160 — was `Coming soon on the ${planName('motherfunding')} plan`,
// naming only the top tier; now inaccurate now that planEntitlements()
// opens reviewOptimization on BOTH paid plans (garage too), and this
// message only ever shows to the free plan now (see ReadinessPanel.tsx's
// `locked` — purely entitlement-driven). Reworded generically, matching
// AI_COMPOSER_LOCKED_COPY's own "part of the paid plans" phrasing, so it
// can't drift out of sync with which specific tier(s) unlock it again.
export const REVIEW_OPTIMIZATION_PREVIEW_COPY = 'Review & Optimization is part of the paid plans';

export function planRow(plan: PlanTier): PlanRow {
  return PLANS.find((p) => p.tier === plan) ?? PLANS[0];
}

export function planName(plan: PlanTier): string {
  return planRow(plan).name;
}

// Prompt 567 — for a slug read from a raw, less-trusted source (a promo
// code's applicable_plans, a promo_outreach_targets row) where planRow()'s
// PLANS[0] fallback would silently mislabel an unknown value as the free
// tier instead of surfacing that something is off. Falls back to the raw
// slug itself, never a wrong name. Moved here from promo-codes/page.tsx
// (Prompt 854) so the outreach table can reuse the exact same fix rather
// than re-deriving it.
export function planLabelForSlug(slug: string): string {
  return PLANS.find((p) => p.tier === slug)?.name ?? slug;
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
  // Fase 0 opened it platform-only, to validate the v1 against real
  // documents before paid plans got it. Prompt 160 (10/08) — Nuno confirmed
  // it's ready for launch; opened to both paid plans below, same pattern as
  // aiComposer. Free ('idea') stays excluded — the plan card never promised
  // this on the free tier (plans.ts's own PLANS bullets).
  reviewOptimization: boolean;
  // Prompt 117 Bloco G — Cross-document check and Market data are the two
  // heavier-compute review tools; restricted to the top tier once
  // reviewOptimization itself opens beyond the platform-only preview above.
  // Composes with reviewOptimization the same way aiComposer composes with
  // capabilities.ai: both gates must pass, this is only the plan half.
  reviewTopTierTools: boolean;
}

// Prompt 115 verification note: the param used to be named `isPlatformOrg`,
// but every call site passes `role === 'developer'` — a per-USER check
// (platform_admins membership OR a confirmed @ablute.pt email, per
// resolveRole()), not a per-org one. A second member of the platform org's
// own `orgs` row who isn't personally a developer would still see this as
// false. Named for what it actually is.
export function planEntitlements(plan: PlanTier, isDeveloperRole: boolean): Entitlements {
  return {
    // Developer role gets full access; paid plans get the AI composer; the
    // free 'idea' tier does not.
    aiComposer: isDeveloperRole || planIsPaid(plan),
    // Prompt 160 — opened to both paid plans, same pattern as aiComposer
    // above. See the note on the field itself for why.
    reviewOptimization: isDeveloperRole || planIsPaid(plan),
    reviewTopTierTools: isDeveloperRole || plan === 'motherfunding',
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

// Prompt 888 — Nuno, 28/09/2026: the monthly wave quota for each investor
// tier, 10/22/46 -> 4/8/16. Declared once per tier and read by BOTH
// monthlyCap (the real server-side admission gate, investor-pipeline.ts)
// and the bullet text below, so the number a founder reads on the card can
// never drift from the number actually enforced — the old bullet spelled
// the figure out as a literal string next to a sibling monthlyCap field
// that could change without it.
const PRO_SCOUT_MONTHLY_CAP = 4;
const ACE_SPOTTER_MONTHLY_CAP = 8;
const LEGENDARY_SLEUTH_MONTHLY_CAP = 16;

export const INVESTOR_PLANS: InvestorPlanRow[] = [
  {
    tier: 'pro_scout', name: 'Pro Scout', tagline: 'For angels and first funds',
    monthlyEur: 130, annualEur: 1200, annualPerMonthEur: 100,
    seats: 1, monthlyCap: PRO_SCOUT_MONTHLY_CAP,
    // Prompt 588 — capacity, never a volume promise: every limit reads
    // "up to" + a capacity noun ("waves", "Vault access for"), never "new",
    // "delivered" or "receive". The old "Up to 10 qualified opportunities/
    // month" sat right below a hero video promising "no feed, no noise,
    // finite waves" — two opposite messages on the same page.
    bullets: [
      '1 seat',
      'Startup Pipeline & Smart Calendar',
      `Waves of up to ${PRO_SCOUT_MONTHLY_CAP} matched opportunities / month`,
      'Vault Data Room access for up to 5 startups / month*',
      'Due Diligence files for up to 2 startups / month**',
      'Add & invite your own startups',
    ],
  },
  {
    tier: 'ace_spotter', name: 'Ace Spotter', tagline: 'For active VC and FO teams',
    // Prompt 501 — preços confirmados pelo Nuno com screenshot das páginas
    // ao vivo; a bandeira `annualPending` foi removida (dizia "por
    // confirmar" sobre o valor que a app já mostrava e cobra).
    monthlyEur: 240, annualEur: 2220, annualPerMonthEur: 185,
    seats: 2, monthlyCap: ACE_SPOTTER_MONTHLY_CAP,
    bullets: [
      '2 seats',
      'Startup Pipeline & Smart Calendar',
      `Waves of up to ${ACE_SPOTTER_MONTHLY_CAP} matched opportunities / month`,
      'Vault Data Room access for up to 11 startups / month*',
      'Due Diligence files for up to 5 startups / month**',
      'MatchDeal mobile app — deck of up to 10 startups / week',
      '5 swipe rights / week · 2 reconsiderations / week',
      'Hype List — top 5 startups',
    ],
  },
  {
    tier: 'legendary_sleuth', name: 'The Legendary Sleuth', tagline: 'For high-volume funds',
    monthlyEur: 450, annualEur: 4140, annualPerMonthEur: 345,
    seats: 5, monthlyCap: LEGENDARY_SLEUTH_MONTHLY_CAP,
    bullets: [
      '5 seats',
      'Startup Pipeline & Smart Calendar',
      `Waves of up to ${LEGENDARY_SLEUTH_MONTHLY_CAP} matched opportunities / month`,
      'Vault Data Room access for up to 23 startups / month*',
      'Due Diligence files for up to 11 startups / month**',
      'MatchDeal deck of up to 20 startups / week',
      '10 swipe rights / week · unlimited reconsiderations once used',
      'Full Startup Hype List',
    ],
  },
];

export function investorPlanRow(tier: InvestorPlanTier): InvestorPlanRow {
  return INVESTOR_PLANS.find((p) => p.tier === tier) ?? INVESTOR_PLANS[0];
}

// matchdeal_profiles.plan_tier (kind='investor') stores MatchDeal's own
// internal tier names, not these plan tiers — see set-investor-plan/route.ts's
// own header comment. Centralized here (was previously duplicated as a
// local const inside InvestorPlansPanel.tsx, a client component) so
// investor-pipeline.ts's server-side monthlyCap lookup (Prompt 153) uses
// the exact same mapping, not a second copy that could drift.
export const MATCHDEAL_TIER_TO_INVESTOR_PLAN: Record<string, InvestorPlanTier> = {
  tier_a: 'pro_scout', tier_b: 'ace_spotter', tier_c: 'legendary_sleuth',
};

// Prompt 501 — o mapa inverso, para quem escreve `matchdeal_profiles.plan_tier`
// (o webhook do Stripe, /api/portal/plan/request). Era um `const
// TIER_TO_MATCHDEAL` local dentro de plan/request/route.ts; centralizado aqui
// pela mesma razão que o mapa de cima, agora que passa a ter um segundo
// escritor — duas cópias de uma tradução são duas hipóteses de divergirem.
export const INVESTOR_PLAN_TO_MATCHDEAL_TIER: Record<InvestorPlanTier, string> = {
  pro_scout: 'tier_a', ace_spotter: 'tier_b', legendary_sleuth: 'tier_c',
};

// Prompt 506 — aqui esteve `INVESTOR_PLAN_FLOOR_MATCHDEAL_TIER = 'tier_a'`,
// o piso a que o Prompt 501 descia num cancelamento. Removido: a decisão do
// Nuno é que quem deixa de pagar fica SEM acesso, não no plano mais barato —
// descer ao piso dava Pro Scout de graça. O bloqueio passou a viver em
// `investor_billing.access_state` (migração 0288) e
// `matchdeal_profiles.plan_tier` deixa de ser tocado num cancelamento,
// passando a guardar só qual era o plano.
//
// A constante não foi substituída por outra: não existe valor de plan_tier
// que signifique "nenhum" — o CHECK da coluna aceita apenas tier_a/b/c, e
// `matchdeal_tier_limits` devolve os limites do tier_a para qualquer valor
// desconhecido (`else 3 / else 1 / else 0`). As duas coisas foram medidas no
// schema real; ver a migração 0288.

// PLAN-02 — the 4th plan: no fixed price, a contact form instead of a
// checkout/request CTA. Deliberately NOT part of INVESTOR_PLANS/PLANS (which
// model priced, structured plans with seats/caps/bullets) — the card and
// its behaviour are different enough that folding it in would mean
// nullable pricing fields leaking into every other reader of those arrays.
// Prompt 690 — one card, two audiences (investor pricing on /investors +
// the signed-in /plans workspace; founder pricing on /), per the grid Nuno
// confirmed on 02/09: same component (PrivateDetectiveCard), copy keyed by
// variant so the two never need a second component to stay in sync.
export const PRIVATE_DETECTIVE_PLAN: Record<'investor' | 'founder', {
  name: string;
  tagline: string;
  /** "Custom" price, shown instead of a €amount — same slot, never affected by the Monthly/Annual toggle. */
  priceCaption: string;
  /** The "Everything in X, plus:" line other cards derive from array order — this card sits outside that array, so it's spelled out here instead. */
  openingLine: string;
  bullets: string[];
  ctaLabel: string;
}> = {
  investor: {
    name: 'Private Detective',
    tagline: 'For funds with their own rules',
    priceCaption: 'annual terms · invoiced to the fund',
    openingLine: 'Everything in The Legendary Sleuth, plus:',
    bullets: [
      "Portfolio access — sponsor Sherlock Deal for every startup in your portfolio: they use it, you're invoiced",
      'Seats, monthly caps and data-room limits set to your team',
      'One invoice to the fund, annual terms',
      'Dedicated onboarding for your team and your portfolio companies',
      'A named contact at Sherlock Deal',
    ],
    ctaLabel: 'Talk to us',
  },
  founder: {
    name: 'Private Detective',
    tagline: 'For accelerators, studios and portfolios',
    priceCaption: 'billed on custom terms',
    openingLine: "Everything in It's the butler!, plus:",
    bullets: [
      'Multi-startup access under one shared account (accelerator, studio, or fund paying for your portfolio companies)',
      'Limits set to your program',
      'One invoice, annual terms',
      'Dedicated onboarding for your team',
    ],
    ctaLabel: 'Talk to us',
  },
};

// --- Investor seats: the enforced rule (Prompt 497) ----------------------
// `InvestorPlanRow.seats` above was sales copy on /investors and nothing
// else — backoffice-metrics.ts's own comment named this gap by hand
// ("Seats/qualified-opportunities/Data Room/DD access LIMITS need the
// investor plan tiers to actually be wired to enforced counters"). The
// counter half was already real: an active `matchdeal_investor_members`
// row IS a linked seat, and investorOrgRows() has counted them since
// Prompt 123. What was missing is the comparison against the tier's limit
// at the moment a seat is added.
//
// SCOPE, deliberately: seats only. Qualified opportunities already have
// their own enforced gate (`monthlyCap`, investor-pipeline.ts, Prompt 153);
// Data Room and DD access limits stay unenforced and MEASURED only — see
// this prompt's report. `matchdeal_tier_limits()` (swipe/like) is untouched.
//
// The tier source of truth is `matchdeal_profiles.plan_tier` (MatchDeal's
// tier_a/b/c codes), mapped through MATCHDEAL_TIER_TO_INVESTOR_PLAN — NOT
// `plan_tier_requested`, which is only the investor's request pending a
// manual back-office application. 'pro_scout' (1 seat) is the fail-closed
// default for a firm with no tier set anywhere, matching the exact same
// 'tier_a' fallback investor-pipeline.ts and portal-access.ts already use.
export function investorSeatLimit(tier: InvestorPlanTier): number {
  return investorPlanRow(tier).seats;
}

export interface InvestorSeatVerdict {
  allowed: boolean;
  tier: InvestorPlanTier;
  /** Display name of the tier, e.g. "Pro Scout" — the message must say WHICH plan. */
  planName: string;
  /** Seats this tier includes. */
  limit: number;
  /** Active seats already linked to this firm, EXCLUDING the seat being added. */
  used: number;
  /** Investor-facing explanation when blocked; null when allowed. */
  reason: string | null;
}

// Pure: the caller counts the seats and resolves the tier, this decides.
// `used` is the firm's OTHER active seats — the one being added is never
// counted in it. The "is this person already seated here?" case is not this
// function's job and must be settled by the caller BEFORE asking (see
// investor-seats.ts's checkSeatAvailable and migration 0285's trigger, both
// of which short-circuit to allowed): re-linking someone who already holds
// a seat is a no-op write, not growth, and on a firm at or over its limit
// the remaining seats would otherwise refuse it.
//
// Existing over-limit firms are NOT broken by this: the comparison is
// `used >= limit` at ADD time only, so a firm already sitting above its
// limit keeps every seat it has — nothing is revoked, downgraded or
// retroactively blocked. Removing seats from such a firm is Nuno's call,
// not the code's (measured 2026-08-31: exactly one firm is over its limit,
// `ablute_ — Internal QA` at 2 seats on tier_a, and it is the internal QA
// fixture — `source='ablute_internal_qa'`, `catalog_status='demo'` — not a
// paying account; zero real accounts are over limit).
export function checkInvestorSeatLimit(args: {
  tier: InvestorPlanTier;
  /** Active seats on the firm, excluding the one being added. */
  used: number;
}): InvestorSeatVerdict {
  const row = investorPlanRow(args.tier);
  const limit = row.seats;
  const used = Math.max(0, args.used);
  if (used < limit) {
    return { allowed: true, tier: args.tier, planName: row.name, limit, used, reason: null };
  }
  const nextUp = INVESTOR_PLANS[INVESTOR_PLANS.findIndex((p) => p.tier === args.tier) + 1];
  const upgrade = nextUp ? ` To add another, upgrade to ${nextUp.name} (${nextUp.seats} seats).` : '';
  return {
    allowed: false, tier: args.tier, planName: row.name, limit, used,
    reason: `Your firm is on ${row.name}, which includes ${limit} seat${limit === 1 ? '' : 's'}`
      + `, and ${used} ${used === 1 ? 'is' : 'are'} already linked.${upgrade}`,
  };
}
