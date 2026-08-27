// Prompt 411 §C — BARS scoring engine. Pure functions only, same
// discipline as rules.ts's own header comment: used by the API route and
// (once 412 wires it up) the demo store alike, so nothing here reads
// request/session/env state.
import type { BarsAxis, BarsBank, BarsQuestion, EvidenceKind } from './bars-types';
import type { CompanyPhase } from './types';

export interface BarsEvidenceRef {
  kind: EvidenceKind;
  id?: string;
  text?: string;
}

// One investor's stored answer to one question (bars_answers row shape).
// level=null + skipped=false = not yet answered; skipped=true = explicit
// "not enough evidence" — neither ever contributes to score or coverage
// as an answered question.
export interface BarsAnswerRecord {
  questionId: string;
  level: number | null;
  skipped: boolean;
  evidenceRefs: BarsEvidenceRef[];
}

export type BarsFlagState = 'unverified' | 'confirmed' | 'cleared';

// bars_red_flag_states row shape — Confirmed vs. Critical Unverified is
// load-bearing here: only 'confirmed' ever caps a score (computeAxisResult
// below); 'unverified' is a neutral, un-penalizing badge.
export interface BarsFlagStateRecord {
  flagId: string;
  state: BarsFlagState;
}

// bars_axis_state row shape (one row per axis, may not exist yet).
export interface BarsAxisStateRecord {
  notMaterial: boolean;
}

export type ConfidenceBand = 'high' | 'moderate' | 'low';

export interface AxisResult {
  axis: BarsAxis;
  notMaterial: boolean;
  score: number | null; // 1-5, mean of answered levels (capped if a red flag confirms); null = nothing answered yet, never a fabricated average
  subscores: Record<string, number | null>; // by subdimension, same null-if-nothing-answered rule; never capped (the cap is an axis-level ceiling, not a per-subdimension one)
  coverage: number | null; // answered-with-level / applicable; null only if the axis has zero applicable questions at this stage
  confidenceBand: ConfidenceBand | null;
  capApplied?: { flagId: string; capLevel: number }; // present whenever >=1 red flag is 'confirmed', even if it doesn't currently bind the raw score
  answered: number;
  applicable: number;
}

export function applicableQuestions(bank: BarsBank, companyPhase: CompanyPhase): BarsQuestion[] {
  return bank.questions.filter((q) => q.stages.includes(companyPhase));
}

const EVIDENCE_KINDS: EvidenceKind[] = ['claim', 'document', 'traction_metric', 'roadmap_event', 'interaction', 'investor_note'];

// Shared request-body validator for both /api/portal/bars and
// /api/portal/case-risks — same evidence_refs jsonb shape on every table
// that carries one. null = present but malformed (caller should 400);
// [] = absent/empty, both valid.
export function parseEvidenceRefs(input: unknown): BarsEvidenceRef[] | null {
  if (input == null) return [];
  if (!Array.isArray(input)) return null;
  const out: BarsEvidenceRef[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const kind = (item as { kind?: unknown }).kind;
    if (!EVIDENCE_KINDS.includes(kind as EvidenceKind)) return null;
    const id = (item as { id?: unknown }).id;
    const text = (item as { text?: unknown }).text;
    out.push({
      kind: kind as EvidenceKind,
      id: typeof id === 'string' ? id : undefined,
      text: typeof text === 'string' ? text : undefined,
    });
  }
  return out;
}

// Evidence-strength tiers behind confidenceBand() — the full intended
// hierarchy (investor-observed/verified -> primary document -> structured
// founder declaration -> pitch/deck claim -> AI inference) doesn't map
// 1:1 onto the 6 EvidenceKind values bars_answers.evidence_refs actually
// stores (no separate "verified" flag on a claim). Reading: 'interaction'
// (a call/meeting where the investor directly verified something) is the
// tier-1 "claim verified through direct investor interaction" case;
// 'document' is tier 2; 'claim'/'traction_metric'/'roadmap_event' are
// tier 3 (founder-declared, unverified by the investor) per 411 §C.3's
// own explicit grouping. 'investor_note' is 411 §C.3's own stated v1
// simplification — collapsed to tier 3 rather than split
// observed(1)-vs-assumption(4), "até as referências terem tipo próprio".
const EVIDENCE_TIER: Record<EvidenceKind, number> = {
  interaction: 1,
  document: 2,
  claim: 3,
  traction_metric: 3,
  roadmap_event: 3,
  investor_note: 3,
};

// Deterministic tier-mix -> band, thresholds exactly as specified: >=60%
// of answered questions carrying tier<=2 evidence -> high; >=30% ->
// moderate; else low. An answer with no evidence_refs at all counts
// against the strong bucket (nothing to judge strength from). Zero
// answered questions -> 'low': the conservative default when there is no
// evidence to be confident about, never a fabricated middle band.
export function confidenceBand(answers: BarsAnswerRecord[]): ConfidenceBand {
  const answered = answers.filter((a) => !a.skipped && a.level != null);
  if (answered.length === 0) return 'low';
  const strong = answered.filter((a) => {
    if (a.evidenceRefs.length === 0) return false;
    const bestTier = Math.min(...a.evidenceRefs.map((r) => EVIDENCE_TIER[r.kind]));
    return bestTier <= 2;
  }).length;
  const fraction = strong / answered.length;
  if (fraction >= 0.6) return 'high';
  if (fraction >= 0.3) return 'moderate';
  return 'low';
}

export function computeAxisResult(
  bank: BarsBank,
  answers: BarsAnswerRecord[],
  flagStates: BarsFlagStateRecord[],
  axisState: BarsAxisStateRecord | null | undefined,
  companyPhase: CompanyPhase,
): AxisResult {
  // notMaterial=true -> the axis exits the evaluation without penalizing:
  // everything null except the flag itself (411 §C.2's own words).
  if (axisState?.notMaterial) {
    return {
      axis: bank.axis, notMaterial: true, score: null, subscores: {},
      coverage: null, confidenceBand: null, capApplied: undefined,
      answered: 0, applicable: 0,
    };
  }

  const applicable = applicableQuestions(bank, companyPhase);
  const answersById = new Map(answers.map((a) => [a.questionId, a]));

  const isAnswered = (a: BarsAnswerRecord | undefined): a is BarsAnswerRecord =>
    !!a && !a.skipped && a.level != null;

  const answeredRecords = applicable.map((q) => answersById.get(q.id)).filter(isAnswered);

  const mean = (records: BarsAnswerRecord[]): number | null =>
    records.length > 0 ? records.reduce((sum, a) => sum + (a.level as number), 0) / records.length : null;

  const score = mean(answeredRecords);
  const coverage = applicable.length > 0 ? answeredRecords.length / applicable.length : null;

  const subdimensions = Array.from(new Set(applicable.map((q) => q.subdimension)));
  const subscores: Record<string, number | null> = {};
  for (const sub of subdimensions) {
    const subAnswered = applicable
      .filter((q) => q.subdimension === sub)
      .map((q) => answersById.get(q.id))
      .filter(isAnswered);
    subscores[sub] = mean(subAnswered);
  }

  const confirmedIds = new Set(flagStates.filter((f) => f.state === 'confirmed').map((f) => f.flagId));
  const confirmedFlags = bank.redFlags.filter((rf) => confirmedIds.has(rf.id));
  let capApplied: { flagId: string; capLevel: number } | undefined;
  let finalScore = score;
  if (confirmedFlags.length > 0) {
    const minCap = confirmedFlags.reduce((min, rf) => (rf.capLevel < min.capLevel ? rf : min), confirmedFlags[0]);
    capApplied = { flagId: minCap.id, capLevel: minCap.capLevel };
    if (finalScore != null) finalScore = Math.min(finalScore, minCap.capLevel);
  }

  return {
    axis: bank.axis, notMaterial: false, score: finalScore, subscores, coverage,
    confidenceBand: confidenceBand(answeredRecords), capApplied,
    answered: answeredRecords.length, applicable: applicable.length,
  };
}

export interface CrossAxisContradiction {
  ruleId: string;
  question: string;
  involved: string[]; // question ids
}

interface ContradictionRuleDef {
  ruleId: string;
  highQuestionId: string; // must read 5
  lowQuestionId: string; // must read <= lowThreshold
  lowThreshold: number;
  question: string;
}

// 411 §C.4 — the 5-rule seed set from the v2 content doc's own "Regras
// transversais" §3. That doc states each rule by human-readable label
// ("Buyer urgency", "Adoption", "startup traction", ...), not by question
// id — mapping labels to real ids from the 4 banks above is this file's
// own interpretive step, disclosed here:
//   Buyer urgency        -> market.buyer_urgency
//   Adoption              -> product.adoption_engagement
//   Value delivered        -> product.value_delivered
//   Pricing power          -> product.pricing_power
//   Tech performance advantage -> tech.performance_advantage
//   Market differentiation   -> market.differentiation_space
//   Market growth          -> market.growth_trajectory
//   startup traction        -> product.adoption_engagement (same question as
//     "Adoption" above — the closest direct usage/traction signal in the
//     Product bank; the doc uses different English phrasing in rules 1 and
//     4 but no second "traction" question exists to distinguish it from).
//   Retention              -> product.retention_stickiness
//   Switching costs         -> product.switching_costs
const CONTRADICTION_RULES: ContradictionRuleDef[] = [
  {
    ruleId: 'urgency_vs_adoption',
    highQuestionId: 'market.buyer_urgency', lowQuestionId: 'product.adoption_engagement', lowThreshold: 2,
    question: 'If urgency is real, why is adoption weak?',
  },
  {
    ruleId: 'value_vs_pricing',
    highQuestionId: 'product.value_delivered', lowQuestionId: 'product.pricing_power', lowThreshold: 1,
    question: "If value is measurable, why won't customers pay?",
  },
  {
    ruleId: 'tech_advantage_vs_differentiation',
    highQuestionId: 'tech.performance_advantage', lowQuestionId: 'market.differentiation_space', lowThreshold: 2,
    question: 'Does the technical advantage translate into buyer-perceived differentiation?',
  },
  {
    ruleId: 'market_growth_vs_traction',
    highQuestionId: 'market.growth_trajectory', lowQuestionId: 'product.adoption_engagement', lowThreshold: 1,
    question: 'Why is the company underperforming its claimed tailwind?',
  },
  {
    ruleId: 'retention_vs_switching_costs',
    highQuestionId: 'product.retention_stickiness', lowQuestionId: 'product.switching_costs', lowThreshold: 1,
    question: 'Retention is high but switching costs read low — this may be pull (customers stay because they want to, a possible strength), not a contradiction. Worth verifying why they actually stay.',
  },
];

// Question ids are '<prefix>.<name>' but the prefix isn't always the full
// axis name — the approved Technology content (transcribed verbatim,
// "ids exatos" per 411 §A.1) uses the abbreviated 'tech.' prefix while
// BarsAxis's value is 'technology' (e.g. 'tech.performance_advantage').
// Team/Market/Product's prefixes do match their axis name exactly.
const ID_PREFIX_TO_AXIS: Record<string, BarsAxis> = {
  team: 'team', market: 'market', product: 'product', tech: 'technology',
};

// Exported: 412 §C.3 reuses this to suggest a confirmed BARS red flag as
// evidence on its same-named Risk Register category (team.rf_* -> the
// 'team' risk category, etc. — 4 of the Register's 14 categories share a
// BARS axis name, the other 10 don't and never get a suggestion this way).
export function axisOfQuestionId(id: string): BarsAxis {
  const prefix = id.split('.')[0];
  return ID_PREFIX_TO_AXIS[prefix] ?? (prefix as BarsAxis);
}

// Skips a rule if either side's axis is marked not-material — that
// question was never meaningfully in scope, so a contradiction against it
// would be noise, not a real open question.
export function crossAxisContradictions(
  axisResults: Partial<Record<BarsAxis, Pick<AxisResult, 'notMaterial'>>>,
  answersByQuestion: Record<string, number | null | undefined>,
): CrossAxisContradiction[] {
  const out: CrossAxisContradiction[] = [];
  for (const rule of CONTRADICTION_RULES) {
    if (axisResults[axisOfQuestionId(rule.highQuestionId)]?.notMaterial) continue;
    if (axisResults[axisOfQuestionId(rule.lowQuestionId)]?.notMaterial) continue;
    const high = answersByQuestion[rule.highQuestionId];
    const low = answersByQuestion[rule.lowQuestionId];
    if (high === 5 && low != null && low <= rule.lowThreshold) {
      out.push({ ruleId: rule.ruleId, question: rule.question, involved: [rule.highQuestionId, rule.lowQuestionId] });
    }
  }
  return out;
}
