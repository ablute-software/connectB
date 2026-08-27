// Prompt 411 §A.1 — Team axis BARS bank. Faithful transcription of
// bars_bank_team_v2_20260827.md (which itself layers its changes onto
// bars_bank_team_v1_20260827.md — both delivered with the prompt). The
// internal content-version label starts at _v1 regardless of the source
// markdown's own v1/v2 review cycle (that numbering tracked the REVIEW,
// not the product) — see that doc's own §"Format specification" note.
// Every anchor below is verbatim English from one of the two source docs;
// none of Team's questions needed translation (unlike some of Market/
// Product/Technology's — see technology_v1.ts's own header for that).
import type { BarsBank } from '@/lib/bars-types';
import { ALL_PHASES, phaseRange } from '@/lib/bars-types';

export const TEAM_V1: BarsBank = {
  axis: 'team',
  version: 'team_v1',
  questions: [
    {
      id: 'team.founder_opportunity_fit',
      axis: 'team',
      subdimension: 'Behaviour',
      stages: ALL_PHASES,
      question: 'What gives the founders privileged understanding of this opportunity?',
      anchors: {
        l1: 'Neither path: no lived connection to the problem AND no exceptional capability advantage; the opportunity was spotted from outside.',
        l3: 'Partial: meaningful professional exposure to the space, or solid (not exceptional) technical/scientific footing in it.',
        l5: '(path A — problem intimacy) A founder personally owned this problem as an operator/sufferer and can name the moment it became unbearable.',
        l5b: '(path B — capability edge) A founder holds exceptional scientific, technical or commercial capability that yields privileged insight into the opportunity (e.g. published/patented research behind the product, rare domain authority).',
      },
      evidenceHints: ['document', 'claim', 'interaction'],
      why: 'Privileged understanding predicts persistence and speed; recognizes both ways of having it (deeptech/biotech/infra teams must not be penalized for not having "lived the problem").',
    },
    {
      id: 'team.commercial_capability',
      axis: 'team',
      subdimension: 'Capability',
      stages: ALL_PHASES,
      question: 'What evidence exists that someone on the team can sell — to this market, at this price point?',
      anchors: {
        l1: 'Nobody on the team has ever carried a sales quota, closed B2B deals, or acquired paying users; selling is assumed, not evidenced.',
        l3: 'One team member has real commercial track record (quota carried, deals closed, channels built) in an adjacent market or different price point.',
        l5: 'A team member has sold comparable products to comparable buyers, and either brings an active network of named prospects or is already converting them (LOIs, pilots, first revenue).',
      },
      stageNotes: 'Launch/growth: read it in current traction, not career history — anchors shift from "has sold" to "is selling this product now".',
      evidenceHints: ['document', 'traction_metric', 'interaction'],
      why: 'The most common early-stage death is commercial, not technical; teams systematically overweight product.',
    },
    {
      id: 'team.technical_capability',
      axis: 'team',
      subdimension: 'Capability',
      stages: ALL_PHASES,
      question: 'Can this team build and evolve the product without depending on outsiders?',
      anchors: {
        l1: 'Core product is built by an agency/freelancers or a single part-time technical person; no in-house ability to iterate.',
        l3: 'In-house technical lead with relevant stack experience; delivery so far is real but slow or narrow; some critical parts outsourced.',
        l5: 'In-house technical founder/lead with a shipped track record in this class of product; the team has demonstrably iterated fast (releases, roadmap milestones hit).',
      },
      stageNotes: 'Concept/prototype: weight "can they build it"; pilot+: weight "is what they built holding up" — look at product evidence, not titles.',
      evidenceHints: ['document', 'roadmap_event', 'claim'],
      why: 'Outsourced cores stall at exactly the moment iteration speed decides survival.',
    },
    {
      id: 'team.execution_velocity',
      axis: 'team',
      subdimension: 'Capability',
      stages: phaseRange('prototype'),
      question: 'When this team commits to something, what evidence shows they actually deliver?',
      anchors: {
        l1: 'Repeated missed milestones; explanations dominate outcomes; little evidence of iteration.',
        l3: 'Has delivered meaningful milestones, though with delays or inconsistent cadence.',
        l5: 'Repeated pattern of setting hard milestones, hitting them, learning fast when assumptions fail, and adjusting without losing momentum.',
      },
      stageNotes: 'Concept: skip by default — nothing delivered yet to observe.',
      evidenceHints: ['roadmap_event', 'traction_metric'],
      why: "Experience ≠ velocity; this measures observed behavior over time, and the platform's own roadmap events make it verifiable rather than claimed.",
    },
    {
      id: 'team.entrepreneurial_track',
      axis: 'team',
      subdimension: 'Capability',
      stages: ALL_PHASES,
      question: 'What have the founders done before that resembles building a company?',
      anchors: {
        l1: 'First venture, no evidence of having built anything end-to-end (a team, a product, a P&L, a community) in any context.',
        l3: 'Built something end-to-end before — a previous startup (even failed, with honest lessons), a business unit, a product line — with verifiable outcomes.',
        l5: 'Prior founder experience with a meaningful outcome (exit, sustained profitability, or a well-understood failure followed by evidence of changed behavior), verifiable beyond their own telling.',
      },
      evidenceHints: ['document', 'claim', 'interaction'],
      why: 'Prior end-to-end building compresses every future learning curve; a well-processed failure often beats an easy small win.',
    },
    {
      id: 'team.complementarity',
      axis: 'team',
      subdimension: 'Configuration',
      stages: ALL_PHASES,
      question: 'Looking at the four competence vectors (product/tech, commercial/GTM, operations/finance, domain), how much is covered by DIFFERENT people?',
      anchors: {
        l1: 'One person claims all vectors, or the team is N copies of the same profile (e.g. three engineers, nobody commercial).',
        l3: 'Two vectors genuinely covered by different senior people; the missing ones are acknowledged with a credible plan (named hire on roadmap, advisor filling in).',
        // v2's own amendment to the 5 anchor: adds "minimal single-person
        // concentration" alongside the v1 anchor's existing "real depth".
        l5: 'Three or four vectors covered by different people, each with real depth — not just coverage on paper — and minimal concentration in a single person; overlaps are minor and the team knows who owns what.',
      },
      evidenceHints: ['claim', 'document', 'roadmap_event'],
      why: 'Complementarity is the mechanism behind "great team"; measuring it by vector beats adjectives. (Roadmap: the structured Team Competence Matrix, Onda 3, will pre-fill this question and key_person_dependency from declared profiles + CV extraction — the question stays, its evidence gets stronger.)',
    },
    {
      id: 'team.key_person_dependency',
      axis: 'team',
      subdimension: 'Configuration',
      stages: ALL_PHASES,
      question: 'If the single most critical person left tomorrow, what would the company still have?',
      anchors: {
        l1: 'One person holds the technology AND the customer relationships AND the vision; their exit ends the company that week.',
        l3: 'Critical knowledge is concentrated in one person, but partly externalized (documentation, a second person ramping, IP formally owned by the company).',
        l5: "No single person's exit is existential: knowledge documented, IP assigned to the company, at least two people deep in each critical area.",
      },
      evidenceHints: ['claim', 'document'],
      why: 'The risk investors most often discover after the term sheet; asking it early is cheap. (Score high = LOW dependency.)',
    },
    {
      id: 'team.commitment',
      axis: 'team',
      subdimension: 'Behaviour',
      stages: ALL_PHASES,
      question: 'What has this team sustainedly chosen to prioritize, and how have they behaved when it got hard?',
      anchors: {
        l1: 'Venture is one option among several: part-time attention, parallel commitments, no visible cost accepted to be here; first adversity produced retreat.',
        l3: "Core founders full-time with real opportunity cost relative to their own situation (left roles, declined offers, restructured life around the company); too early or too smooth to have observed adversity behavior.",
        l5: 'Sustained full-time priority over 6+ months AND observed behavior under adversity: kept building through a setback (lost pilot, failed raise, key departure) with the same or higher cadence.',
      },
      evidenceHints: ['claim', 'interaction', 'roadmap_event'],
      why: 'Measures the choice and the behavior, not the bank account — personal capital invested or below-market salary may appear as optional supporting evidence, but no anchor requires them (ability to work unpaid is wealth, not commitment). Socio-economic bias removed from v1.',
    },
    {
      id: 'team.learning_adaptability',
      axis: 'team',
      subdimension: 'Behaviour',
      stages: ALL_PHASES,
      question: 'When this team receives evidence that contradicts their beliefs, what happens next?',
      anchors: {
        l1: "Contradictory evidence is deflected or reframed; beliefs and behavior don't move; disagreement is treated as attack.",
        l3: 'They acknowledge and update beliefs honestly when pressed, but the behavior change is slow or not yet observable.',
        l5: 'Documented loop: evidence received → belief updated → behavior changed → result observed (e.g. pivoted pricing after pilot data, killed a feature they loved, changed ICP after loss analysis) — including cases where they disagreed with an investor and were right.',
      },
      evidenceHints: ['interaction', 'roadmap_event'],
      why: 'Measures intellectual honesty and learning velocity, not obedience — a founder who disagrees well scores HIGHER than one who just complies.',
    },
    {
      id: 'team.leadership_recruiting',
      axis: 'team',
      subdimension: 'Behaviour',
      stages: phaseRange('prototype'),
      question: 'What evidence exists that this team can attract people better than themselves?',
      anchors: {
        l1: 'No hires or only junior/transactional hires; no evidence anyone senior ever chose to join, advise, or invest their reputation here.',
        l3: 'Has convinced at least one credibly senior person (hire, active advisor, or committed first employee taking below-market cash for equity).',
        l5: 'Repeated pattern: senior people with options chose this team (key hires from good companies, engaged advisors with skin in the game, oversubscribed angels), and retention so far is clean.',
      },
      evidenceHints: ['claim', 'document'],
      why: 'Recruiting gravity is the best externally-visible proxy for leadership. References (evidence enhancers) raise Confidence here especially.',
    },
    {
      id: 'team.governance_readiness',
      axis: 'team',
      subdimension: 'Behaviour',
      stages: phaseRange('pilot'),
      question: "Is the company's structure ready for professional investors?",
      anchors: {
        l1: 'Cap table opaque or problematic (see red flags), no vesting on founder equity, key agreements (IP assignment, founder agreements) missing or verbal.',
        l3: 'Clean cap table and company docs; founder vesting exists or is agreed for the round; IP assigned; minor tidy-ups pending and acknowledged.',
        l5: 'Everything in 3, plus working governance habits: regular investor/advisor updates already happening, data room organized without being asked, decisions documented.',
      },
      stageNotes: 'Concept/prototype: lighter reading — anchors 3/5 relax to "clean intentions and clean docs so far".',
      evidenceHints: ['document', 'interaction'],
      why: 'Governance debt is cheap to detect now and expensive to discover in diligence.',
    },
  ],
  redFlags: [
    { id: 'team.rf_no_fulltime', axis: 'team', check: 'No founder is full-time on the company.', capLevel: 2 },
    {
      id: 'team.rf_incentive_misalignment', axis: 'team',
      check: 'The active team is NOT sufficiently economically incentivised to build the company through the next major value-creation stages. The cap table is evidence for this judgment (e.g. large majority held outside the active team pre-Series A with no vesting/refresh plan), never the risk itself — university spin-outs, venture studios and carve-outs are assessed on the underlying question, not a universal % threshold.',
      capLevel: 2,
    },
    { id: 'team.rf_solo_no_plan', axis: 'team', check: 'Solo founder with no senior complementary person AND no credible plan for one.', capLevel: 3 },
    { id: 'team.rf_conflict', axis: 'team', check: "A founder's parallel commitment (other venture, full-time role) was discovered rather than declared.", capLevel: 2 },
  ],
};
