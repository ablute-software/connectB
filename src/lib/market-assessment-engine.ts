// Prompt 446 §B — the Assessment engine: changeClass/deltaType/
// comparisonBaseline/Implication (444 §E) computed by pure functions, at
// the SAME moment a research item is written (research/route.ts §C) —
// never a later pass, never an LLM deciding the verdict. Six principles
// from Prompt 444 (repeated in market-intelligence-types.ts's own header,
// not repeated here) still govern this file.
import type { FactStatus, ChangeClass, DeltaType, ComparisonBaseline, Implication } from './market-intelligence-types';
import type { Section } from './market-research-sections';
import type { StructuredForSection, PlayerStructured } from './market-research-structured';

// ---------------------------------------------------------------------------
// §B.1 — eligibility and materiality.

// Prompt 444's own fixed note for this phase: NOT "validated?" —
// CONFLICTING_FACT is eligible (a conflict between 2 credible sources is
// as valuable as a validated fact). Only INSUFFICIENT_FACT is excluded.
export function evidenceEligibleForInsight(factStatus: FactStatus | null): boolean {
  return factStatus === 'VALIDATED_FACT' || factStatus === 'PARTIAL_FACT' || factStatus === 'CONFLICTING_FACT';
}

// Not all eligible evidence is material to the hypothesis. sizing/growth
// are always material (they feed TAM/SAM/SOM/growth directly). players is
// only material when sherlockClassification is DIRECT/FUNCTIONAL (a real
// threat) OR when there's a source conflict (a disagreement about ANY
// competitor is worth surfacing) — every other classification (BUDGET,
// EMERGING, POTENTIAL_ENTRANT, ADJACENT, STATUS_QUO, NOT_COMPETITOR,
// UNRESOLVED) is not, same threshold as before Prompt 450, just against the
// wider vocabulary. rounds is never material alone in this phase — one
// comparable round in isolation doesn't change the market reading; the
// synthesis that does (median vs the founder's ask) is phase 448. A source
// conflict on rounds stays material — two sources disagreeing about the
// same round is itself information.
export function materialToHypothesis(section: Section, factStatus: FactStatus, structured: StructuredForSection | null): boolean {
  if (factStatus === 'CONFLICTING_FACT') return true;
  if (section === 'sizing' || section === 'growth') return true;
  if (section === 'players') {
    const classification = (structured as PlayerStructured | null)?.sherlockClassification;
    return classification === 'DIRECT' || classification === 'FUNCTIONAL';
  }
  return false; // rounds (non-conflict), trends/regulatory/definition (no structured, never eligible in the first place)
}

// ---------------------------------------------------------------------------
// §B.2 — calculated confidence (never the LLM's own self-report).

// Confidence in the VERDICT, not in the research. CONFLICTING_FACT is
// 'low' — not because the conclusion is weak (we know WITH confidence
// there's a conflict), but because we don't know which value is right;
// changeClass=UNRESOLVED already communicates that, insight_confidence
// describes certainty about THE NUMBER, not about whether the
// disagreement exists.
export function computeInsightConfidence(factStatus: FactStatus): 'high' | 'medium' | 'low' {
  if (factStatus === 'VALIDATED_FACT') return 'high';
  if (factStatus === 'PARTIAL_FACT') return 'medium';
  return 'low'; // CONFLICTING_FACT
}

// ---------------------------------------------------------------------------
// §B.3 — delta for sizing/growth (numeric comparison against the founder).

// Documented starting point, not a sacred constant — same discipline as
// CONFLICT_THRESHOLD_PCT in 445.
export const FOUNDER_DEVIATION_THRESHOLD_PCT = 0.25;

// Compares the found value (evidenceValue) against what the founder
// already declared (founderValue, from org_market_data — may not exist).
// Returns null when the founder declared nothing for this fact type — in
// that case there's no "above/below", there's discovery (see computeVerdict).
export function classifyNumericDelta(founderValue: number | null, evidenceValue: number): DeltaType | null {
  if (founderValue == null) return null;
  const min = Math.min(Math.abs(founderValue), Math.abs(evidenceValue));
  const deviation = min === 0 ? (founderValue === evidenceValue ? 0 : Infinity) : Math.abs(founderValue - evidenceValue) / min;
  if (deviation <= FOUNDER_DEVIATION_THRESHOLD_PCT) return 'VALUE_SUPPORTED';
  return founderValue > evidenceValue ? 'VALUE_ABOVE_EVIDENCE' : 'VALUE_BELOW_EVIDENCE';
}

// ---------------------------------------------------------------------------
// §B.4 — the full per-item verdict.

export interface Verdict {
  changeClass: ChangeClass;
  deltaType: DeltaType | null;
  comparisonBaseline: ComparisonBaseline;
  implication: Implication | null;
  insightConfidence: 'high' | 'medium' | 'low';
  promotedToInsight: boolean;
}

export interface FounderBaseline {
  sizingValueEur: number | null; // org_market_data.market_size_value_eur
  growthPct: number | null; // org_market_data.growth_pct
  knownCompetitorNames: string[]; // org_competitors -> market_companies.name, lowercased
}

// §B — the cascade: eligible? -> material? -> identifiable delta with a
// comparisonBaseline? -> a grounded structured implication? -> INSIGHT.
// Any "no" stops at FINDING; the first "no" (not eligible) gets no verdict
// at all (§A's columns stay null — never written with a guess).
export function computeVerdict(
  section: Section, factStatus: FactStatus, structured: StructuredForSection | null, founder: FounderBaseline,
): Verdict | null {
  if (!evidenceEligibleForInsight(factStatus)) return null;
  const material = materialToHypothesis(section, factStatus, structured);
  const insightConfidence = computeInsightConfidence(factStatus);

  if (factStatus === 'CONFLICTING_FACT') {
    const scope = section === 'sizing' ? ((structured as { scope?: string } | null)?.scope as 'TAM' | 'SAM' | 'SOM' | undefined) ?? 'TAM' : 'GROWTH';
    return {
      changeClass: 'UNRESOLVED', deltaType: 'SOURCE_CONFLICT', comparisonBaseline: 'EXTERNAL_BENCHMARK',
      implication: material ? { code: section === 'sizing' ? 'MARKET_SIZE_UNCERTAINTY' : section === 'growth' ? 'GROWTH_RATE_UNCERTAINTY' : 'COMPETITIVE_LANDSCAPE_UNCERTAINTY', scope: section === 'players' ? 'COMPETITION' : scope, direction: 'RAISES_RISK' } : null,
      insightConfidence, promotedToInsight: material,
    };
  }
  if (!material) return { changeClass: 'DISCOVERED', deltaType: null, comparisonBaseline: 'MARKET_THESIS', implication: null, insightConfidence, promotedToInsight: false };

  if (section === 'sizing' || section === 'growth') {
    const evidenceValue = section === 'sizing' ? (structured as { valueEur?: number } | null)?.valueEur : (structured as { pct?: number } | null)?.pct;
    if (evidenceValue == null) return null;
    const founderValue = section === 'sizing' ? founder.sizingValueEur : founder.growthPct;
    const deltaType = classifyNumericDelta(founderValue, evidenceValue);
    if (deltaType == null) {
      // Founder never declared this number — it's discovery, not deviation.
      return { changeClass: 'DISCOVERED', deltaType: null, comparisonBaseline: 'MARKET_THESIS', implication: null, insightConfidence, promotedToInsight: false };
    }
    const scope = section === 'sizing' ? ((structured as { scope?: 'TAM' | 'SAM' | 'SOM' }).scope ?? 'TAM') : 'GROWTH';
    const changeClass: ChangeClass = deltaType === 'VALUE_SUPPORTED' ? 'CONFIRMED' : 'CHALLENGED';
    const code = deltaType === 'VALUE_SUPPORTED'
      ? (section === 'sizing' ? 'MARKET_SIZE_SUPPORTED' : 'GROWTH_RATE_SUPPORTED')
      : (section === 'sizing' ? `MARKET_SIZE_${deltaType === 'VALUE_ABOVE_EVIDENCE' ? 'ABOVE' : 'BELOW'}_FOUNDER_CLAIM` : `GROWTH_RATE_${deltaType === 'VALUE_ABOVE_EVIDENCE' ? 'ABOVE' : 'BELOW'}_FOUNDER_CLAIM`);
    return {
      changeClass, deltaType, comparisonBaseline: 'FOUNDER_CLAIM',
      implication: { code, scope, direction: 'REVISES_ESTIMATE' },
      insightConfidence, promotedToInsight: true,
    };
  }

  if (section === 'players') {
    const p = structured as PlayerStructured | null;
    if (!p) return null;
    const known = founder.knownCompetitorNames.includes(p.company.trim().toLowerCase());
    if (known) return { changeClass: 'CONFIRMED', deltaType: null, comparisonBaseline: 'FOUNDER_CLAIM', implication: null, insightConfidence, promotedToInsight: false };
    // sherlockClassification is already uppercase (ScoredClassification) —
    // and, by the time we reach here, always DIRECT or FUNCTIONAL: the
    // `!material` branch above already returned for every other value.
    return {
      changeClass: 'DISCOVERED', deltaType: 'NEW_COMPETITOR', comparisonBaseline: 'FOUNDER_CLAIM',
      implication: { code: `${p.sherlockClassification}_COMPETITOR_DISCOVERED`, scope: 'COMPETITION', direction: 'RAISES_RISK' },
      insightConfidence, promotedToInsight: true,
    };
  }

  return null; // rounds, non-conflict: material=false already returned above
}
