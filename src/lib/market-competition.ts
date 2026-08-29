// Prompt 449 — Competition Contract: no candidate is promoted from
// discovered to competitor without evidence tied to a qualifying
// competitive relation. Sector, geography, shared technology, or ecosystem
// proximity are discovery signals, never proof of competition — alone or
// combined. Absence of evidence never becomes evidence of absence: an
// under-researched candidate stays UNRESOLVED, never NOT_COMPETITOR.
//
// Same discipline as market-research-structured.ts: pure, no network, no
// LLM call inside this file. classifyCompetitor is what actually decides —
// the model only ever fills in the 9 facet states (market-data/research/
// route.ts's STRUCTURED_SCHEMA), never the classification itself.
import type { SourceTier } from './market-intelligence-types';

export type MatchState = 'MATCH' | 'PARTIAL' | 'NO_MATCH' | 'UNKNOWN';

export interface FacetEvidence {
  state: MatchState;
  note: string | null;
  sourceUrl: string | null;
}

export interface CompetitiveRelation {
  // Decisive — always requested, always read by classifyCompetitor.
  problemOrJobOverlap: FacetEvidence;
  outcomeOverlap: FacetEvidence;
  substitutability: FacetEvidence;
  userOrBuyerOverlap: FacetEvidence;
  // Always requested (the founder reads it) but does NOT decide — see the
  // rationale on classifyCompetitor below.
  useContextOverlap: FacetEvidence;
  // Secondary — optional in the schema, read when present.
  budgetOverlap?: FacetEvidence;
  // Auxiliary — context only, never read by classifyCompetitor.
  technologyOverlap?: FacetEvidence;
  inputOverlap?: FacetEvidence;
  geographyOverlap?: FacetEvidence;
  channelOverlap?: FacetEvidence;
}

export type CandidateStage = 'commercial' | 'pre_commercial' | 'unknown';

// Prompt 455 — the LLM reports WHAT the candidate IS — never whether it
// counts as "status quo" directly. PROCESS/MANUAL_WORKFLOW/DO_NOTHING are
// the three forms of "not a company, not a product"; only classifyCompetitor
// decides whether that, combined with shared problem+outcome evidence,
// counts as STATUS_QUO for THIS hypothesis.
export type CandidateKind = 'COMPANY' | 'PRODUCT' | 'PROCESS' | 'MANUAL_WORKFLOW' | 'DO_NOTHING' | 'OTHER';

export type CompetitorClassification =
  | 'DIRECT' | 'FUNCTIONAL' | 'BUDGET' | 'STATUS_QUO' | 'EMERGING'
  | 'POTENTIAL_ENTRANT' | 'ADJACENT' | 'NOT_COMPETITOR' | 'UNRESOLVED';

// Every value of CompetitorClassification, STATUS_QUO included, always
// comes from classifyCompetitor — never from free LLM choice. The 6
// values that can actually become an org_competitors row (everything the
// accept-gate in respond/route.ts doesn't reject) are still useful as a
// narrower type at that call site — see market-competitor-write.ts.
export type ScoredClassification = Exclude<CompetitorClassification, 'NOT_COMPETITOR' | 'UNRESOLVED' | 'STATUS_QUO'>;

// Prompt 449 §B — provenance: where a candidate was FOUND is not the same
// as what qualifies its RELATION. A directory or "top N startups" listicle
// is fine for surfacing a name, never for proving a facet. Deterministic
// heuristic, not LLM self-report — a known aggregator domain never counts
// as tier A/B no matter what the model claims about itself. Non-exhaustive
// list, adjustable without touching call sites (same spirit as
// CONFLICT_THRESHOLD_PCT in market-research-structured.ts).
const KNOWN_AGGREGATOR_DOMAINS = new Set([
  'tracxn.com', 'startupill.com', 'lusha.com', 'f6s.com', 'medicalstartups.org',
  'crunchbase.com', 'pitchbook.com', 'similarweb.com', 'owler.com', 'dealroom.co',
]);

export function inferSourceTier(url: string): SourceTier {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (KNOWN_AGGREGATOR_DOMAINS.has(host)) return 'C';
    return 'B'; // not confirmed primary, but not a known generic aggregator either
  } catch {
    return 'D';
  }
}

export function qualifyingSourcesOnly(urls: string[]): string[] {
  return urls.filter((u) => { const t = inferSourceTier(u); return t !== 'C' && t !== 'D'; });
}

// Prompt 449 §C — the deterministic classifier.
type Verdict = 'YES' | 'NO' | 'PARTIAL' | 'UNRESOLVED';

function facetVerdict(e: FacetEvidence): Verdict {
  if (e.state === 'MATCH') return 'YES';
  if (e.state === 'PARTIAL') return 'PARTIAL';
  if (e.state === 'NO_MATCH') return 'NO';
  return 'UNRESOLVED'; // UNKNOWN never silently becomes NO
}

// Why useContextOverlap is requested but never decides: it was tried as the
// tiebreaker between FUNCTIONAL and ADJACENT, but the two motivating
// examples contradict each other — a same-bathroom-context sensor with a
// different analyte (uncertain between FUNCTIONAL/ADJACENT even by eye) vs.
// a wearable respiratory sensor against a wall-mounted one (different
// context, both clearly FUNCTIONAL). No defensible rule exists yet, so it
// stays evidence the founder reads, not a gate. If a clear pattern emerges
// from real production classifications, it can re-enter the function then,
// backed by real cases.
export function classifyCompetitor(r: CompetitiveRelation, candidateStage: CandidateStage, candidateKind: CandidateKind = 'COMPANY'): CompetitorClassification {
  const problem = facetVerdict(r.problemOrJobOverlap);
  const outcome = facetVerdict(r.outcomeOverlap);
  const subst = facetVerdict(r.substitutability);
  const buyerOrUser = facetVerdict(r.userOrBuyerOverlap);
  const budget = r.budgetOverlap ? facetVerdict(r.budgetOverlap) : 'UNRESOLVED';

  // Candidates that are not a company/product: can only resolve to
  // STATUS_QUO, UNRESOLVED, or NOT_COMPETITOR — never DIRECT/FUNCTIONAL/etc,
  // which presuppose a competing product actually existing. Same discipline
  // as 453: NOT_COMPETITOR requires both decisive axes confirmed negative,
  // never just absence of evidence.
  const isIncumbentBehavior = candidateKind === 'PROCESS' || candidateKind === 'MANUAL_WORKFLOW' || candidateKind === 'DO_NOTHING';
  if (isIncumbentBehavior) {
    if (problem === 'UNRESOLVED' || outcome === 'UNRESOLVED') return 'UNRESOLVED';
    if (problem === 'YES' && (outcome === 'YES' || outcome === 'PARTIAL')) return 'STATUS_QUO';
    if (problem === 'NO' && outcome === 'NO') return 'NOT_COMPETITOR';
    return 'UNRESOLVED'; // non-decisive combination (e.g. problem=YES, outcome=NO) — doesn't force a conclusion
  }

  if (problem === 'YES' || problem === 'PARTIAL') {
    if (candidateStage === 'pre_commercial') return 'EMERGING';
    if (outcome === 'UNRESOLVED' || subst === 'UNRESOLVED') return 'UNRESOLVED';
    if (problem === 'YES' && outcome === 'YES' && subst === 'YES' && (buyerOrUser === 'YES' || buyerOrUser === 'PARTIAL')) return 'DIRECT';
    if (outcome !== 'NO' || subst !== 'NO') return 'FUNCTIONAL';
    return 'ADJACENT';
  }
  if (problem === 'UNRESOLVED') {
    if (budget === 'YES' && (outcome === 'YES' || outcome === 'PARTIAL')) return 'BUDGET';
    if (subst === 'YES' || subst === 'PARTIAL') return 'POTENTIAL_ENTRANT';
    return 'UNRESOLVED';
  }
  // problem === 'NO' — verified, confirmed no overlap.
  //
  // Deliberate ordering: budget is always checked before POTENTIAL_ENTRANT
  // in both final branches — a confirmed budget collision is a stronger,
  // more actionable signal than partial substitutability, even when both
  // are present (see fixture 9 in market-competition.test.ts). But shared
  // budget alone is never enough: BUDGET also requires outcome confirmed
  // YES or PARTIAL — a hospital buying a cardiac monitor and a urinalysis
  // device from the same CapEx line doesn't make them budget competitors;
  // that would create a more sophisticated version of the FLUIDINOVA error.
  // technologyOverlap/inputOverlap/geographyOverlap/channelOverlap are
  // never read here — they exist only for the founder to read the full
  // evidence.
  if (budget === 'YES' && (outcome === 'YES' || outcome === 'PARTIAL')) return 'BUDGET';
  if (subst === 'YES' || subst === 'PARTIAL') return 'POTENTIAL_ENTRANT';
  // Prompt 453 — NOT_COMPETITOR is an evidence-backed conclusion, not the
  // default state when no positive competitive relationship was found.
  // When the evidence required to exclude plausible competitive
  // relationships is missing, return UNRESOLVED. Confirming problem alone
  // is not sufficient exclusion evidence — outcome must ALSO be confirmed
  // NO_MATCH (e.g. problem=NO_MATCH with outcome/substitutability/budget
  // all UNKNOWN previously fell through to NOT_COMPETITOR here, treating
  // "didn't find overlap via the other rescue paths either" as if it were
  // "confirmed no overlap" — exactly the inversion UNRESOLVED exists to
  // prevent).
  if (outcome === 'NO') return 'NOT_COMPETITOR';
  return 'UNRESOLVED';
}
