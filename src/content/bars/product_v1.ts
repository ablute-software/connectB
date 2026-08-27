// Prompt 411 §A.1 — Product axis BARS bank. Faithful transcription of
// bars_banks_market_product_technology_v1/v2_20260827.md.
//
// Translation note (disclose, don't hide) — same as market_v1.ts: questions
// 7 (pmf_market_pull, new), 8 (delivery_repeatability, new) and 10
// (switching_costs, revised) were given in the v2 source as Portuguese
// working notes, not finished English copy. The anchors below are MY
// careful translation of that approved substance — flagged for review.
import type { BarsBank } from '@/lib/bars-types';
import { phaseRange } from '@/lib/bars-types';

export const PRODUCT_V1: BarsBank = {
  axis: 'product',
  version: 'product_v1',
  questions: [
    {
      id: 'product.problem_evidence',
      axis: 'product',
      subdimension: 'Problem & Value',
      stages: phaseRange('concept_idea'),
      question: 'What evidence exists that the target user has this problem — from before this product existed?',
      anchors: {
        l1: "Problem inferred by the founders; no discovery evidence; users haven't described it in their own words.",
        l3: 'Structured discovery happened (interviews, surveys) and users confirm the problem, but evidence of them ACTING on it (workarounds, spend) is thin.',
        l5: 'Users demonstrably act on the problem today: paying for worse alternatives, building workarounds, queuing for a solution (waitlist, inbound).',
      },
      evidenceHints: ['document', 'traction_metric', 'claim'],
      why: 'Problems users act on fund companies; problems users agree with fund surveys.',
    },
    {
      id: 'product.value_delivered',
      axis: 'product',
      subdimension: 'Problem & Value',
      stages: phaseRange('pilot'),
      question: 'What measurable change does the product produce for the people already using it?',
      anchors: {
        l1: 'No measured outcome; value described in features, not deltas.',
        l3: 'Outcome measured in at least one real deployment (time saved, cost cut, revenue added) but small sample or self-reported.',
        l5: 'Outcome measured across deployments with a number a buyer repeats ("cuts X by 40%"), verifiable with the customer.',
      },
      stageNotes: 'Earlier: skip by default.',
      evidenceHints: ['document', 'traction_metric', 'interaction'],
      why: 'The delta is the product; everything else is interface.',
    },
    {
      id: 'product.maturity',
      axis: 'product',
      subdimension: 'Problem & Value',
      stages: phaseRange('concept_idea'),
      question: 'How much of the promised product actually works end-to-end today?',
      anchors: {
        l1: 'Demo-ware: the shown path is hand-held; core promised capability not yet functional.',
        l3: 'Core path works for real users with known gaps documented honestly.',
        l5: 'Product runs in production for its stage: real users on the real thing, failures handled, gaps on a roadmap rather than in the pitch.',
      },
      stageNotes: 'Anchors read against declared company_phase — a 5 at prototype ≠ a 5 at growth.',
      evidenceHints: ['investor_note', 'roadmap_event'],
      why: 'Distance between deck and product is a risk multiplier on everything else.',
    },
    {
      id: 'product.adoption_engagement',
      axis: 'product',
      subdimension: 'Adoption & Retention',
      stages: phaseRange('launch_early_adopters'),
      question: 'How deeply do existing users actually use it?',
      anchors: {
        l1: 'Accounts exist, usage doesn\'t: logins without workflows, pilots stalled at setup.',
        l3: 'A core group uses it regularly for the core job; breadth or frequency still shallow.',
        l5: 'Usage is habitual and expanding (frequency, seats, use cases) without being pushed.',
      },
      stageNotes: 'Pilot: read within pilots.',
      evidenceHints: ['traction_metric', 'document', 'interaction'],
      why: "Engagement is the earliest truth signal money can't fake.",
    },
    {
      id: 'product.retention_stickiness',
      axis: 'product',
      subdimension: 'Adoption & Retention',
      stages: phaseRange('launch_early_adopters'),
      question: 'Do users stay — and what happens when they try to leave?',
      anchors: {
        l1: 'Churn unknown or evidenced high; pilots end without conversion.',
        l3: 'Early cohorts retain acceptably but history is short; churn reasons understood.',
        l5: 'Cohorts visibly flatten (retention curve), pilots convert to paid, and churned users\' reasons are known and addressable.',
      },
      evidenceHints: ['traction_metric', 'interaction'],
      why: 'Retention converts a good product into a business.',
    },
    {
      id: 'product.time_to_value',
      axis: 'product',
      subdimension: 'Adoption & Retention',
      stages: phaseRange('pilot'),
      question: 'How long from "yes" to the user\'s first real value?',
      anchors: {
        l1: 'Weeks/months of setup, integration or behavior change before any value; every onboarding is a project.',
        l3: 'Days; onboarding is repeatable but still assisted.',
        l5: 'First value in one session or self-serve; onboarding cost per customer trending to zero.',
      },
      evidenceHints: ['traction_metric', 'investor_note'],
      why: 'TTV throttles growth more than marketing budgets do.',
    },
    {
      id: 'product.pmf_market_pull',
      axis: 'product',
      subdimension: 'Adoption & Retention',
      stages: phaseRange('launch_early_adopters'),
      question: 'Are customers pulling the product from the company, or is the company still pushing it onto customers?',
      anchors: {
        l1: 'All demand is pushed: every user/customer requires persuasion, incentives, or exceptional founder effort.',
        l3: 'Some organic pull appears — referrals, inbound, expansion, repeat demand — but inconsistent.',
        l5: 'Clear pull: customers actively seek access, refer others, expand usage/spend, sales cycles shorten and conversion improves WITHOUT proportional growth in commercial effort; demand starts to exceed capacity to serve.',
      },
      stageNotes: 'Pilot: weak signals count, read at-stage.',
      evidenceHints: ['traction_metric'],
      why: "Adoption measures whether they use it; pull measures who's doing the pulling — the difference IS product-market fit. (v2 addition, translated from the approved Portuguese brief.)",
    },
    {
      id: 'product.delivery_repeatability',
      axis: 'product',
      subdimension: 'Economics & Defensibility',
      stages: phaseRange('pilot'),
      question: 'How much bespoke work is required to deliver the promised value to each new customer?',
      anchors: {
        l1: 'Every customer is a project: heavy customization, integration and human intervention; a services business presented as software.',
        l3: 'Repeatable core with a significant but standardizable configuration/implementation layer; effort per customer trending down.',
        l5: 'Essentially identical delivery per customer: standardized onboarding, marginal customization, human effort per new customer trending to zero.',
      },
      evidenceHints: ['traction_metric', 'document'],
      why: "Separates software margin from services margin — complements time_to_value (that measures speed on the customer's side; this measures marginal effort on the company's side). (v2 addition, translated from the approved Portuguese brief.)",
    },
    {
      id: 'product.pricing_power',
      axis: 'product',
      subdimension: 'Economics & Defensibility',
      stages: phaseRange('launch_early_adopters'),
      question: 'What evidence exists that the price holds?',
      anchors: {
        l1: 'Free or heavily discounted everywhere; no one has paid list price.',
        l3: 'Real customers pay a real price, with discounting still common or value-price link untested.',
        l5: 'List price paid repeatedly, discounting controlled, and at least one signal of headroom (upsells landing, a price rise absorbed, buyers comparing against a more expensive alternative).',
      },
      stageNotes: 'Earlier: willingness-to-pay tests count.',
      evidenceHints: ['document', 'traction_metric'],
      why: 'Pricing power is market power measured in euros.',
    },
    {
      id: 'product.switching_costs',
      axis: 'product',
      subdimension: 'Economics & Defensibility',
      stages: phaseRange('launch_early_adopters'),
      question: 'Once adopted, why would the customer stay?',
      anchors: {
        l1: 'Nothing accumulates: no data, no embedded workflow; leaving is an afternoon. (Retention, if any, is inertia.)',
        l3: 'Real but low-value friction: integrations, habits, contracts — "annoying to leave", with no accumulated value the customer would actually lose.',
        l5: "Stickiness from accumulated value: data/history that feeds the value itself, learning/personalization, network effects, or ecosystem — the customer stays because staying is worth MORE every month. Pure contractual lock-in never reaches 5.",
      },
      evidenceHints: ['document', 'claim'],
      why: 'Retention bought with friction evaporates at renewal; retention bought with value compounds — the real moat is "valuable to stay", not "expensive to leave". Feeds the Moat aggregate with Technology\'s replicability. (v2 revision, translated from the approved Portuguese brief.)',
    },
  ],
  redFlags: [
    { id: 'product.rf_no_active_usage', axis: 'product', check: 'Launched (per stage) but no evidence of active usage by anyone outside the team.', capLevel: 2 },
    { id: 'product.rf_churn_terminal', axis: 'product', check: 'Evidenced churn at levels incompatible with the model (cohorts empty out).', capLevel: 2 },
    { id: 'product.rf_perpetual_pilot', axis: 'product', check: 'Pilots repeatedly complete "successfully" and never convert — with no identified blocking reason.', capLevel: 3 },
  ],
};
