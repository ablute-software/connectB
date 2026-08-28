// Prompt 428 §D — Berkus Method factor content, both modes together. Same
// spirit as src/content/bars/team_v1.ts: content and version live in one
// file, immutable once published — a future revision is a new file
// (factors_v2.ts), never a silent edit of this one.
//
// Two source documents (Nuno's "Berkus Method — Melhorias" docx =
// Simplified; the "Detailed / Evidence-Guided Version" txt = Detailed),
// two distinct level->% tables, on purpose — Prompt 428's own instruction:
// "cada modo usa a tabela do seu próprio documento-fonte, não uma tabela
// partilhada." Do not unify them.
import type { BarsAxis, EvidenceKind } from '@/lib/bars-types';

export type BerkusFactorKey = 'sound_idea' | 'prototype' | 'team' | 'relationships' | 'sales';

// Simplified — one generic 5-level anchor, reused identically for all five
// factors (docx, table 2). Deliberately has no per-factor descriptors —
// that's exactly what distinguishes it from Detailed below. `pct` is the
// share of the calibrated max; the docx's own "€ illustrative at €500k/
// factor" column is just pct * the default calibration, not separate data.
export interface BerkusSimplifiedAnchor { level: 1 | 2 | 3 | 4 | 5; anchor: string; pct: number }
export const BERKUS_SIMPLIFIED_ANCHORS: BerkusSimplifiedAnchor[] = [
  { level: 1, anchor: 'No meaningful risk reduction', pct: 0 },
  { level: 2, anchor: 'Limited', pct: 25 },
  { level: 3, anchor: 'Moderate', pct: 50 },
  { level: 4, anchor: 'Strong', pct: 75 },
  { level: 5, anchor: 'Substantially de-risked', pct: 100 },
];

// Detailed — level -> % of the calibrated max (txt, secs 5-9). Different
// from the Simplified table above, on purpose (same instruction as above).
export const BERKUS_DETAILED_LEVEL_PCT: Record<0 | 1 | 2 | 3 | 4 | 5, number> = { 0: 0, 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 };

export interface BerkusLevelDescriptor { level: 0 | 1 | 2 | 3 | 4 | 5; anchor: string }

// Level 0 ("no demonstrated risk reduction") is optional and generic
// across every factor (the txt's own single phrase, not a per-factor
// descriptor) — distinct from null (not yet answered) or skipped=true
// (explicit "not enough evidence"), see berkus_factor_answers' own comment.
const LEVEL_0: BerkusLevelDescriptor = { level: 0, anchor: 'No demonstrated risk reduction' };

export interface BerkusFactorContent {
  key: BerkusFactorKey;
  label: string;
  coreQuestion: string;
  // Which BARS axis/axes already compute a Sherlock-context read for this
  // factor — undefined means no axis exists (Relationships/Sales rely on
  // the evidence list alone, no read-only score card).
  barsAxes?: BarsAxis[];
  levels: BerkusLevelDescriptor[]; // Detailed-mode descriptors: L0 optional, L1-L5 required, in order
  evidenceHints: EvidenceKind[];
  note?: string; // per-factor caveat from the source document, shown verbatim
}

export const BERKUS_FACTORS_V1: BerkusFactorContent[] = [
  {
    key: 'sound_idea',
    label: 'Sound idea',
    coreQuestion: 'How much product/opportunity risk has been reduced?',
    barsAxes: ['market', 'product'],
    levels: [
      LEVEL_0,
      { level: 1, anchor: 'Minimal de-risking — Problem/opportunity largely asserted; differentiation unclear; little external evidence.' },
      { level: 2, anchor: 'Limited — Problem supported by some evidence; plausible solution but major assumptions remain.' },
      { level: 3, anchor: 'Moderate — Clear problem, defined target user, credible value proposition and initial market evidence.' },
      { level: 4, anchor: 'Strong — Strong problem evidence, differentiated proposition and convincing validation.' },
      { level: 5, anchor: 'Substantially de-risked — Compelling opportunity supported by strong problem, market and differentiation evidence.' },
    ],
    evidenceHints: ['claim', 'document', 'traction_metric'],
  },
  {
    key: 'prototype',
    label: 'Prototype',
    coreQuestion: 'How much technology/product feasibility risk has been reduced?',
    barsAxes: ['technology'],
    levels: [
      LEVEL_0,
      { level: 1, anchor: 'Concept only; feasibility materially unproven.' },
      { level: 2, anchor: 'Proof of concept exists; important technical assumptions remain unresolved.' },
      { level: 3, anchor: 'Functional prototype demonstrates the core capability.' },
      { level: 4, anchor: 'Validated prototype operating under relevant conditions.' },
      { level: 5, anchor: 'Core product/technology proven under conditions representative of intended commercial use.' },
    ],
    evidenceHints: ['document', 'roadmap_event'],
    note: 'For companies where technology is not a material source of risk, read this as product feasibility rather than forcing a deep-tech assessment.',
  },
  {
    key: 'team',
    label: 'Quality of the team',
    coreQuestion: 'How much execution risk has been reduced by the team?',
    barsAxes: ['team'],
    levels: [
      LEVEL_0,
      { level: 1, anchor: 'Major capability gaps; little evidence of relevant execution ability.' },
      { level: 2, anchor: 'Some relevant capability exists, but material gaps remain.' },
      { level: 3, anchor: 'Credible core team with relevant skills and reasonable complementarity.' },
      { level: 4, anchor: 'Strong founder-opportunity fit, complementary capabilities and demonstrated execution.' },
      { level: 5, anchor: 'Exceptional team for this opportunity, with demonstrated execution, adaptability and ability to attract high-quality talent.' },
    ],
    evidenceHints: ['document', 'interaction'],
  },
  {
    key: 'relationships',
    label: 'Strategic relationships',
    coreQuestion: 'How much market-access and competitive risk has been reduced through strategic relationships?',
    levels: [
      LEVEL_0,
      { level: 1, anchor: 'No material external relationships.' },
      { level: 2, anchor: 'Early conversations or advisors exist, but little demonstrated access or commercial leverage.' },
      { level: 3, anchor: 'Relevant relationships with potential customers, partners, distributors or ecosystem participants.' },
      { level: 4, anchor: 'Material relationships actively reducing go-to-market, credibility or market-entry risk.' },
      { level: 5, anchor: 'Strategic relationships materially accelerate access, distribution, credibility or defensibility.' },
    ],
    evidenceHints: ['document', 'claim', 'interaction'],
    note: 'A "logo/advisor" relationship is not the same as one that genuinely reduces risk or accelerates market access — distinguish the two.',
  },
  {
    key: 'sales',
    label: 'Early sales / rollout',
    coreQuestion: 'How much commercialization risk has been reduced by actual market evidence?',
    levels: [
      LEVEL_0,
      { level: 1, anchor: 'No external rollout or meaningful traction.' },
      { level: 2, anchor: 'Early users/tests exist but there is no meaningful commercial validation.' },
      { level: 3, anchor: 'Pilots, LOIs or initial users demonstrate real market interest.' },
      { level: 4, anchor: 'Strong pilot conversion, early revenue or repeatable commercial evidence.' },
      { level: 5, anchor: 'Clear early traction demonstrates that customers adopt and pay, while the company remains sufficiently early-stage for Berkus to be relevant.' },
    ],
    evidenceHints: ['traction_metric', 'claim', 'document'],
    note: 'If commercial traction matures enough, Berkus itself starts losing relevance relative to other valuation methods.',
  },
];
