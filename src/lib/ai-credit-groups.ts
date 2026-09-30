// Prompt 749 §"Grupos de IA" — one definition of which ai_actions.key values
// group under which card-facing name, and the minimum plan that unlocks
// each group. Pure data, no I/O — shared by the plan cards (this prompt),
// the backoffice AI-credits screen, and Plans & billing's own "what do my
// credits cover" explainer later, per the prompt's own instruction.
//
// Confirmed against the ai_actions seed (migration 20260921090000) and each
// action's real gate at the route that calls chargeAiAction/charge_ai_action
// — every actionKey below is checked to actually exist and actually be
// unmetered/metered/gated the way its group implies. Two corrections to the
// prompt's own text, both because the literal instruction would have
// mis-stated what's actually gated — and both folded into an EXISTING
// group's actionKeys rather than given their own card-visible entry, so the
// exposed group count per tier still matches the prompt's own explicit
// unit-test spec (3 idea / 6 garage / 8 motherfunding):
//
// 1. "Benchmark my market" (market_data_review) — the prompt's own grouping
//    text lists this under the general "Market & document intelligence"
//    bucket, alongside genuinely ungated actions. It isn't: ai-review/route.ts
//    gates market_data_review behind the SAME planEntitlements(...).
//    reviewTopTierTools check as cross_document_review ("Find contradictions")
//    — motherfunding-only, not general-availability. Folded into "Market
//    data research" below (same gate, same subject matter) instead of the
//    ungated bucket, and instead of a new separate card bullet.
// 2. "Review with AI" per document (document_review) — the prompt's own text
//    already places this correctly ("esta dentro do painel de Advanced
//    review, só planos pagos") but lists it inside the general "Market &
//    document intelligence" prose paragraph. Folded into "Advanced Review &
//    Optimization" below (the panel it actually lives in, planEntitlements
//    reviewOptimization-gated) rather than the ungated bucket.
// 3. "Form Assist" has no ai_actions.key at all — src/app/api/form-assist/
//    route.ts never calls chargeAiAction/charge_ai_action (confirmed: no
//    reference anywhere in that file). It's real and it IS plan-gated
//    (planEntitlements(...).aiComposer, same gate as compose_outreach), just
//    not credit-metered — so it's simply omitted from actionKeys (nothing to
//    charge) while the group's own minPlan still reflects the real access
//    gate both tools share.
export type MinPlan = 'idea' | 'garage' | 'motherfunding';

export interface AiCreditGroup {
  /** Card-facing name. */
  name: string;
  /** ai_actions.key values this group covers — may be empty (see Form Assist above). */
  actionKeys: string[];
  /** The cheapest plan tier that unlocks this group. */
  minPlan: MinPlan;
}

export const AI_CREDIT_GROUPS: AiCreditGroup[] = [
  {
    name: 'Pitch Blueprint assistant',
    actionKeys: ['answer_routing', 'blueprint_gap_draft', 'blueprint_gap_polish', 'reconciliation', 'strengthen_suggest', 'mini_pitch_synthesis'],
    minPlan: 'idea',
  },
  {
    name: 'Company & team research',
    actionKeys: ['team_sherlock_research', 'entity_enrich', 'roadmap_suggest'],
    minPlan: 'idea',
  },
  // Deliberately excludes document_review (paid-plan only, lives inside the
  // Advanced Review panel — see the group below) and market_data_review
  // (motherfunding-only — see the correction note above).
  {
    name: 'Market & document intelligence',
    actionKeys: ['market_thesis_hypotheses_generate', 'market_thesis_document_suggest', 'market_document_extract', 'document_extraction'],
    minPlan: 'idea',
  },
  {
    name: 'AI outreach drafts',
    // Form Assist has no ai_actions.key (unmetered) — see the header note.
    // Both tools share the aiComposer gate, so the group's minPlan is
    // accurate even though only one of the two names has a chargeable key.
    actionKeys: ['compose_outreach'],
    minPlan: 'garage',
  },
  {
    name: 'Advanced Review & Optimization',
    // document_review ("Review with AI" per document) lives inside this
    // panel and shares its reviewOptimization gate — folded in here rather
    // than given its own card bullet (correction note 2 above).
    actionKeys: ['document_review'],
    minPlan: 'garage',
  },
  {
    name: 'Investability reports',
    actionKeys: ['investability_report'],
    minPlan: 'garage',
  },
  {
    name: 'Market data research',
    // market_data_review ("Benchmark my market") shares this group's
    // reviewTopTierTools gate and subject matter — folded in rather than
    // given its own card bullet (correction note 1 above).
    actionKeys: ['market_research', 'market_data_review'],
    minPlan: 'motherfunding',
  },
  {
    name: 'Find contradictions across documents',
    actionKeys: ['cross_document_review'],
    minPlan: 'motherfunding',
  },
];

const TIER_RANK: Record<MinPlan, number> = { idea: 0, garage: 1, motherfunding: 2 };

/** Every group whose minPlan is at or below `tier` — "what this plan's AI credits cover." */
export function aiCreditGroupsForTier(tier: MinPlan): AiCreditGroup[] {
  return AI_CREDIT_GROUPS.filter((g) => TIER_RANK[g.minPlan] <= TIER_RANK[tier]);
}
