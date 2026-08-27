// Prompt 411 §A.1 — Technology axis BARS bank. Faithful transcription of
// bars_banks_market_product_technology_v1/v2_20260827.md — the most
// heavily revised of the four axes (subdimension split, novelty/
// performance_advantage split, three new questions).
//
// Translation note (disclose, don't hide) — same as market_v1.ts/
// product_v1.ts: questions 1 (novelty, revised half of the old
// nature_of_edge), 2 (performance_advantage, new), 4
// (validation_reproducibility, new) and 7 (remaining_technical_risk, new)
// were given in the v2 source as Portuguese working notes, not finished
// English copy. Translated carefully, flagged for review.
//
// Materiality rule (412's own UI copy, prepared here for reuse — v2's own
// words): "when technology is NOT a material source of advantage (e.g. an
// excellent marketplace on a commodity stack), the whole axis can be
// marked 'Technology: Not material (N/A)' — not a low score, not missing,
// doesn't penalize the overall assessment (that company's strength is
// measured on other axes, e.g. network moat on Product/Market). Honesty
// about the nature of the stack raises Evidence Confidence, never
// Technology's score."
export const TECHNOLOGY_NOT_MATERIAL_EXPLANATION =
  "Mark this when technology isn't a material source of advantage for this company (e.g. an excellent marketplace on a commodity stack) — this never lowers the overall assessment; that strength shows up on other axes instead.";

import type { BarsBank } from '@/lib/bars-types';
import { ALL_PHASES, phaseRange } from '@/lib/bars-types';

export const TECHNOLOGY_V1: BarsBank = {
  axis: 'technology',
  version: 'technology_v1',
  questions: [
    {
      id: 'tech.novelty',
      axis: 'technology',
      subdimension: 'Innovation & Validation',
      stages: ALL_PHASES,
      question: 'How technically novel is the underlying approach?',
      anchors: {
        l1: "Assembly of known components with proprietary configuration (legitimate — but novelty isn't the edge; consider marking the axis N/A if technology isn't material).",
        l3: 'Solid engineering with novel elements in the combination/application, without a genuinely new method.',
        l5: 'A genuinely new method/mechanism/model, evidenced by patents, publications, or expert validation.',
      },
      evidenceHints: ['document', 'claim'],
      why: "Novelty is separated from advantage — one can exist without the other. (v2 split of the old nature_of_edge; translated from the approved Portuguese brief.)",
    },
    {
      id: 'tech.performance_advantage',
      axis: 'technology',
      subdimension: 'Innovation & Validation',
      stages: ALL_PHASES,
      question: 'Does the technology produce a material, evidenced advantage on dimensions customers care about?',
      anchors: {
        l1: 'No verifiable delta vs. alternatives on dimensions the buyer values.',
        l3: 'Delta measured internally on a material dimension (cost, speed, precision, energy, reliability) — not yet confirmed externally.',
        l5: 'Verifiable and confirmable delta (independent benchmark, measured at the customer, or a capability previously impossible) on a dimension the buyer pays for.',
      },
      evidenceHints: ['document', 'traction_metric'],
      why: "Technology that's not very novel can still be extremely effective — and vice versa; the investor needs both readings separately. (v2 addition — the other half of the old nature_of_edge; translated from the approved Portuguese brief.)",
    },
    {
      id: 'tech.maturity_trl',
      axis: 'technology',
      subdimension: 'Innovation & Validation',
      stages: ALL_PHASES,
      question: 'How proven is the core technology at the conditions that matter?',
      anchors: {
        l1: 'Works in demo/lab conditions only; the leap to real conditions is assumed.',
        l3: 'Validated in relevant conditions (real data, real environment) at small scale.',
        l5: 'Operating in production conditions at meaningful scale, with performance measured and stable.',
      },
      stageNotes: 'Anchors read against stage; for science-based products use TRL language.',
      evidenceHints: ['document', 'traction_metric'],
      why: 'The lab-to-field gap is where deeptech timelines go to die.',
    },
    {
      id: 'tech.validation_reproducibility',
      axis: 'technology',
      subdimension: 'Innovation & Validation',
      stages: ALL_PHASES,
      question: 'Have the core technical performance claims been reproduced under relevant conditions?',
      anchors: {
        l1: 'The key claim comes from a single internal test/demonstration.',
        l3: 'Repeated internally under relevant conditions, with documented protocol and results.',
        l5: 'Reproduced independently, externally validated, or repeatedly demonstrated in relevant environments/users.',
      },
      stageNotes: 'Central in biotech/medtech/hardware/deeptech.',
      evidenceHints: ['document', 'traction_metric'],
      why: 'A single successful demonstration is not a reproducible technology — the difference is the whole risk. (v2 addition, translated from the approved Portuguese brief.)',
    },
    {
      id: 'tech.replicability',
      axis: 'technology',
      subdimension: 'Technical Defensibility',
      stages: ALL_PHASES,
      question: 'If a well-funded team started today, how long to replicate the core?',
      anchors: {
        l1: 'Months: public methods, available components, no accumulating advantage.',
        l3: '1–2 years: know-how and integration depth that take real time, but no structural barrier.',
        l5: 'Years or blocked: protected IP, proprietary data the product itself accumulates, or scale-dependent effects that widen with use.',
      },
      evidenceHints: ['document', 'claim'],
      why: 'The honest question behind every "moat" slide. (v2 reclassified into the new Technical Defensibility subdimension; text unchanged from v1.)',
    },
    {
      id: 'tech.ip_position',
      axis: 'technology',
      subdimension: 'Technical Defensibility',
      stages: ALL_PHASES,
      question: 'What is the real state of the intellectual property?',
      anchors: {
        l1: '"Patented" claimed but nothing filed, or filings lapsed, or ownership sits with a founder/university/prior employer — not the company.',
        l3: 'Filings underway with clean company ownership; territories and claims match the business; FTO not yet analyzed.',
        l5: 'Granted or well-progressed patents (or deliberate trade-secret strategy, documented), company-owned, in the territories that matter, with FTO risk assessed.',
      },
      stageNotes: 'Weight rises with how much the edge claims to be IP.',
      evidenceHints: ['document'],
      why: 'IP claims are the most commonly inflated claim in early-stage decks — and the most verifiable.',
    },
    {
      id: 'tech.remaining_technical_risk',
      axis: 'technology',
      subdimension: 'Innovation & Validation',
      stages: ALL_PHASES,
      question: 'What technically must still become true for this to reach commercial deployment?',
      anchors: {
        l1: "The path depends on scientific/technical advances nobody has demonstrated yet (or it's unclear what's missing).",
        l3: "Outstanding problems identified and with precedent (others have already done it); execution risk, not science risk.",
        l5: 'Only known engineering remains: optimization, hardening, scale — no pending technical unlock.',
      },
      evidenceHints: ['roadmap_event', 'document', 'investor_note'],
      why: 'Two companies at the same TRL can have radically different risk profiles — this question is the difference. (v2 addition, translated from the approved Portuguese brief.)',
    },
    {
      id: 'tech.dependencies',
      axis: 'technology',
      subdimension: 'Scalability & Dependencies',
      stages: ALL_PHASES,
      question: 'What breaks if a third party changes terms, price, or access?',
      anchors: {
        l1: 'Core capability is a thin layer on a single external provider (one model API, one platform, one data source) with no contract or fallback.',
        l3: 'Real dependencies exist but are mapped, contracted where critical, with plausible substitutes identified.',
        l5: 'No single external dependency is existential: multi-sourced, contractually protected, or internalized where it counts.',
      },
      evidenceHints: ['document', 'claim'],
      why: 'Platform risk is the quiet killer of thin-layer products.',
    },
    {
      id: 'tech.scalability_economics',
      axis: 'technology',
      subdimension: 'Scalability & Dependencies',
      stages: phaseRange('pilot'),
      question: 'What happens to unit cost and reliability at 10× the load?',
      anchors: {
        l1: 'Scaling is linear-or-worse in cost or humans (each new customer needs hand work); nobody has computed unit economics of the tech.',
        l3: 'Architecture scales in principle; unit costs estimated, not yet observed at scale; some manual steps remain.',
        l5: 'Marginal cost per unit demonstrably falls with volume; manual steps engineered out; reliability holds under real growth.',
      },
      evidenceHints: ['traction_metric', 'document'],
      why: 'Software margins are a claim until the cost curve is shown.',
    },
    {
      id: 'tech.security_compliance',
      axis: 'technology',
      subdimension: 'Scalability & Dependencies',
      stages: phaseRange('pilot'),
      question: 'Is data security and sector compliance built, planned, or ignored?',
      anchors: {
        l1: 'No security posture; sector requirements (GDPR, MDR, ISO, SOC2 as applicable) unknown or dismissed.',
        l3: 'Requirements mapped, basics in place (access control, encryption, DPAs), certifications planned with credible timeline.',
        l5: 'Certifications obtained or audit-ready for what the market requires; security is a sales asset, not a liability.',
      },
      stageNotes: 'Central for health/fin/data-heavy sectors; the sector flags materiality.',
      evidenceHints: ['document'],
      why: 'In regulated sectors compliance is a market-access gate; buyers audit before they buy. Internally decomposes into three natures activated by sector materiality — Security, Data/Privacy, Product Certification/Regulatory — for the report and DD queue to treat each by its own risk, even with one question in the UI (v2 note; text unchanged from v1).',
    },
  ],
  redFlags: [
    { id: 'tech.rf_ip_not_company_owned', axis: 'technology', check: 'Core IP is evidenced as NOT owned by the company (founder, university, prior employer) with no assignment underway.', capLevel: 2 },
    { id: 'tech.rf_single_vendor_core', axis: 'technology', check: 'Core capability depends on one external provider with no contract, fallback, or mitigation.', capLevel: 3 },
    { id: 'tech.rf_required_cert_missing', axis: 'technology', check: 'Sector legally requires a certification/approval for sale that has not been started.', capLevel: 2 },
  ],
};
