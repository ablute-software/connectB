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

  // Prompt 714 (Fase 0) — "em falta" deixa de ser tratado como crédito total
  // OU zero, consoante o critério; passa a ser excluído da conta (numerador
  // E denominador), com uma marca em reasons/unknownCriteria só quando o
  // investidor tinha mesmo declarado uma preferência nessa dimensão.
  describe('em falta != credito total (Prompt 714)', () => {
    // Investor declares a preference on every one of the five dimensions,
    // and the startup round matches every one of them (same shape as
    // PERFECT/ROUND above) — the baseline every single-field-missing test
    // below starts from.
    const DECLARES_ALL: InvestorThesis = {
      sectors: ['health'], stagesInvested: ['pre_seed'], geographies: ['Portugal'],
      instruments: ['equity'], ticketMin: 25000, ticketMax: 100000,
    };

    it('sector em falta: excluido do score, marcado "sector (unconfirmed)", nao credito nem penalizacao', () => {
      const round: StartupRound = { ...ROUND, sectors: [] };
      const result = computeMatchScore(DECLARES_ALL, round);
      expect(result.unknownCriteria).toEqual(['sector']);
      expect(result.reasons).toEqual(['sector (unconfirmed)', 'stage', 'ticket', 'geography', 'instrument']);
      expect(result.coverage).toBe(65); // 100 - 35 (sector's own weight)
      expect(result.score).toBe(100); // 100% of what's left to evaluate, not 65%
    });

    it('stage em falta: excluido do score, marcado "stage (unconfirmed)"', () => {
      const round: StartupRound = { ...ROUND, stage: null };
      const result = computeMatchScore(DECLARES_ALL, round);
      expect(result.unknownCriteria).toEqual(['stage']);
      expect(result.reasons).toContain('stage (unconfirmed)');
      expect(result.reasons).not.toContain('stage');
      expect(result.coverage).toBe(75); // 100 - 25
      expect(result.score).toBe(100);
    });

    it('ticket em falta apenas quando AMBOS os valores da ronda sao nulos', () => {
      const bothNull: StartupRound = { ...ROUND, roundMinTicketEur: null, roundTargetEur: null };
      const result = computeMatchScore(DECLARES_ALL, bothNull);
      expect(result.unknownCriteria).toEqual(['ticket']);
      expect(result.reasons).toContain('ticket (unconfirmed)');
      expect(result.coverage).toBe(80); // 100 - 20

      // Only one of the two round-size fields set: still evaluable, not missing.
      const onlyMin: StartupRound = { ...ROUND, roundTargetEur: null };
      const evaluated = computeMatchScore(DECLARES_ALL, onlyMin);
      expect(evaluated.unknownCriteria).toEqual([]);
      expect(evaluated.reasons).toContain('ticket');
      expect(evaluated.score).toBe(100);
    });

    it('geografia em falta: excluida do score, marcada "geography (unconfirmed)"', () => {
      const round: StartupRound = { ...ROUND, country: null };
      const result = computeMatchScore(DECLARES_ALL, round);
      expect(result.unknownCriteria).toEqual(['geography']);
      expect(result.reasons).toContain('geography (unconfirmed)');
      expect(result.coverage).toBe(90); // 100 - 10
      expect(result.score).toBe(100);
    });

    it('instrumento em falta: excluido do score, marcado "instrument (unconfirmed)"', () => {
      const round: StartupRound = { ...ROUND, roundInstruments: [] };
      const result = computeMatchScore(DECLARES_ALL, round);
      expect(result.unknownCriteria).toEqual(['instrument']);
      expect(result.reasons).toContain('instrument (unconfirmed)');
      expect(result.coverage).toBe(90); // 100 - 10
      expect(result.score).toBe(100);
    });

    it('combinacao de dois em falta: ambos excluidos, o resto avaliado normalmente', () => {
      const round: StartupRound = { ...ROUND, stage: null, country: null };
      const result = computeMatchScore(DECLARES_ALL, round);
      expect(result.unknownCriteria).toEqual(['stage', 'geography']);
      expect(result.reasons).toEqual(['sector', 'stage (unconfirmed)', 'ticket', 'geography (unconfirmed)', 'instrument']);
      expect(result.coverage).toBe(65); // 100 - 25 (stage) - 10 (geography)
      expect(result.score).toBe(100);
    });

    it('em falta e excluido do DENOMINADOR, nao so do numerador — nao infla o score quando outro criterio falha de verdade', () => {
      // stage is missing (excluded); sector is a KNOWN mismatch (not missing —
      // the startup did fill sectors in, they just don't overlap the thesis).
      const round: StartupRound = { ...ROUND, stage: null, sectors: ['fintech'] };
      const result = computeMatchScore(DECLARES_ALL, round);
      expect(result.unknownCriteria).toEqual(['stage']);
      expect(result.reasons).not.toContain('sector');
      expect(result.reasons).not.toContain('sector (unconfirmed)');
      // evaluable weight = 100 - 25 (stage) = 75; earned = ticket 20 + geography 10 + instrument 10 = 40
      expect(result.coverage).toBe(75);
      expect(result.score).toBe(53);
    });

    it('"por confirmar" so aparece quando o investidor declarou a dimensao — sem declaracao, dado em falta na startup nao e sequer olhado', () => {
      const emptyThesis: InvestorThesis = {
        sectors: [], stagesInvested: [], geographies: [], instruments: [], ticketMin: null, ticketMax: null,
      };
      const roundMissingEverything: StartupRound = {
        sectors: [], stage: null, country: null, roundTargetEur: null, roundMinTicketEur: null, roundInstruments: [],
      };
      const result = computeMatchScore(emptyThesis, roundMissingEverything);
      expect(result.unknownCriteria).toEqual([]);
      expect(result.reasons).toEqual([]);
      expect(result.coverage).toBe(100);
      expect(result.score).toBe(100);
    });
  });
});
