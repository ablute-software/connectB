import { describe, expect, it } from 'vitest';
import { filterCardsByName, highestFitCandidate, uncontactedCandidates, type EvaluationPipelineCard } from './evaluation-startup-discovery';

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

describe('uncontactedCandidates — Prompt 419 §B.3', () => {
  it('includes a card with no relationship and no interaction', () => {
    const card = makeCard({ orgId: '1', name: 'Untouched Co' });
    expect(uncontactedCandidates([card])).toEqual([card]);
  });

  it('excludes a card with an active data-room grant', () => {
    const card = makeCard({ orgId: '1', name: 'Granted Co', viaGrant: true });
    expect(uncontactedCandidates([card])).toEqual([]);
  });

  it('excludes a card with a recorded decision', () => {
    const card = makeCard({ orgId: '1', name: 'Decided Co', viaDecision: true, status: 'interested' });
    expect(uncontactedCandidates([card])).toEqual([]);
  });

  it('excludes a card reached via a My Network referral', () => {
    const card = makeCard({ orgId: '1', name: 'Referred Co', viaReferral: true });
    expect(uncontactedCandidates([card])).toEqual([]);
  });

  it('excludes a passed or interested card even without viaDecision (legacy swipe-only)', () => {
    expect(uncontactedCandidates([makeCard({ orgId: '1', name: 'Passed Co', status: 'passed' })])).toEqual([]);
    expect(uncontactedCandidates([makeCard({ orgId: '2', name: 'Interested Co', status: 'interested' })])).toEqual([]);
  });

  it('excludes an archived card', () => {
    expect(uncontactedCandidates([makeCard({ orgId: '1', name: 'Archived Co', isArchived: true })])).toEqual([]);
  });

  it('excludes a card with an active MatchDeal conversation', () => {
    expect(uncontactedCandidates([makeCard({ orgId: '1', name: 'Chatting Co', hasConversation: true })])).toEqual([]);
  });

  it('excludes a card with a manual interaction-log entry even if nothing else was ever decided', () => {
    expect(uncontactedCandidates([makeCard({ orgId: '1', name: 'Logged Co', hasManualInteractionLog: true })])).toEqual([]);
  });

  it('never widens the set — only ever returns a subset of what was passed in', () => {
    const untouched = makeCard({ orgId: '1', name: 'Untouched Co' });
    const touched = makeCard({ orgId: '2', name: 'Touched Co', viaGrant: true });
    expect(uncontactedCandidates([untouched, touched])).toEqual([untouched]);
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
