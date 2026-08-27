// Prompt 411 §A.1 — Market axis BARS bank. Faithful transcription of
// bars_banks_market_product_technology_v1/v2_20260827.md.
//
// Translation note (disclose, don't hide): questions 6 (differentiation_space,
// revised) and 9 (accessibility, new) were given in the v2 source document
// in Portuguese/mixed-language working notes rather than finished English
// copy — unlike Team v2's own revisions, which were delivered as clean,
// ready English. The English anchors below are MY translation of that
// approved Portuguese substance, done carefully to preserve every point
// made, but a translation nonetheless, not a verbatim source quote like
// the rest of this bank. Flagged in the commit for Nuno's review.
import type { BarsBank } from '@/lib/bars-types';
import { ALL_PHASES, phaseRange } from '@/lib/bars-types';

export const MARKET_V1: BarsBank = {
  axis: 'market',
  version: 'market_v1',
  questions: [
    {
      id: 'market.size_credibility',
      axis: 'market',
      subdimension: 'Size & Growth',
      stages: ALL_PHASES,
      question: 'How is the market size claim actually constructed?',
      anchors: {
        l1: 'A top-down headline number ("X% of a $NNbn market") with no path from the number to this product\'s buyers.',
        l3: 'Bottom-up logic exists (buyers × frequency × price) but key multipliers are assumed, not evidenced.',
        l5: 'Bottom-up sizing grounded in evidence (named segments, real price points, at least one input validated by data or a credible source), with SAM/SOM honestly smaller than the headline.',
      },
      evidenceHints: ['claim', 'document'],
      why: 'The construction of the number reveals more than the number.',
    },
    {
      id: 'market.growth_trajectory',
      axis: 'market',
      subdimension: 'Size & Growth',
      stages: ALL_PHASES,
      question: 'What evidence shows this market is growing rather than assumed to grow?',
      anchors: {
        l1: 'Growth asserted; no source, or sources describe an adjacent market.',
        l3: "Credible third-party sources show growth, but for a broader category than the startup's actual segment.",
        l5: 'Segment-specific growth evidenced (independent sources, observable demand signals — search/waitlists/procurement trends), and the startup can say WHO the new demand is.',
      },
      evidenceHints: ['document', 'claim', 'traction_metric'],
      why: 'Separates riding a real wave from narrating one.',
    },
    {
      id: 'market.timing_why_now',
      axis: 'market',
      subdimension: 'Timing & Demand',
      stages: ALL_PHASES,
      question: 'What changed in the world that makes this possible or urgent NOW?',
      anchors: {
        l1: 'Nothing identifiable changed; the idea was equally possible five years ago (and someone likely tried).',
        l3: 'A plausible enabler (technology cost curve, regulation, behavior shift) is named but its link to buying behavior is untested.',
        l5: 'A concrete, dated change (new regulation in force, new tech capability, structural cost shift) with early evidence that buyers behave differently because of it.',
      },
      evidenceHints: ['document', 'claim', 'interaction'],
      why: 'Most "too early" failures are timing failures nobody priced.',
    },
    {
      id: 'market.buyer_urgency',
      axis: 'market',
      subdimension: 'Timing & Demand',
      stages: ALL_PHASES,
      question: 'For the actual buyer, is this a hair-on-fire problem or a vitamin?',
      anchors: {
        l1: 'No evidence any buyer prioritizes this; interest is polite; no budget line exists.',
        l3: 'Buyers confirm the pain and some have budget, but it competes with higher priorities; long, unowned buying processes.',
        l5: 'Evidence of urgency: buyers pre-committing (LOIs, deposits, pilots they push for), an existing budget line or a compliance/financial deadline forcing action.',
      },
      stageNotes: 'Launch/growth: read it in conversion/sales-cycle data, not interviews.',
      evidenceHints: ['traction_metric', 'interaction'],
      why: 'Urgency, not size, is what converts early markets into revenue.',
    },
    {
      id: 'market.competitive_intensity',
      axis: 'market',
      subdimension: 'Competition & Barriers',
      stages: ALL_PHASES,
      question: 'Who is really competing for this budget — including the status quo — and how strong are they?',
      anchors: {
        l1: '"No competitors" claimed, or the map ignores the strongest one (doing nothing / spreadsheets / incumbent workflow).',
        l3: 'Honest map of named competitors including the status quo, but little evidence of how deals are actually won or lost against them.',
        l5: 'Named competitive map WITH win/loss evidence: why real buyers chose them (or the incumbent), and what that implies about positioning.',
      },
      evidenceHints: ['claim', 'investor_note', 'interaction'],
      why: '"No competition" is the reddest phrase in venture; the status quo always competes.',
    },
    {
      id: 'market.differentiation_space',
      axis: 'market',
      subdimension: 'Competition & Barriers',
      stages: ALL_PHASES,
      question: 'Is there a position in this market the startup can credibly own?',
      anchors: {
        l1: '"Same but cheaper/better" against funded incumbents; no dimension where they can be first, only, or clearly superior.',
        l3: 'A distinct position is articulated (segment, workflow, geography, regulation), or a relevant advantage on a material dimension — but replicable by competitors with reasonable effort.',
        l5: '(path A — structurally unique) A position grounded in something structural (tech edge, channel, regulatory head start, unique data) that makes them first or only for a defined buyer.',
        l5b: "(path B — demonstrably superior) A value proposition demonstrably far superior on a dimension CRITICAL to the buyer (win/loss evidence, benchmarks), which competitors can't replicate easily or economically.",
      },
      evidenceHints: ['claim', 'document'],
      why: 'Markets reward "only" and "first" — but also reward "10× better on what matters"; the 5 anchor recognizes both. (v2 revision — two paths to 5, translated from the approved Portuguese brief.)',
    },
    {
      id: 'market.barriers_entry',
      axis: 'market',
      subdimension: 'Competition & Barriers',
      stages: phaseRange('pilot'),
      question: 'What stops the next funded team from taking this market once proven?',
      anchors: {
        l1: 'Nothing: no regulatory, data, network, or switching barrier; success would simply attract faster copies.',
        l3: 'Some friction (certifications underway, early data accumulation, first-mover relationships) but nothing yet binding.',
        l5: 'Real barriers in place or maturing: granted certifications/licenses, accumulating proprietary data, network effects starting to bind, or contracts with switching costs.',
      },
      stageNotes: 'Earlier stages: lighter reading — intentions, not moats.',
      evidenceHints: ['document', 'claim', 'traction_metric'],
      why: 'Value capture depends on what happens AFTER being right.',
    },
    {
      id: 'market.regulatory_environment',
      axis: 'market',
      subdimension: 'Competition & Barriers',
      stages: ALL_PHASES,
      question: 'Does regulation help, block, or ambush this business — and does the team know?',
      anchors: {
        l1: 'Regulated market with no regulatory map: pathway, cost and timeline unknown or waved away.',
        l3: 'Pathway identified with credible cost/timeline, not yet started; or lightly regulated space with monitoring in place.',
        l5: 'Regulation as tailwind or moat: pathway underway/completed, or a regulatory change actively creating the demand they serve.',
      },
      stageNotes: "Materiality varies by sector — for regulated products (health, fintech) this question is central; the platform's sector data flags it.",
      evidenceHints: ['document', 'roadmap_event'],
      why: 'In regulated sectors this is existence-level, not a detail.',
    },
    {
      id: 'market.accessibility',
      axis: 'market',
      subdimension: 'Competition & Barriers',
      stages: ALL_PHASES,
      question: 'Can this startup actually reach and sell to this market?',
      anchors: {
        l1: 'Identifiable buyers but no demonstrated route to reach or transact with them (procurement not mapped, no channel, reimbursement unknown).',
        l3: 'Credible GTM route identified and initial access exists (first channel conversations, first tender, distribution pilot), but channel economics and sales cycles are assumptions.',
        l5: 'Repeatable access demonstrated through evidenced channels: direct sales closing, a partner/distributor with real pipeline, procurement wins, established reimbursement — with known cost and time to access.',
      },
      stageNotes: 'Weight rises in sectors with procurement/reimbursement (health, public).',
      evidenceHints: ['interaction', 'document', 'traction_metric'],
      why: 'A large, growing, urgent market can still be economically or operationally inaccessible — this question converts TAM into Accessible Market. (v2 addition — translated from the approved Portuguese brief.)',
    },
  ],
  redFlags: [
    { id: 'market.rf_declining', axis: 'market', check: 'Segment demand is evidenced as structurally declining.', capLevel: 2 },
    { id: 'market.rf_regulatory_blocker', axis: 'market', check: 'Product legally requires an approval pathway the team has not mapped (cost/timeline unknown).', capLevel: 2 },
    { id: 'market.rf_single_gatekeeper', axis: 'market', check: 'Access to buyers runs through a single gatekeeper (one platform, one payer, one distributor) with no relationship or contract.', capLevel: 3 },
  ],
};
