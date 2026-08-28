// Prompt 439 — Sherlock Prep, Phase 1: the coverage engine (no UI). Pure,
// tested. The founder never answers BARS (the 0-5 judgment is the
// investor's) — this measures, per BARS question, whether the startup
// already HAS shareable evidence that would answer it, so the product can
// show what's already done before ever asking for anything (§0's golden
// rule: reduce perceived weight, never add it).
//
// Deliberately conservative (§2's own instruction): on doubt, 'missing'.
// Asking the founder to confirm something is cheap; inventing coverage
// that isn't real is expensive — an investor would eventually find the
// gap this tool claimed didn't exist. No AI/semantic matching in this
// phase — every matcher below is a mechanical, deterministic check.
import { applicableQuestions } from './bars-scoring';
import type { BarsAxis, BarsBank } from './bars-types';
import type { CompanyPhase, ClaimCategory } from './types';
import { TEAM_V1 } from '../content/bars/team_v1';
import { MARKET_V1 } from '../content/bars/market_v1';
import { PRODUCT_V1 } from '../content/bars/product_v1';
import { TECHNOLOGY_V1 } from '../content/bars/technology_v1';

export type PrepState = 'covered' | 'weak' | 'missing';

export type PrepEvidenceSource =
  | 'claim' | 'document' | 'traction' | 'roadmap' | 'people' | 'market' | 'funding' | 'cap_table' | 'clarification';

export interface PrepEvidenceMatch { source: PrepEvidenceSource; id: string; label: string }

export interface PrepQuestionResult {
  questionId: string;
  axis: BarsAxis;
  question: string;
  state: PrepState;
  matches: PrepEvidenceMatch[]; // what already answers it — empty when missing
  whatGreatLooksLike: string; // the bank's own L5 anchor, verbatim (l5b appended with " / " when present)
}

export interface PrepReport {
  perQuestion: PrepQuestionResult[];
  byAxis: Record<BarsAxis, { covered: number; weak: number; missing: number; total: number }>;
  sessions: PrepSession[];
}

// A flat snapshot assembled by the route (§4) — this module never fetches
// anything itself. claims are already filtered to status='accepted' by
// the caller; document_refs is the same composite-evidence signal
// company_claims already carries (migration 0208).
export interface SherlockPrepSources {
  claims: { id: string; category: ClaimCategory; statement: string; evidence_class: number; document_refs: { documentId: string }[] }[];
  documents: { id: string; name: string }[];
  extractions: { documentId: string; documentType: string | null; programs: { label: string }[]; isSigned: boolean | null }[];
  tractionMetrics: { id: string; label: string; value: string }[];
  roadmapMilestones: { id: string; period_year: number; items: string[] }[];
  people: { id: string; full_name: string; title: string | null; is_founder: boolean; bio: string | null }[];
  fundingRounds: { id: string; label: string }[];
  market: { rings: number; competitors: number; trends: number; regulatory: number };
  capTableEntries: { id: string; category: string }[];
  clarifications: { id: string }[];
}

// ---------------------------------------------------------------------------
// Matching primitives (internal composition — exported for direct unit
// testing, not a stable public API). Each returns a Matcher: a function
// from sources to the matches it found (empty = no match). claimsIn
// stamps the categories it checked onto the returned function (and()/or()
// propagate it from their children) so sherlockPrep can read
// row.strong.claimCategories / row.weak.claimCategories straight off the
// table entry for the transversal document_refs rule below, instead of a
// second, hand-maintained category list per question.
type Matcher = ((sources: SherlockPrepSources) => PrepEvidenceMatch[]) & { claimCategories?: ClaimCategory[] };

function dedupeMatches(matches: PrepEvidenceMatch[]): PrepEvidenceMatch[] {
  const seen = new Set<string>();
  const out: PrepEvidenceMatch[] = [];
  for (const m of matches) {
    const key = `${m.source}:${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function claimsIn(cats: ClaimCategory[], opts?: { maxClass?: number; pattern?: RegExp; requireDocumentRefs?: boolean }): Matcher {
  const matcher: Matcher = (sources) => sources.claims
    .filter((c) => cats.includes(c.category))
    .filter((c) => opts?.maxClass == null || c.evidence_class <= opts.maxClass)
    .filter((c) => opts?.pattern == null || opts.pattern.test(c.statement))
    .filter((c) => !opts?.requireDocumentRefs || c.document_refs.length > 0)
    .map((c) => ({ source: 'claim', id: c.id, label: c.statement }));
  matcher.claimCategories = cats;
  return matcher;
}

// Case-insensitive regardless of the pattern's own flags — §1's own
// wording ("case-insensitive") is a property of the match, not something
// every named pattern constant has to remember to opt into.
export function docsNamed(pattern: RegExp): Matcher {
  const ci = new RegExp(pattern.source, pattern.flags.includes('i') ? pattern.flags : `${pattern.flags}i`);
  return (sources) => {
    const typeByDocId = new Map(sources.extractions.map((e) => [e.documentId, e.documentType]));
    return sources.documents
      .filter((d) => {
        if (ci.test(d.name)) return true;
        const type = typeByDocId.get(d.id);
        return type != null && ci.test(type);
      })
      .map((d) => ({ source: 'document', id: d.id, label: d.name }));
  };
}

export function tractionMatching(pattern?: RegExp): Matcher {
  return (sources) => sources.tractionMetrics
    .filter((t) => pattern == null || pattern.test(t.label) || pattern.test(t.value))
    .map((t) => ({ source: 'traction', id: t.id, label: t.label }));
}

export function roadmapAny(): Matcher {
  return (sources) => sources.roadmapMilestones
    .flatMap((m) => m.items
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item.trim().length > 0)
      .map(({ item, i }) => ({ source: 'roadmap' as const, id: `${m.id}:${i}`, label: item })));
}

export function foundersWithBio(): Matcher {
  return (sources) => sources.people
    .filter((p) => p.is_founder && !!p.bio?.trim())
    .map((p) => ({ source: 'people', id: p.id, label: p.full_name }));
}

// Not in §1's own primitives list, but needed verbatim for
// team.complementarity's STRONG cell ("≥2 founders com title distinto") —
// kept local rather than stretching an existing primitive to fit.
function foundersWithDistinctTitles(min: number): Matcher {
  return (sources) => {
    const founders = sources.people.filter((p) => p.is_founder && p.title);
    if (new Set(founders.map((p) => p.title)).size < min) return [];
    return founders.map((p) => ({ source: 'people', id: p.id, label: `${p.full_name} — ${p.title}` }));
  };
}

export function peopleCount(n: number): Matcher {
  return (sources) => sources.people.length >= n
    ? sources.people.map((p) => ({ source: 'people', id: p.id, label: p.full_name }))
    : [];
}

export function marketHas(kind: keyof SherlockPrepSources['market']): Matcher {
  return (sources) => sources.market[kind] > 0
    ? [{ source: 'market', id: kind, label: `${sources.market[kind]} ${kind} on file` }]
    : [];
}

export function capTableAny(): Matcher {
  return (sources) => sources.capTableEntries.map((e) => ({ source: 'cap_table', id: e.id, label: e.category }));
}

export function fundingAny(): Matcher {
  return (sources) => sources.fundingRounds.map((f) => ({ source: 'funding', id: f.id, label: f.label }));
}

export function clarificationsAny(): Matcher {
  return (sources) => sources.clarifications.map((c) => ({ source: 'clarification', id: c.id, label: 'Clarification on file' }));
}

// tech.ip_position's STRONG OR-branch ("extractions com programs") — any
// document whose extraction found a named program/award/certification.
function extractionsWithPrograms(): Matcher {
  return (sources) => sources.extractions
    .filter((e) => e.programs.length > 0)
    .map((e) => ({ source: 'document', id: e.documentId, label: e.programs.map((p) => p.label).join(', ') }));
}

function and(...matchers: Matcher[]): Matcher {
  const matcher: Matcher = (sources) => {
    const results = matchers.map((m) => m(sources));
    return results.some((r) => r.length === 0) ? [] : results.flat();
  };
  matcher.claimCategories = matchers.flatMap((m) => m.claimCategories ?? []);
  return matcher;
}

function or(...matchers: Matcher[]): Matcher {
  const matcher: Matcher = (sources) => matchers.flatMap((m) => m(sources));
  matcher.claimCategories = matchers.flatMap((m) => m.claimCategories ?? []);
  return matcher;
}

const NONE: Matcher = () => [];

// ---------------------------------------------------------------------------
// §2 — named regex constants (never inline in the table below).

// Team
const TEAM_FOUNDER_FIT_DOC = /cv|founder|bio/;
const TEAM_TECHNICAL_DOC = /cv|technical|engineer/;
const TEAM_COMMERCIAL_TRACTION = /sale|revenue|customer|pipeline/;
const TEAM_COMMITMENT_DOC = /employment|vesting|dedication|contract/;
const TEAM_COMMITMENT_FULLTIME_CLAIM = /full.?time|dedica/i;
const TEAM_LEADERSHIP_DOC = /org chart|hiring|team plan/;
const TEAM_GOVERNANCE_DOC = /shareholder|articles|pacto|sha\b/;
const TEAM_KEY_PERSON_DOC = /succession|handbook|process/;

// Market
const MARKET_SIZE_DOC = /market siz|tam|sam|som/;
const MARKET_BUYER_URGENCY_DOC = /survey|interview|loi|letter of intent/;
const MARKET_ACCESSIBILITY_DOC = /go.?to.?market|gtm|channel|distribution/;
const MARKET_REGULATORY_DOC = /mdr|ce mark|regulat|complian|fda/;
const MARKET_BARRIERS_DOC = /patent|wo \d|ip\b/;

// Product
const PRODUCT_PROBLEM_EVIDENCE_DOC = /survey|interview|clinician|study/;
const PRODUCT_MATURITY_DOC = /demo|prototype|mvp|video/;
const PRODUCT_VALUE_DELIVERED_DOC = /pilot|case study|loi/;
const PRODUCT_ADOPTION_TRACTION = /user|usage|active|engag/;
const PRODUCT_RETENTION_TRACTION = /retention|churn|repeat|renewal/;
const PRODUCT_TIME_TO_VALUE_DOC = /onboarding|implementation|pilot plan/;
const PRODUCT_DELIVERY_REPEATABILITY_DOC = /sop|process|implementation/;
const PRODUCT_PRICING_DOC = /pricing|financial model/;
const PRODUCT_SWITCHING_COSTS_DOC = /integration|contract/;

// Technology
const TECH_NOVELTY_DOC = /patent|wo \d|publica|paper/;
const TECH_PERFORMANCE_DOC = /benchmark|validation|results/;
const TECH_MATURITY_TRL_DOC = /prototype|demo|trl|pilot/;
const TECH_VALIDATION_DOC = /publica|peer|study|clinical/;
const TECH_REPLICABILITY_DOC = /patent|trade secret/;
const TECH_IP_POSITION_DOC = /patent|trademark|marca|wo \d|t\d{3,}/;
const TECH_SCALABILITY_DOC = /financial model|unit econ/;
const TECH_DEPENDENCIES_DOC = /supplier|vendor|licen/;
const TECH_SECURITY_DOC = /gdpr|iso|soc.?2|security|data protection/;
const TECH_REMAINING_RISK_DOC = /risk|technical roadmap/;

// ---------------------------------------------------------------------------
// §2 — the question -> matchers table, exactly as specified. Keyed by
// questionId; every applicable BARS question must have a row here (a test
// asserts this against the real banks so the table can't silently drift
// out of sync with them).
const MATCHER_TABLE: Record<string, { strong: Matcher; weak: Matcher }> = {
  // Team
  'team.founder_opportunity_fit': { strong: docsNamed(TEAM_FOUNDER_FIT_DOC), weak: or(foundersWithBio(), claimsIn(['equipa'])) },
  'team.complementarity': { strong: foundersWithDistinctTitles(2), weak: claimsIn(['equipa']) },
  'team.technical_capability': { strong: docsNamed(TEAM_TECHNICAL_DOC), weak: claimsIn(['equipa', 'prova_tecnica']) },
  'team.commercial_capability': { strong: tractionMatching(TEAM_COMMERCIAL_TRACTION), weak: claimsIn(['equipa', 'tracao_gtm']) },
  'team.commitment': { strong: docsNamed(TEAM_COMMITMENT_DOC), weak: claimsIn(['equipa'], { pattern: TEAM_COMMITMENT_FULLTIME_CLAIM }) },
  'team.entrepreneurial_track': { strong: claimsIn(['equipa'], { maxClass: 3, requireDocumentRefs: true }), weak: foundersWithBio() },
  'team.execution_velocity': { strong: and(roadmapAny(), tractionMatching()), weak: roadmapAny() },
  // "sempre via regra transversal" — no dedicated STRONG matcher of its
  // own; reachable only through the document-backed-claim rule below.
  // 'equipa' is the transversal category here (not referenced by either
  // cell otherwise) because every other team question's own claim
  // categories include 'equipa' — the internally consistent reading of
  // "relevant category" for a team-axis question with no C([...]) of its
  // own, not a guess at a category the table doesn't otherwise support.
  'team.learning_adaptability': { strong: and(NONE, claimsIn(['equipa'])), weak: clarificationsAny() },
  'team.leadership_recruiting': { strong: docsNamed(TEAM_LEADERSHIP_DOC), weak: peopleCount(3) },
  'team.governance_readiness': { strong: and(capTableAny(), docsNamed(TEAM_GOVERNANCE_DOC)), weak: capTableAny() },
  'team.key_person_dependency': { strong: docsNamed(TEAM_KEY_PERSON_DOC), weak: peopleCount(2) },

  // Market
  'market.size_credibility': { strong: or(marketHas('rings'), docsNamed(MARKET_SIZE_DOC)), weak: claimsIn(['mercado_timing']) },
  'market.growth_trajectory': { strong: marketHas('trends'), weak: claimsIn(['mercado_timing']) },
  'market.buyer_urgency': { strong: docsNamed(MARKET_BUYER_URGENCY_DOC), weak: claimsIn(['problema']) },
  'market.competitive_intensity': { strong: marketHas('competitors'), weak: claimsIn(['mercado_timing', 'solucao']) },
  'market.differentiation_space': { strong: and(marketHas('competitors'), claimsIn(['solucao'])), weak: claimsIn(['solucao']) },
  'market.timing_why_now': { strong: claimsIn(['mercado_timing'], { requireDocumentRefs: true }), weak: claimsIn(['mercado_timing']) },
  'market.accessibility': { strong: or(docsNamed(MARKET_ACCESSIBILITY_DOC), claimsIn(['tracao_gtm'], { maxClass: 2 })), weak: claimsIn(['tracao_gtm']) },
  'market.regulatory_environment': { strong: or(docsNamed(MARKET_REGULATORY_DOC), marketHas('regulatory')), weak: NONE },
  'market.barriers_entry': { strong: docsNamed(MARKET_BARRIERS_DOC), weak: claimsIn(['solucao', 'prova_tecnica']) },

  // Product
  'product.problem_evidence': { strong: or(docsNamed(PRODUCT_PROBLEM_EVIDENCE_DOC), claimsIn(['problema'], { requireDocumentRefs: true })), weak: claimsIn(['problema']) },
  'product.maturity': { strong: docsNamed(PRODUCT_MATURITY_DOC), weak: claimsIn(['prova_tecnica']) },
  'product.value_delivered': { strong: and(tractionMatching(), docsNamed(PRODUCT_VALUE_DELIVERED_DOC)), weak: claimsIn(['tracao_gtm']) },
  'product.time_to_value': { strong: docsNamed(PRODUCT_TIME_TO_VALUE_DOC), weak: claimsIn(['solucao']) },
  'product.adoption_engagement': { strong: tractionMatching(PRODUCT_ADOPTION_TRACTION), weak: tractionMatching() },
  'product.retention_stickiness': { strong: tractionMatching(PRODUCT_RETENTION_TRACTION), weak: NONE },
  'product.pmf_market_pull': { strong: claimsIn(['tracao_gtm'], { maxClass: 2 }), weak: claimsIn(['tracao_gtm']) },
  'product.delivery_repeatability': { strong: docsNamed(PRODUCT_DELIVERY_REPEATABILITY_DOC), weak: roadmapAny() },
  'product.pricing_power': { strong: docsNamed(PRODUCT_PRICING_DOC), weak: claimsIn(['tracao_gtm']) },
  'product.switching_costs': { strong: docsNamed(PRODUCT_SWITCHING_COSTS_DOC), weak: claimsIn(['solucao']) },

  // Technology
  'tech.novelty': { strong: docsNamed(TECH_NOVELTY_DOC), weak: claimsIn(['prova_tecnica']) },
  'tech.performance_advantage': { strong: docsNamed(TECH_PERFORMANCE_DOC), weak: claimsIn(['prova_tecnica']) },
  'tech.maturity_trl': { strong: docsNamed(TECH_MATURITY_TRL_DOC), weak: claimsIn(['prova_tecnica']) },
  'tech.validation_reproducibility': { strong: docsNamed(TECH_VALIDATION_DOC), weak: NONE },
  'tech.replicability': { strong: docsNamed(TECH_REPLICABILITY_DOC), weak: claimsIn(['prova_tecnica']) },
  'tech.ip_position': { strong: or(docsNamed(TECH_IP_POSITION_DOC), extractionsWithPrograms()), weak: claimsIn(['validacao_externa']) },
  'tech.scalability_economics': { strong: docsNamed(TECH_SCALABILITY_DOC), weak: claimsIn(['solucao']) },
  'tech.dependencies': { strong: docsNamed(TECH_DEPENDENCIES_DOC), weak: claimsIn(['prova_tecnica']) },
  'tech.security_compliance': { strong: docsNamed(TECH_SECURITY_DOC), weak: NONE },
  'tech.remaining_technical_risk': { strong: docsNamed(TECH_REMAINING_RISK_DOC), weak: roadmapAny() },
};

const BANKS: { axis: BarsAxis; bank: BarsBank }[] = [
  { axis: 'team', bank: TEAM_V1 },
  { axis: 'market', bank: MARKET_V1 },
  { axis: 'product', bank: PRODUCT_V1 },
  { axis: 'technology', bank: TECHNOLOGY_V1 },
];
const AXIS_ORDER: BarsAxis[] = BANKS.map((b) => b.axis);

function transversalMatches(sources: SherlockPrepSources, categories: ClaimCategory[]): PrepEvidenceMatch[] {
  if (categories.length === 0) return [];
  const unique = [...new Set(categories)];
  return sources.claims
    .filter((c) => unique.includes(c.category) && c.document_refs.length > 0)
    .map((c) => ({ source: 'claim' as const, id: c.id, label: c.statement }));
}

export function sherlockPrep(sources: SherlockPrepSources, companyPhase: CompanyPhase): PrepReport {
  const perQuestion: PrepQuestionResult[] = [];

  for (const { axis, bank } of BANKS) {
    for (const q of applicableQuestions(bank, companyPhase)) {
      const row = MATCHER_TABLE[q.id];
      const strongMatches = row.strong(sources);
      const weakMatches = row.weak(sources);
      const claimCategories = [...(row.strong.claimCategories ?? []), ...(row.weak.claimCategories ?? [])];
      const transversal = transversalMatches(sources, claimCategories);

      const state: PrepState = strongMatches.length > 0 || transversal.length > 0
        ? 'covered'
        : weakMatches.length > 0 ? 'weak' : 'missing';

      perQuestion.push({
        questionId: q.id,
        axis,
        question: q.question,
        state,
        matches: dedupeMatches([...strongMatches, ...transversal, ...weakMatches]),
        whatGreatLooksLike: q.anchors.l5b ? `${q.anchors.l5} / ${q.anchors.l5b}` : q.anchors.l5,
      });
    }
  }

  const byAxis = {} as PrepReport['byAxis'];
  for (const axis of AXIS_ORDER) {
    const forAxis = perQuestion.filter((r) => r.axis === axis);
    byAxis[axis] = {
      covered: forAxis.filter((r) => r.state === 'covered').length,
      weak: forAxis.filter((r) => r.state === 'weak').length,
      missing: forAxis.filter((r) => r.state === 'missing').length,
      total: forAxis.length,
    };
  }

  return { perQuestion, byAxis, sessions: buildPrepSessions(perQuestion) };
}

// ---------------------------------------------------------------------------
// §3 — dynamic prep sessions ("milestones"): only missing/weak questions
// (missing first within each axis), grouped by axis, never mixing axes
// within one session. A fully-covered startup returns [] — success, not
// an error case.
export interface PrepSession { index: number; axis: BarsAxis; questionIds: string[]; estMinutes: number }

export function buildPrepSessions(perQuestion: PrepQuestionResult[], maxPerSession = 5): PrepSession[] {
  const sessions: PrepSession[] = [];
  for (const axis of AXIS_ORDER) {
    const missing = perQuestion.filter((r) => r.axis === axis && r.state === 'missing').map((r) => r.questionId);
    const weak = perQuestion.filter((r) => r.axis === axis && r.state === 'weak').map((r) => r.questionId);
    const ordered = [...missing, ...weak];
    for (let i = 0; i < ordered.length; i += maxPerSession) {
      const questionIds = ordered.slice(i, i + maxPerSession);
      // ~2 min to find or create one question's evidence when guided —
      // the honest estimate §3 asks for, not a made-up round number.
      sessions.push({ index: sessions.length, axis, questionIds, estMinutes: questionIds.length * 2 });
    }
  }
  return sessions;
}
