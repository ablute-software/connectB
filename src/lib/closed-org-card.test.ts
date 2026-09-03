import { describe, expect, it } from 'vitest';
import { isUnavailableCard, projectUnavailableCard, UNAVAILABLE_CARD_KEYS } from './closed-org-card';

// Prompt 556 §C — "the API returns { orgId, name, status, decidedAt,
// unavailable: true } and NO other field". The point of these tests is the
// word "no": a projection that merely renames fields would pass a
// spot-check on five keys, so the whole key set is asserted, exactly.
const fullCard = {
  orgId: 'org-1', name: 'Krohnsty', oneLiner: 'A one-liner nobody should see',
  description: 'Longer description', introProblem: 'problem', introSolution: 'solution',
  sectors: ['fintech'], stage: 'seed', hqCity: 'Lisbon', country: 'Portugal',
  roundTargetEur: 500_000, roundMinTicketEur: 25_000, roundValuationEur: 4_000_000,
  roundValuationBasis: 'pre_money' as const, roundInstruments: ['safe'],
  matchScore: 87, matchReasons: ['sector', 'stage'], status: 'interested',
  passReason: null, decidedAt: '2026-09-01T10:00:00Z', decidedByMe: true,
  trackingCount: 4, hasDataRoomAccess: true, viaGrant: true, viaDecision: true,
  viaReferral: false, referredByName: null, followOnSignals: [], isArchived: false,
  canWithdrawInterest: true, hasConversation: true, hasManualInteractionLog: true,
  hasMiniPitch: true,
};

describe('projectUnavailableCard', () => {
  it('returns exactly the five contracted keys and nothing else', () => {
    const projected = projectUnavailableCard(fullCard);
    expect(Object.keys(projected).sort()).toEqual([...UNAVAILABLE_CARD_KEYS].sort());
  });

  it('keeps the four history fields and marks the card unavailable', () => {
    expect(projectUnavailableCard(fullCard)).toEqual({
      orgId: 'org-1', name: 'Krohnsty', status: 'interested',
      decidedAt: '2026-09-01T10:00:00Z', unavailable: true,
    });
  });

  // Every one of these leaked into the investor's Pipeline for the deleted
  // Krohnsty account before this prompt.
  it.each([
    'oneLiner', 'description', 'introProblem', 'introSolution', 'sectors', 'stage',
    'hqCity', 'country', 'roundTargetEur', 'roundMinTicketEur', 'roundValuationEur',
    'roundValuationBasis', 'roundInstruments', 'matchScore', 'matchReasons', 'passReason',
    'trackingCount', 'hasDataRoomAccess', 'hasConversation', 'followOnSignals', 'hasMiniPitch',
  ])('drops %s', (key) => {
    expect(projectUnavailableCard(fullCard)).not.toHaveProperty(key);
  });

  it('normalises a missing decidedAt to null rather than omitting the key', () => {
    const { decidedAt: _drop, ...noDecision } = fullCard;
    const projected = projectUnavailableCard(noDecision);
    expect(projected.decidedAt).toBeNull();
    expect(Object.keys(projected).sort()).toEqual([...UNAVAILABLE_CARD_KEYS].sort());
  });
});

describe('isUnavailableCard', () => {
  it('narrows only on an explicit unavailable: true', () => {
    expect(isUnavailableCard(projectUnavailableCard(fullCard))).toBe(true);
    expect(isUnavailableCard(fullCard)).toBe(false);
    expect(isUnavailableCard({ orgId: 'x', unavailable: false })).toBe(false);
    expect(isUnavailableCard(null)).toBe(false);
    expect(isUnavailableCard(undefined)).toBe(false);
  });
});
