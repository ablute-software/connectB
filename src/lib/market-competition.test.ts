import { describe, expect, it } from 'vitest';
import {
  classifyCompetitor, inferSourceTier, qualifyingSourcesOnly,
  type CompetitiveRelation, type FacetEvidence, type MatchState, type CandidateStage,
} from './market-competition';

function facet(state: MatchState): FacetEvidence {
  return { state, note: null, sourceUrl: state === 'MATCH' || state === 'PARTIAL' ? 'https://example.com/evidence' : null };
}

// Builds a full CompetitiveRelation from just the states the §D table cares
// about — '—' cells in the table are states that classifyCompetitor never
// reads for that row, filled with UNKNOWN here so the fixture stays valid
// without asserting anything the cascade doesn't itself depend on.
function relation(states: {
  problem: MatchState; outcome?: MatchState; subst?: MatchState; buyerOrUser?: MatchState; budget?: MatchState;
}): CompetitiveRelation {
  return {
    problemOrJobOverlap: facet(states.problem),
    outcomeOverlap: facet(states.outcome ?? 'UNKNOWN'),
    substitutability: facet(states.subst ?? 'UNKNOWN'),
    userOrBuyerOverlap: facet(states.buyerOrUser ?? 'UNKNOWN'),
    useContextOverlap: facet('UNKNOWN'), // never read by classifyCompetitor — see the rationale in market-competition.ts
    budgetOverlap: states.budget ? facet(states.budget) : undefined,
  };
}

const COMMERCIAL: CandidateStage = 'commercial';

// Prompt 449 §D — the 11-case regression table. Names are illustrative of
// the facet pattern, not a verified claim about any real company; domains
// deliberately different from ablute_'s own, since the function is domain-
// agnostic by construction (it only ever reads abstract facet states).
describe('classifyCompetitor', () => {
  it('1 — DIRECT: problem, outcome and substitutability all confirmed', () => {
    const r = relation({ problem: 'MATCH', outcome: 'MATCH', subst: 'MATCH', buyerOrUser: 'PARTIAL' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('DIRECT');
  });

  it('2 — FUNCTIONAL despite zero technology overlap (wall sensor vs. wearable for COPD)', () => {
    const r = relation({ problem: 'MATCH', outcome: 'MATCH', subst: 'PARTIAL', buyerOrUser: 'MATCH' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('FUNCTIONAL');
  });

  it('3 — NOT_COMPETITOR: verified absence, not just missing evidence (the FLUIDINOVA case)', () => {
    const r = relation({ problem: 'NO_MATCH', outcome: 'NO_MATCH', subst: 'NO_MATCH', buyerOrUser: 'NO_MATCH', budget: 'NO_MATCH' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('NOT_COMPETITOR');
  });

  it('4 — UNRESOLVED: obscure candidate, no evidence ever established', () => {
    const r = relation({ problem: 'UNKNOWN', outcome: 'UNKNOWN', subst: 'UNKNOWN', buyerOrUser: 'UNKNOWN', budget: 'UNKNOWN' });
    expect(classifyCompetitor(r, 'unknown')).toBe('UNRESOLVED');
  });

  it('5 — EMERGING: research-stage prototype', () => {
    const r = relation({ problem: 'MATCH', outcome: 'MATCH', subst: 'MATCH' });
    expect(classifyCompetitor(r, 'pre_commercial')).toBe('EMERGING');
  });

  it('6 — BUDGET: confirmed absent problem overlap, same budget line (SaaS scheduling vs. all-in-one suite)', () => {
    const r = relation({ problem: 'NO_MATCH', outcome: 'PARTIAL', subst: 'PARTIAL', budget: 'MATCH' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('BUDGET');
  });

  it('7 — POTENTIAL_ENTRANT: adjacent capability, no shared problem yet', () => {
    const r = relation({ problem: 'NO_MATCH', subst: 'PARTIAL', budget: 'UNKNOWN' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('POTENTIAL_ENTRANT');
  });

  it('8 — ADJACENT: same named problem, outcome and substitutability both confirmed absent', () => {
    const r = relation({ problem: 'MATCH', outcome: 'NO_MATCH', subst: 'NO_MATCH' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('ADJACENT');
  });

  it('9 — BUDGET takes priority over POTENTIAL_ENTRANT when both apply (fintech expense tool vs. accounting suite)', () => {
    const r = relation({ problem: 'NO_MATCH', subst: 'MATCH', budget: 'MATCH' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('BUDGET');
  });

  it('10 — ADJACENT: two-sided marketplace vs. a one-sided directory (shared discovery, not transaction)', () => {
    const r = relation({ problem: 'PARTIAL', outcome: 'NO_MATCH', subst: 'NO_MATCH' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('ADJACENT');
  });

  it('11 — NOT_COMPETITOR stays strict even inside a saturated market of 40 real candidates', () => {
    const r = relation({ problem: 'NO_MATCH', outcome: 'NO_MATCH', subst: 'NO_MATCH', buyerOrUser: 'NO_MATCH', budget: 'NO_MATCH' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('NOT_COMPETITOR');
  });

  // Prompt 453 — fixtures 15 and 16 from that prompt's §B table, numbered
  // to match it directly (12-14/17 don't apply here: they exercise an
  // "isIncumbentBehavior"/candidateKind branch that doesn't exist in this
  // codebase's classifyCompetitor — STATUS_QUO is decided entirely outside
  // this function, by the statusQuoNote branch of PlayerStructured in
  // market-research-structured.ts, before classifyCompetitor is ever
  // called). These two are the ones that actually exercise the fixed
  // branch: confirming problem alone is never enough to conclude
  // NOT_COMPETITOR — outcome must ALSO be confirmed NO_MATCH.
  it('15 — UNRESOLVED: problem confirmed absent, but outcome never investigated (the bug this fix closes)', () => {
    const r = relation({ problem: 'NO_MATCH', outcome: 'UNKNOWN', subst: 'UNKNOWN', budget: 'UNKNOWN' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('UNRESOLVED');
  });

  it('16 — NOT_COMPETITOR: problem AND outcome both confirmed negative, substitutability/budget still unresolved', () => {
    const r = relation({ problem: 'NO_MATCH', outcome: 'NO_MATCH', subst: 'UNKNOWN', budget: 'UNKNOWN' });
    expect(classifyCompetitor(r, COMMERCIAL)).toBe('NOT_COMPETITOR');
  });
});

describe('inferSourceTier', () => {
  it('returns C for a known aggregator domain', () => {
    expect(inferSourceTier('https://tracxn.com/companies/acme')).toBe('C');
    expect(inferSourceTier('https://www.crunchbase.com/organization/acme')).toBe('C');
  });
  it('returns D for an unparseable URL', () => {
    expect(inferSourceTier('not a url')).toBe('D');
  });
  it('returns B for any other domain', () => {
    expect(inferSourceTier('https://acme.com/product')).toBe('B');
  });
});

describe('qualifyingSourcesOnly', () => {
  it('removes tier C and D sources, keeps the rest', () => {
    const urls = ['https://acme.com/product', 'https://tracxn.com/companies/acme', 'not a url', 'https://widgetco.io/about'];
    expect(qualifyingSourcesOnly(urls)).toEqual(['https://acme.com/product', 'https://widgetco.io/about']);
  });
  it('returns an empty array when every source is an aggregator', () => {
    expect(qualifyingSourcesOnly(['https://tracxn.com/x', 'https://crunchbase.com/y'])).toEqual([]);
  });
});
