// Prompt 466 — "Extraído" não é "compreendido": the phase that doesn't
// exist yet. Today the pipeline jumps straight from raw extraction
// candidates to market_research_items rows — eight candidates becoming
// eight cards. Eight CANDIDATES is normal (that's what a document gives);
// eight ACTIONABLE facts is the bug. This module is the missing middle:
//
//   raw candidates -> semantic grouping/normalization -> typed fact
//   construction -> domain validation -> (467: market_facts)
//
// Pure, deterministic, no I/O, no LLM call (North Star invariable 9: the
// model extracts, the logic decides) — testable in complete isolation from
// persistence, which is exactly the point: this engine is proven correct
// BEFORE anything is written anywhere (467 owns the table, the Evidence
// Layer, legacy handling, and the UI — deliberately kept together so a
// founder never sees new-shape facts next to old-shape cards).
//
// THE CENTRAL RULE, corrected mid-authorship of this very prompt: merge
// only on POSITIVE PROOF of identity, never on absence of distinction.
// Two candidates whose marketDefinition/geography are both null are NOT
// thereby "the same" — null tells you nothing, and building an interval
// out of nulls (an earlier draft of this rule did exactly that, collapsing
// eight ambiguous candidates into one invented 8-9.6% range) fabricates a
// number the source document may never have stated. Unknown ≠ same.
export interface FactValidation {
  status: 'valid' | 'incomplete' | 'invalid';
  missing: string[]; // required fields absent — an epistemic "we don't know"
  errors: string[]; // concrete, deterministic contradictions — "this can't be true"
  flags: string[]; // "looks extreme, worth a human look" — never invalidates by itself
}

// A lone lower_bound ("at least 8% CAGR") is a COMPLETE assertion on its
// own — it is not half of a range that lost its other half. Only an
// `interval` that is missing one of its two extremes is incomplete; without
// this field there is no way to tell the two states apart.
export type EstimateShape = 'point' | 'interval' | 'lower_bound' | 'upper_bound';

export interface SourceRef { documentId: string; page: number | null; quote: string | null }

interface FactBase {
  marketDefinition: string | null;
  geography: string | null;
  estimateShape: EstimateShape;
  value: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  // Deduplicated by (documentId, page, quote) — two READINGS of the same
  // PDF passage are not two independent sources; counting them as such
  // would inflate confidence by repetition.
  sourceRefs: SourceRef[];
  // The extraction history — one entry per raw candidate that fed this
  // fact, NEVER deduplicated. Kept separate from sourceRefs on purpose:
  // evidence answers "what backs this", observationIds answers "how many
  // times did we read it" — an audit trail, not evidence.
  observationIds: string[];
  validation: FactValidation;
  // Prompt 467 v3 (Nuno's review) — true only when groupKeyFor found a
  // REAL (non-null) key for this fact's members: every context field
  // (marketDefinition, geography, metric, period/asOfYear) present and
  // positively matched. False for the singleton fallback (groupCandidates'
  // `singleton:${observationId}` branch) — an ambiguous candidate with
  // missing context that was correctly refused a shared identity here.
  // market-facts-db.ts's computeFactFingerprint MUST branch on this: a
  // fingerprint built only from semantic fields would turn "missing
  // context" into an accidental merge key (two DIFFERENT ambiguous facts
  // whose empty fields look alike are not thereby the same fact) — exactly
  // the invariable-14 violation this whole module exists to prevent, just
  // recreated one layer down, at persistence instead of normalization.
  hasPositiveIdentity: boolean;
}

export interface GrowthFact extends FactBase {
  kind: 'growth';
  metric: 'CAGR' | 'annual' | 'other';
  periodStart: number | null;
  periodEnd: number | null;
}

export interface MarketSizeFact extends FactBase {
  kind: 'size';
  metric: 'TAM' | 'SAM' | 'SOM' | 'category' | 'other';
  currency: string | null;
  asOfYear: number | null;
  methodology: 'bottom_up' | 'external_estimate' | 'other' | null;
}

export type MarketFact = GrowthFact | MarketSizeFact;

// A raw extraction candidate — what §B's widened tool schema can return,
// after market-document-extract.ts's own parsing, PLUS an observationId
// the caller supplies (the row/observation this candidate came from; 467's
// job to wire a real one in, e.g. a market_research_items id). Every
// context field is nullable and OPTIONAL by design: a missing field is
// missing information, never a value to guess at.
interface CandidateBase {
  observationId: string;
  documentId: string;
  page: number | null;
  sourceQuote: string | null;
  marketDefinition: string | null;
  geography: string | null;
  bound: 'point' | 'lower' | 'upper' | null;
}

export interface GrowthCandidate extends CandidateBase {
  kind: 'growth';
  metric: 'CAGR' | 'annual' | 'other' | null;
  pct: number;
  periodStart: number | null;
  periodEnd: number | null;
}

export interface MarketSizeCandidate extends CandidateBase {
  kind: 'size';
  metric: 'TAM' | 'SAM' | 'SOM' | 'category' | 'other' | null;
  value: number;
  currency: string | null;
  asOfYear: number | null;
  methodology: 'bottom_up' | 'external_estimate' | 'other' | null;
}

export type MarketFactCandidate = GrowthCandidate | MarketSizeCandidate;

// Exported for market-facts-db.ts (467 §B) — fingerprinting needs the exact
// same normalization grouping already uses, so two candidates that would
// group together here also fingerprint identically there.
export function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// The one function this whole prompt is about. Returns a group key ONLY
// when every field Rule 1 requires (marketDefinition, geography, metric,
// period) is filled in on THIS candidate — never when any of them is
// null. A null field is not "the same" as another null field; it is proof
// of nothing, so a candidate missing any of them can never be grouped with
// another and becomes its own singleton (Rule 4, the corrected central
// rule of this prompt).
function groupKeyFor(c: MarketFactCandidate): string | null {
  if (!c.marketDefinition || !c.geography || !c.metric) return null;
  if (c.kind === 'growth') {
    if (c.periodStart === null || c.periodEnd === null) return null;
    return JSON.stringify(['growth', normalizeText(c.marketDefinition), normalizeText(c.geography), c.metric, c.periodStart, c.periodEnd]);
  }
  if (c.asOfYear === null) return null;
  return JSON.stringify(['size', normalizeText(c.marketDefinition), normalizeText(c.geography), c.metric, c.asOfYear]);
}

function dedupeSourceRefs(refs: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const r of refs) {
    const key = `${r.documentId} ${r.page ?? ''} ${r.quote ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// Groups candidates that share a real key (positive-proof matches);
// every candidate with no key (groupKeyFor returned null) becomes its own
// singleton group, keyed by its own observationId so it can never
// accidentally collide with another ungrouped candidate. A singleton
// bucket therefore always has exactly one member — the namespacing key is
// unique per candidate — which is what lets buildGrowthFact/
// buildMarketSizeFact safely treat hasPositiveIdentity=false as "this
// fact's sourceRefs are exactly its own evidence, never shared."
function groupCandidates<T extends MarketFactCandidate>(candidates: T[]): { members: T[]; hasPositiveIdentity: boolean }[] {
  const buckets = new Map<string, { members: T[]; hasPositiveIdentity: boolean }>();
  for (const c of candidates) {
    const realKey = groupKeyFor(c);
    const key = realKey ?? `singleton:${c.observationId}`;
    const existing = buckets.get(key);
    if (existing) existing.members.push(c);
    else buckets.set(key, { members: [c], hasPositiveIdentity: realKey !== null });
  }
  return [...buckets.values()];
}

// Shared bound/shape/value construction — identical logic for growth (pct)
// and size (value), parameterized by which numeric field to read.
function buildEstimate(members: MarketFactCandidate[], numOf: (c: MarketFactCandidate) => number): {
  estimateShape: EstimateShape; value: number | null; lowerBound: number | null; upperBound: number | null;
} {
  const lowerTagged = members.filter((m) => m.bound === 'lower');
  const upperTagged = members.filter((m) => m.bound === 'upper');
  const pointTagged = members.filter((m) => m.bound === 'point' || m.bound === null);

  if (lowerTagged.length > 0 && upperTagged.length > 0) {
    return { estimateShape: 'interval', value: null, lowerBound: Math.min(...lowerTagged.map(numOf)), upperBound: Math.max(...upperTagged.map(numOf)) };
  }
  if (lowerTagged.length > 0) {
    return { estimateShape: 'lower_bound', value: null, lowerBound: Math.min(...lowerTagged.map(numOf)), upperBound: null };
  }
  if (upperTagged.length > 0) {
    return { estimateShape: 'upper_bound', value: null, lowerBound: null, upperBound: Math.max(...upperTagged.map(numOf)) };
  }
  // All point (or untagged) readings — the group already shares identical
  // context by construction (or is a singleton), so a single distinct
  // value is the common case; multiple distinct point values in one
  // proven-identical group is a genuine contradiction, not something to
  // silently average — that is exactly what validation (§D) exists to
  // catch, not this construction step.
  return { estimateShape: 'point', value: numOf(pointTagged[0]), lowerBound: null, upperBound: null };
}

const emptyValidation = (): FactValidation => ({ status: 'valid', missing: [], errors: [], flags: [] });

function buildGrowthFact(group: { members: GrowthCandidate[]; hasPositiveIdentity: boolean }): GrowthFact {
  const { members, hasPositiveIdentity } = group;
  const first = members[0];
  const estimate = buildEstimate(members, (c) => (c as GrowthCandidate).pct);
  const missing: string[] = [];
  if (!first.marketDefinition) missing.push('marketDefinition');
  if (!first.geography) missing.push('geography');
  if (first.periodStart === null || first.periodEnd === null) missing.push('period');

  return {
    kind: 'growth',
    marketDefinition: first.marketDefinition, geography: first.geography, metric: first.metric ?? 'other',
    ...estimate,
    periodStart: first.periodStart, periodEnd: first.periodEnd,
    sourceRefs: dedupeSourceRefs(members.map((m) => ({ documentId: m.documentId, page: m.page, quote: m.sourceQuote }))),
    observationIds: members.map((m) => m.observationId),
    validation: { ...emptyValidation(), status: missing.length > 0 ? 'incomplete' : 'valid', missing },
    hasPositiveIdentity,
  };
}

function buildMarketSizeFact(group: { members: MarketSizeCandidate[]; hasPositiveIdentity: boolean }): MarketSizeFact {
  const { members, hasPositiveIdentity } = group;
  const first = members[0];
  const estimate = buildEstimate(members, (c) => (c as MarketSizeCandidate).value);
  const missing: string[] = [];
  if (!first.marketDefinition) missing.push('marketDefinition');
  if (!first.geography) missing.push('geography');
  if (first.asOfYear === null) missing.push('asOfYear');

  return {
    kind: 'size',
    marketDefinition: first.marketDefinition, geography: first.geography, metric: first.metric ?? 'other',
    ...estimate,
    currency: first.currency, asOfYear: first.asOfYear, methodology: first.methodology,
    sourceRefs: dedupeSourceRefs(members.map((m) => ({ documentId: m.documentId, page: m.page, quote: m.sourceQuote }))),
    observationIds: members.map((m) => m.observationId),
    validation: { ...emptyValidation(), status: missing.length > 0 ? 'incomplete' : 'valid', missing },
    hasPositiveIdentity,
  };
}

export function normalizeMarketCandidates(candidates: MarketFactCandidate[]): MarketFact[] {
  const growth = candidates.filter((c): c is GrowthCandidate => c.kind === 'growth');
  const size = candidates.filter((c): c is MarketSizeCandidate => c.kind === 'size');
  return [
    ...groupCandidates(growth).map(buildGrowthFact),
    ...groupCandidates(size).map(buildMarketSizeFact),
  ];
}

// ---------------------------------------------------------------------------
// Prompt 466 §D — domain validators. A SEPARATE pipeline stage from
// construction above (§A's own diagram draws them apart): normalization
// decides SHAPE and MISSING context: fields; validation checks whether the
// numbers that DO exist can possibly be true. Three outcomes that are not
// the same epistemic state (invariable 13, the whole point of this prompt):
// missing information (`incomplete`) is not the same as information that
// contradicts itself (`invalid`), and neither is the same as "unusual but
// possibly real" (`flags`, which never invalidates anything).

function numericIssues(candidates: { label: string; n: number | null }[], minAllowed: number | null): string[] {
  const errors: string[] = [];
  for (const { label, n } of candidates) {
    if (n === null) continue;
    if (Number.isNaN(n)) errors.push(`${label} is NaN`);
    else if (!Number.isFinite(n)) errors.push(`${label} is infinite`);
    else if (minAllowed !== null && n < minAllowed) errors.push(`${label} (${n}) is below the impossible floor of ${minAllowed}`);
  }
  return errors;
}

// An interval that lost one of its two extremes is incomplete; a genuine
// lower_bound/upper_bound estimate is not — it was never meant to have the
// other side. Only 'interval' shapes get checked here.
function boundCompleteness(fact: MarketFact): string[] {
  if (fact.estimateShape !== 'interval') return [];
  const missing: string[] = [];
  if (fact.lowerBound === null) missing.push('lowerBound');
  if (fact.upperBound === null) missing.push('upperBound');
  return missing;
}

function finalize(missing: string[], errors: string[], flags: string[]): FactValidation {
  return { status: errors.length > 0 ? 'invalid' : missing.length > 0 ? 'incomplete' : 'valid', missing, errors, flags };
}

// No arbitrary ceiling for "plausible" growth — a small market can
// genuinely grow faster than 100%/year, and rejecting that would be this
// engine imposing a belief instead of checking a fact. >100% is flagged
// for a human to glance at, never invalidated.
const GROWTH_FLAG_ABOVE_PCT = 100;

export function validateGrowthFact(fact: GrowthFact): GrowthFact {
  const missing = [...fact.validation.missing, ...boundCompleteness(fact)];
  const errors = numericIssues(
    [{ label: 'value', n: fact.value }, { label: 'lowerBound', n: fact.lowerBound }, { label: 'upperBound', n: fact.upperBound }],
    -100, // a percentage decline can't exceed -100% of a non-negative base
  );
  if (fact.lowerBound !== null && fact.upperBound !== null && fact.lowerBound > fact.upperBound) errors.push('lowerBound > upperBound');
  if (fact.periodStart !== null && fact.periodEnd !== null && fact.periodStart > fact.periodEnd) errors.push('periodStart > periodEnd');

  const flags = [...fact.validation.flags];
  for (const n of [fact.value, fact.lowerBound, fact.upperBound]) {
    if (n !== null && Number.isFinite(n) && n > GROWTH_FLAG_ABOVE_PCT) flags.push(`${n}% growth is unusually high — worth a second look, not rejected`);
  }

  return { ...fact, validation: finalize(missing, errors, flags) };
}

export function validateMarketSizeFact(fact: MarketSizeFact, now: Date = new Date()): MarketSizeFact {
  const missing = [...fact.validation.missing, ...boundCompleteness(fact)];
  const errors = numericIssues(
    [{ label: 'value', n: fact.value }, { label: 'lowerBound', n: fact.lowerBound }, { label: 'upperBound', n: fact.upperBound }],
    0, // a market size can't be negative
  );
  if (fact.lowerBound !== null && fact.upperBound !== null && fact.lowerBound > fact.upperBound) errors.push('lowerBound > upperBound');
  if (fact.asOfYear !== null && fact.asOfYear > now.getFullYear()) errors.push(`as_of_year (${fact.asOfYear}) is in the future`);

  return { ...fact, validation: finalize(missing, errors, [...fact.validation.flags]) };
}
