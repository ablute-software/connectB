// Prompt 220 §D — o split founder-only entre fraquezas do negócio e
// diagnóstico de execução de angariação. As duas frases literais que
// fugiram em produção (211) são os casos de teste canónicos: têm de ir
// SEMPRE para a secção de execução.
import { describe, expect, it } from 'vitest';
import { isFundraisingExecution, splitFundraisingExecution } from './founder-report-split';

const LEAKED_PASS_RATE = 'High pass rate: 42 total passes across the pipeline suggests pitch or readiness issues';
const LEAKED_CONTACTED = 'Limited investor engagement: only 116 of 759 investors contacted (15%)';

describe('isFundraisingExecution', () => {
  it('routes the two literal 211 leak phrases to execution', () => {
    expect(isFundraisingExecution(LEAKED_PASS_RATE)).toBe(true);
    expect(isFundraisingExecution(LEAKED_CONTACTED)).toBe(true);
  });

  it('catches funnel terms even without numbers (term-only list)', () => {
    expect(isFundraisingExecution('Low outreach velocity in recent weeks')).toBe(true);
    expect(isFundraisingExecution('Pipeline concentration on a single lead investor')).toBe(true);
    expect(isFundraisingExecution('Weak response rate to cold approaches')).toBe(true);
  });

  it('catches number+term combinations via the shared 211 detector', () => {
    expect(isFundraisingExecution('€100k soft-circled — 8% of the round')).toBe(true);
    expect(isFundraisingExecution('3 passes in the same category this month')).toBe(true);
  });

  it('leaves business weaknesses alone, including ones with numbers', () => {
    expect(isFundraisingExecution('Team of 3 with no dedicated sales hire')).toBe(false);
    expect(isFundraisingExecution('Runway of 8 months at current burn')).toBe(false);
    expect(isFundraisingExecution('No recurring revenue yet')).toBe(false);
    expect(isFundraisingExecution('Regulatory approval still pending')).toBe(false);
  });

  it('does not fire on ambiguous funnel words without numbers', () => {
    // 'committed'/'pass' sozinhos são linguagem de negócio; só contam com
    // número por perto (via violatesInvestorSafety).
    expect(isFundraisingExecution('Highly committed founding team')).toBe(false);
    expect(isFundraisingExecution('Product must pass clinical validation')).toBe(false);
  });
});

describe('splitFundraisingExecution', () => {
  it('partitions preserving ORIGINAL indices for clarification keys', () => {
    const weaknesses = [
      'No recurring revenue yet',        // 0 -> business
      LEAKED_PASS_RATE,                  // 1 -> execution
      'Team of 3 with no sales hire',    // 2 -> business
      LEAKED_CONTACTED,                  // 3 -> execution
    ];
    const { business, execution } = splitFundraisingExecution(weaknesses);
    expect(business).toEqual([
      { text: 'No recurring revenue yet', index: 0 },
      { text: 'Team of 3 with no sales hire', index: 2 },
    ]);
    expect(execution).toEqual([
      { text: LEAKED_PASS_RATE, index: 1 },
      { text: LEAKED_CONTACTED, index: 3 },
    ]);
  });

  it('returns everything as business when nothing matches', () => {
    const { business, execution } = splitFundraisingExecution(['Small team', 'Early product']);
    expect(business.map((b) => b.index)).toEqual([0, 1]);
    expect(execution).toEqual([]);
  });

  it('handles empty input', () => {
    expect(splitFundraisingExecution([])).toEqual({ business: [], execution: [] });
  });
});
