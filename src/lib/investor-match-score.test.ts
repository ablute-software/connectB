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

  // Prompt 176 §A — computeMatchScore/overlaps() itself was never the bug
  // (it's a plain string-array intersection, and this file's own earlier
  // tests already used consistent sector strings on both sides). The real
  // bug was the two CALLERS writing incompatible vocabularies:
  // investor-sector-taxonomy.ts's 22 lowercase tags (the investor thesis)
  // vs. sector-taxonomy.ts's 51 Title Case names (the startup round, via
  // SectorPicker.tsx) — zero string overlap, so overlaps() always returned
  // false for real data. Fixed by pointing the investor side at the same
  // sector-taxonomy.ts source (investor-profile/route.ts,
  // InvestorProfilePanel.tsx). This test uses a real value from that shared
  // taxonomy on both sides, exactly as the prompt's own "Disciplina de
  // sempre" asks: an investor mandate and a startup round both declaring
  // 'FinTech & InsurTech' must count the full 35-point sector weight.
  it('counts the full sector weight when both sides use the same canonical taxonomy value', () => {
    const round: StartupRound = { ...ROUND, sectors: ['FinTech & InsurTech'] };
    const thesis: InvestorThesis = {
      sectors: ['FinTech & InsurTech'], stagesInvested: [], geographies: [], instruments: [], ticketMin: null, ticketMax: null,
    };
    const result = computeMatchScore(thesis, round);
    expect(result.reasons).toContain('sector');
    expect(result.score).toBeGreaterThanOrEqual(35);
  });

  // Prompt 200 §C — exclusões são hard filter: curto-circuitam antes de
  // qualquer peso, mesmo quando tudo o resto bate a 100.
  describe('exclusoes de sector', () => {
    const PERFECT: InvestorThesis = {
      sectors: ['health'], stagesInvested: ['pre_seed'], geographies: ['Portugal'],
      instruments: ['equity'], ticketMin: 25000, ticketMax: 100000,
    };

    it('zera um match que seria 100', () => {
      const result = computeMatchScore({ ...PERFECT, exclusionsNotes: 'health' }, ROUND);
      expect(result.score).toBe(0);
      expect(result.reasons).toEqual(['excluded']);
    });

    it('apanha o caso real "food tech" vs "AgriTech & FoodTech"', () => {
      const round: StartupRound = { ...ROUND, sectors: ['AgriTech & FoodTech'] };
      expect(computeMatchScore({ ...PERFECT, exclusionsNotes: 'food tech' }, round).score).toBe(0);
      expect(computeMatchScore({ ...PERFECT, exclusionsNotes: 'foodtech; agritech' }, round).score).toBe(0);
    });

    it('exclusoes ausentes ou irrelevantes nao mexem no score', () => {
      expect(computeMatchScore(PERFECT, ROUND).score).toBe(100);
      expect(computeMatchScore({ ...PERFECT, exclusionsSectors: null, exclusionsNotes: null }, ROUND).score).toBe(100);
      expect(computeMatchScore({ ...PERFECT, exclusionsNotes: 'foodtech' }, ROUND).score).toBe(100);
    });
  });
});
