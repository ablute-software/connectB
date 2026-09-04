import { describe, expect, it } from 'vitest';
import { EVALUATION_STATE_LABEL, evaluationCardState, filterCardsByName, highestFitCandidate, partitionEvaluationCards, type EvaluationPipelineCard } from './evaluation-startup-discovery';

function makeCard(overrides: Partial<EvaluationPipelineCard> & { orgId: string; name: string }): EvaluationPipelineCard {
  return {
    oneLiner: null, sectors: [], stage: null, roundTargetEur: null, roundValuationEur: null,
    matchScore: 0, matchReasons: [], status: 'open', isArchived: false, hasConversation: false,
    viaGrant: false, viaDecision: false, viaReferral: false, hasManualInteractionLog: false,
    ...overrides,
  };
}

describe('filterCardsByName — Prompt 419 §A', () => {
  const cards = [makeCard({ orgId: '1', name: 'Acme Health' }), makeCard({ orgId: '2', name: 'Balderton Capital' })];

  it('returns every card when the query is empty', () => {
    expect(filterCardsByName(cards, '')).toEqual(cards);
    expect(filterCardsByName(cards, '   ')).toEqual(cards);
  });

  it('filters case-insensitively by substring', () => {
    expect(filterCardsByName(cards, 'acme')).toEqual([cards[0]]);
    expect(filterCardsByName(cards, 'CAPITAL')).toEqual([cards[1]]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterCardsByName(cards, 'zzz')).toEqual([]);
  });
});

// Prompt 562 — these are 419 §B.3's tests, moved onto the partition that
// replaced `uncontactedCandidates`. The `untouched` predicate is unchanged
// (deliberately: what counts as untouched was never the bug), so every case
// below asserts the same fact from the other side — a card that used to be
// EXCLUDED from the candidate list is now INCLUDED in `active`, which is
// what makes it visible instead of merely absent.
describe('partitionEvaluationCards — Prompt 562 (supersedes 419 §B.3)', () => {
  const untouchedCard = () => makeCard({ orgId: '1', name: 'Untouched Co' });

  it('puts a card with no relationship and no interaction in untouched', () => {
    const card = untouchedCard();
    expect(partitionEvaluationCards([card])).toEqual({ active: [], untouched: [card] });
  });

  // Each flag ALONE is enough to make a card active. Before 562 each of
  // these merely dropped out of the discovery list with nothing said.
  it.each([
    ['an active data-room grant', { viaGrant: true }],
    ['a recorded decision', { viaDecision: true, status: 'interested' as const }],
    ['a My Network referral', { viaReferral: true }],
    ['a passed decision (legacy swipe-only)', { status: 'passed' as const }],
    ['an interested decision (legacy swipe-only)', { status: 'interested' as const }],
    ['an archived entry', { isArchived: true }],
    ['a MatchDeal conversation', { hasConversation: true }],
    ['a manual interaction-log entry', { hasManualInteractionLog: true }],
  ])('puts a card with %s in active', (_label, overrides) => {
    const card = makeCard({ orgId: '1', name: 'Touched Co', ...overrides });
    const { active, untouched } = partitionEvaluationCards([card]);
    expect(active).toEqual([card]);
    expect(untouched).toEqual([]);
  });

  it('splits a mixed list without losing or duplicating a card', () => {
    const untouched1 = makeCard({ orgId: '1', name: 'Untouched One' });
    const touched = makeCard({ orgId: '2', name: 'Touched Co', viaGrant: true });
    const untouched2 = makeCard({ orgId: '3', name: 'Untouched Two' });
    const result = partitionEvaluationCards([untouched1, touched, untouched2]);
    expect(result).toEqual({ active: [touched], untouched: [untouched1, untouched2] });
    expect(result.active.length + result.untouched.length).toBe(3);
  });

  // Cards arrive sorted by matchScore descending; "highest fit first" in the
  // Not-yet-contacted group depends entirely on that order surviving.
  it('preserves the incoming order inside each group', () => {
    const cards = [
      makeCard({ orgId: 'a', name: 'A', matchScore: 90 }),
      makeCard({ orgId: 'b', name: 'B', matchScore: 80, viaGrant: true }),
      makeCard({ orgId: 'c', name: 'C', matchScore: 70 }),
      makeCard({ orgId: 'd', name: 'D', matchScore: 60, hasConversation: true }),
    ];
    const { active, untouched } = partitionEvaluationCards(cards);
    expect(untouched.map((c) => c.orgId)).toEqual(['a', 'c']);
    expect(active.map((c) => c.orgId)).toEqual(['b', 'd']);
  });

  it('handles an empty list', () => {
    expect(partitionEvaluationCards([])).toEqual({ active: [], untouched: [] });
  });
});

// Prompt 562 — ONE label per card. A real card carries several flags at
// once (grant AND decision AND conversation is the normal shape of a live
// relationship), so the precedence has to be decided rather than falling out
// of whichever branch is written first.
describe('evaluationCardState — one label per card', () => {
  it('returns null for an untouched card', () => {
    expect(evaluationCardState(makeCard({ orgId: '1', name: 'Untouched' }))).toBeNull();
  });

  it('ranks a data-room grant above everything else', () => {
    const card = makeCard({
      orgId: '1', name: 'All flags', viaGrant: true, viaDecision: true, viaReferral: true,
      hasConversation: true, hasManualInteractionLog: true, status: 'interested',
    });
    expect(evaluationCardState(card)).toBe('shared_documents');
    expect(EVALUATION_STATE_LABEL[evaluationCardState(card)!]).toBe('Shared documents with you');
  });

  it('ranks a conversation above the decision that started it', () => {
    expect(evaluationCardState(makeCard({
      orgId: '1', name: 'Talking', hasConversation: true, viaDecision: true, status: 'interested',
    }))).toBe('in_conversation');
  });

  it('ranks a decision above a referral, and a referral above a bare log entry', () => {
    expect(evaluationCardState(makeCard({ orgId: '1', name: 'X', status: 'interested', viaReferral: true }))).toBe('interested');
    expect(evaluationCardState(makeCard({ orgId: '2', name: 'Y', viaReferral: true, hasManualInteractionLog: true }))).toBe('referred');
    expect(evaluationCardState(makeCard({ orgId: '3', name: 'Z', hasManualInteractionLog: true }))).toBe('logged');
  });

  // A passed startup stays selectable and stays labelled: the tools exist to
  // reconsider, and hiding the case you most want to re-examine would be the
  // opposite of useful.
  it('labels a passed card rather than dropping it', () => {
    const card = makeCard({ orgId: '1', name: 'Passed Co', status: 'passed', viaDecision: true });
    expect(evaluationCardState(card)).toBe('passed');
    expect(partitionEvaluationCards([card]).active).toEqual([card]);
  });

  it('has a label for every state it can return', () => {
    const states = ['shared_documents', 'in_conversation', 'interested', 'passed', 'referred', 'logged', 'archived'] as const;
    for (const state of states) expect(EVALUATION_STATE_LABEL[state]).toBeTruthy();
    expect(Object.keys(EVALUATION_STATE_LABEL).sort()).toEqual([...states].sort());
  });
});

describe('highestFitCandidate — Prompt 419 §C.1', () => {
  it('returns null for an empty list', () => {
    expect(highestFitCandidate([])).toBeNull();
  });

  it('returns the single card when there is only one', () => {
    const card = makeCard({ orgId: '1', name: 'Solo Co', matchScore: 42 });
    expect(highestFitCandidate([card])).toBe(card);
  });

  it('returns the card with the highest matchScore regardless of array order', () => {
    const low = makeCard({ orgId: '1', name: 'Low Fit', matchScore: 20 });
    const high = makeCard({ orgId: '2', name: 'High Fit', matchScore: 90 });
    const mid = makeCard({ orgId: '3', name: 'Mid Fit', matchScore: 55 });
    expect(highestFitCandidate([low, high, mid])).toBe(high);
    expect(highestFitCandidate([high, low, mid])).toBe(high);
  });
});
