import { describe, expect, it } from 'vitest';
import { startupInvestorDeckCap } from './companyCompleteness';

// Prompt 121 §2.7-b — permanent regression test for the completeness-tier
// investor visibility cap: pins the exact thresholds (<40 / 40-70 / >70)
// the prompt specified, since these are otherwise just magic numbers that
// could silently drift.
describe('startupInvestorDeckCap', () => {
  it('shows 5 below 40% complete', () => {
    expect(startupInvestorDeckCap(0)).toBe(5);
    expect(startupInvestorDeckCap(39)).toBe(5);
  });

  it('shows 15 between 40% and 70% complete, inclusive', () => {
    expect(startupInvestorDeckCap(40)).toBe(15);
    expect(startupInvestorDeckCap(55)).toBe(15);
    expect(startupInvestorDeckCap(70)).toBe(15);
  });

  it('lifts the cap above 70% complete — the full eligible list', () => {
    expect(startupInvestorDeckCap(71)).toBe(999);
    expect(startupInvestorDeckCap(100)).toBe(999);
  });
});
