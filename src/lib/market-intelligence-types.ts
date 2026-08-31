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

// Prompt 479 (decision, Nuno, 30/08) — this vocabulary belongs to the WEB
// path: it lives on market_research_items and is consumed by computeVerdict
// (market-assessment-engine.ts). It is deliberately DISTINCT from the
// validation_status / verification_status pair that market_facts uses for
// the typed document path (Prompt 467, consumed by MarketFactsCard).
//
// The two were not unified, and that is a decision rather than a backlog
// item nobody got to: they already have different consumers in production,
// so consolidating would mean touching the Block 5 verdict engine — which
// works — for a gain that today is only aesthetic.
//
// NOT NORMATIVE for future code that genuinely needs to bridge the two
// paths (the obvious case: web research one day writing directly into
// market_facts). If that arrives, this decision is revisited with the
// concrete case in front of it — never re-argued in the abstract, and
// never treated as a rule nobody knows how to revoke. Closing 477 this way
// exists to stop the question being silently reopened, not to forbid ever
// answering it differently.
export type FactStatus = 'VALIDATED_FACT' | 'PARTIAL_FACT' | 'CONFLICTING_FACT' | 'INSUFFICIENT_FACT';

export type DeltaType =
  | 'VALUE_ABOVE_EVIDENCE' | 'VALUE_BELOW_EVIDENCE' | 'VALUE_SUPPORTED'
  | 'NEW_BUYER' | 'NEW_MARKET' | 'NEW_COMPETITOR' | 'NEW_RISK' | 'NEW_DRIVER'
  | 'NEW_REGULATORY_CONSTRAINT' | 'MISSING_EXPECTED_EVIDENCE'
  | 'SOURCE_CONFLICT' | 'ASSUMPTION_UNSUPPORTED';

// Prompt 493, Decision 1 — Bloco 5 (North Star §8, Milestone D, "Sherlock
// challenges the founder") reuses these four values AS A TYPE, and nothing
// else. Written down before any derivation engine exists, because the
// cheapest moment to decide this is before there is code depending on the
// answer.
//
// WHAT THIS TYPE IS TODAY: the verdict of the WEB RESEARCH path, per
// hypothesis. Computed by computeVerdict() (market-assessment-engine.ts)
// and stored in market_research_items.change_class (migration 0274).
//
// WHAT BLOCO 5 MAY AND MAY NOT DO WITH IT:
//   - MAY reuse the four values (its verdict can be an alias of this type,
//     carrying its own comment explaining that they are the same four
//     answers to a DIFFERENT question);
//   - MUST NOT call computeVerdict() — that function reads a hypothesis and
//     a research run, neither of which Bloco 5 has;
//   - MUST NOT write market_research_items.change_class. A Bloco 5 verdict
//     is about a founder claim versus typed evidence, not about a
//     hypothesis versus a research run. Same column, different proposition.
//
// This is the 477/479 decision being exercised, not overturned. 479 refused
// to unify this vocabulary with the typed facts' validation_status/
// verification_status and wrote "revisita-se quando houver caso concreto".
// Bloco 5 is that concrete case, and the answer it produces is: share the
// VALUES, never the machinery or the storage.
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
//
// PROMPT 493, Decision 3 — THIS TYPE IS UNUSED. Measured 31/08 across src/,
// scripts/ and docs/: the only occurrence of the name FounderDisposition,
// and the only occurrence of 'REJECTED_AS_RELEVANT', is this line. It has
// never been wired to anything.
//
// It is left in place rather than deleted, on purpose, because deleting it
// would remove the evidence of the mistake it caused. North Star invariable
// 4 cites `founderDisposition ≠ sherlockClassification` as a precedent
// "already in production since Prompt 455" — it never was. The citation
// almost certainly traces to principle 1 at the top of this file
// ("factStatus, founderDisposition and sherlockClassification are
// independent states"), which is a design principle written in phase 444,
// not a description of shipped code. "Exists in the file" is not "is in
// production", and this type is the standing example.
//
// THE REAL PRECEDENT, verified in production and the one Bloco 5 must
// generalise when it needs "the founder may disagree but may not
// reclassify":
//   - the value is computed once by classifyCompetitor()
//     (market-competition.ts) and assigned in exactly two places —
//     market-research-structured.ts (web path) and market-document-extract.ts
//     (document path). Both call the classifier; neither accepts a value
//     from the model or the founder;
//   - it is stored inside the `structured` jsonb, and there is NO founder
//     setter for that field anywhere — the rule is enforced by ABSENCE OF A
//     WRITE PATH, not by a permission check;
//   - accepting is gated: research/respond/route.ts returns HTTP 409 when
//     the classification is NOT_COMPETITOR, UNRESOLVED or STATUS_QUO;
//   - rejecting moves `status` to 'rejected' and never touches `structured`;
//   - market-competitor-write.ts fills competitor_type only where it is
//     null, and deliberately never touches `relation` — which IS
//     founder-editable — so the founder-editable and platform-derived
//     fields stay on opposite sides of a line that is drawn in code.
//
// So the pattern to copy is: derive it in one function, give it no setter,
// and gate the transition that would make it consequential. Not this type.
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
