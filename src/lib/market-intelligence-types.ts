// Prompt 444 §E — vocabulary shared by all of Market Intelligence (phases
// 444-448+). Types + pure functions only, no network calls, so this is
// importable from any route/test with no side effects. Phases 445-448
// import from HERE — do not redefine any of this downstream.
//
// The rule this vocabulary encodes (Prompt 444's own header, restated so it
// travels with the types): nothing crosses from Market Data to Market
// Intelligence without structured evidence meeting minimum eligibility, an
// explicit delta against an identifiable state of knowledge
// (comparisonBaseline), and a structured implication — code, scope,
// direction — backed by deterministic rules. The LLM never decides the
// verdict, confidence, delta, analytical classification, or promotion to
// Insight; it only translates an already-computed analytical state into
// natural language. An implication describes what the evidence changes
// about the market's understanding and is NOT itself a strategic
// recommendation ("a second buyer expands potential demand" is an allowed
// implication; "the startup should pivot GTM to insurers" is not — that
// stays the founder/investor's own call, never platform-generated).
//
// Six fixed principles, valid from this phase through 444-448+:
// 1. factStatus, founderDisposition and sherlockClassification are
//    independent states — never infer one from another.
// 2. DeltaType can represent a numeric divergence, new information, absent
//    evidence, OR a conflict between sources (SOURCE_CONFLICT) — a
//    CONFLICTING_FACT can produce an Insight as valid as a VALIDATED_FACT.
// 3. Every delta MUST carry a comparisonBaseline.
// 4. Each research run is pinned to a concrete version of the Thesis and
//    the hypotheses it ran against (§D).
// 5. canPromoteToInsight() is deterministic and can return zero insights —
//    scarcity is a quality signal, not a failure.
// 6. The LLM is the expression layer, never the decision layer.

export type FactStatus = 'VALIDATED_FACT' | 'PARTIAL_FACT' | 'CONFLICTING_FACT' | 'INSUFFICIENT_FACT';

export type DeltaType =
  | 'VALUE_ABOVE_EVIDENCE' | 'VALUE_BELOW_EVIDENCE' | 'VALUE_SUPPORTED'
  | 'NEW_BUYER' | 'NEW_MARKET' | 'NEW_COMPETITOR' | 'NEW_RISK' | 'NEW_DRIVER'
  | 'NEW_REGULATORY_CONSTRAINT' | 'MISSING_EXPECTED_EVIDENCE'
  | 'SOURCE_CONFLICT' | 'ASSUMPTION_UNSUPPORTED';

export type ChangeClass = 'CONFIRMED' | 'CHALLENGED' | 'DISCOVERED' | 'UNRESOLVED';

export type ComparisonBaseline =
  | 'FOUNDER_CLAIM' | 'MARKET_THESIS' | 'PREVIOUS_RESEARCH_RUN'
  | 'SHERLOCK_EXPECTATION' | 'EXTERNAL_BENCHMARK';

// Prompt 444 — Nuno's addendum: the verdict is structured, the implication
// is NEVER free-form strategy. implicationCode names WHAT changed;
// implicationScope WHERE that has effect; implicationDirection WHICH WAY.
// The LLM translates this triple into a sentence — it never generates the
// three fields themselves.
export type ImplicationScope = 'TAM' | 'SAM' | 'SOM' | 'GROWTH' | 'BUYER' | 'COMPETITION' | 'GTM' | 'REGULATORY' | 'TIMING';
export type ImplicationDirection = 'EXPANDS_OPTIONS' | 'NARROWS_OPTIONS' | 'RAISES_RISK' | 'LOWERS_RISK' | 'REVISES_ESTIMATE';
export interface Implication {
  code: string; // e.g. 'BUYER_LANDSCAPE_EXPANDS' — closed vocabulary per section, see phase 446
  scope: ImplicationScope;
  direction: ImplicationDirection;
}

// Source — tiers A-D, dedup by origin (phases 445/446 populate this; the
// type lives here because phase 446's Insight Contract references
// SourceRef.tier).
export type SourceTier = 'A' | 'B' | 'C' | 'D';
export interface SourceRef {
  url: string;
  tier: SourceTier;
  publishedAt: string | null;
  originSourceId: string | null; // points at another SourceRef.url when this is a republication — independence dedup
}

// Full Insight Contract (phase 446 implements canPromoteToInsight(); the
// type lives here so every phase shares it).
export interface InsightCandidate {
  hypothesisId: string;
  factStatus: FactStatus;
  confidence: 'high' | 'medium' | 'low';
  founderState: string | null; // what the founder already claimed, if anything
  changeClass: ChangeClass;
  deltaType: DeltaType | null;
  comparisonBaseline: ComparisonBaseline;
  implication: Implication | null;
  sources: SourceRef[];
  researchRunId: string;
  marketThesisVersion: number;
}

// Dual classification — the founder can reject without deleting the fact
// or changing Sherlock's own reading (phase 446/447).
export type FounderDisposition = 'ACCEPTED' | 'REJECTED_AS_RELEVANT' | 'PENDING';

// No logic beyond the types yet — canPromoteToInsight() and the
// deltaType/implication calculators are phase 446 (Assessment engine), not
// this one.
//
// Note for phase 446, fixed here now so it isn't lost: the promotion
// cascade does NOT use bare "validated?" — it uses
// evidenceEligibleForInsight(), because a CONFLICTING_FACT can be eligible
// (principle 2 above). Cascade: evidence eligible? -> material to the
// hypothesis? -> identifiable delta with a comparisonBaseline? -> a
// grounded structured implication? -> INSIGHT. Any "no" stops at FINDING
// (or DATA, at the first step).
