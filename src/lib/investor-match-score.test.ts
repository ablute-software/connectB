import { describe, expect, it } from 'vitest';
import { computeMatchScore, type InvestorThesis, type StartupRound } from './investor-match-score';

const ROUND: StartupRound = {
  sectors: ['health', 'deep tech'],
  stage: 'pre_seed',
  country: 'Portugal',
  roundTargetEur: 1300000,
  roundMinTicketEur: 10000,
  roundInstruments: ['equity', 'safe'],
};

describe('computeMatchScore', () => {
  it('scores 100 for a full match on every dimension', () => {
    const thesis: InvestorThesis = {
      sectors: ['health'], stagesInvested: ['pre_seed'], geographies: ['Portugal'],
      instruments: ['equity'], ticketMin: 25000, ticketMax: 100000,
    };
    const result = computeMatchScore(thesis, ROUND);
    expect(result.score).toBe(100);
    expect(result.reasons).toEqual(['sector', 'stage', 'ticket', 'geography', 'instrument']);
  });

  it('does not penalize blank thesis fields — an empty profile matches everything', () => {
    const thesis: InvestorThesis = {
      sectors: [], stagesInvested: [], geographies: [], instruments: [], ticketMin: null, ticketMax: null,
    };
    expect(computeMatchScore(thesis, ROUND).score).toBe(100);
  });

  it('scores low for a thesis that matches nothing', () => {
    const thesis: InvestorThesis = {
      sectors: ['fintech'], stagesInvested: ['series_a'], geographies: ['Germany'],
      instruments: ['venture_debt'], ticketMin: 2000000, ticketMax: 5000000,
    };
    const result = computeMatchScore(thesis, ROUND);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it('fails ticket plausibility when max is below the round minimum ticket', () => {
    const thesis: InvestorThesis = {
      sectors: [], stagesInvested: [], geographies: [], instruments: [], ticketMin: 1000, ticketMax: 5000,
    };
    const result = computeMatchScore(thesis, ROUND);
    expect(result.reasons).not.toContain('ticket');
    expect(result.score).toBe(80);
  });
});
