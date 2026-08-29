import { describe, expect, it } from 'vitest';
import { mergeComparableRounds, type MergedRound } from './market-rounds-merge';

function round(overrides: Partial<MergedRound> = {}): MergedRound {
  return { companyName: 'Acme', investorName: null, amountEur: 5_000_000, investedAt: '2026-01-15', roundType: 'Series A', source: 'competitor_tracked', ...overrides };
}

describe('mergeComparableRounds', () => {
  it('dedupes by (name, amount) and prefers the competitor_tracked version', () => {
    const tracked = [round({ companyName: 'Acme', amountEur: 5_000_000, investorName: 'Sequoia', source: 'competitor_tracked' })];
    const researched = [round({ companyName: 'Acme', amountEur: 5_000_000, investorName: null, source: 'research' })];
    const merged = mergeComparableRounds(tracked, researched);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('competitor_tracked');
    expect(merged[0].investorName).toBe('Sequoia');
  });

  it('dedupe is case-insensitive and trims whitespace on the company name', () => {
    const tracked = [round({ companyName: '  Acme  ', amountEur: 5_000_000 })];
    const researched = [round({ companyName: 'ACME', amountEur: 5_000_000, source: 'research' })];
    expect(mergeComparableRounds(tracked, researched)).toHaveLength(1);
  });

  it('does not duplicate when the two lists do not overlap', () => {
    const tracked = [round({ companyName: 'Acme', amountEur: 5_000_000 })];
    const researched = [round({ companyName: 'Rival Inc', amountEur: 3_000_000, source: 'research' })];
    const merged = mergeComparableRounds(tracked, researched);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.companyName).sort()).toEqual(['Acme', 'Rival Inc']);
  });

  it('a different amount for the same company is NOT deduped (two distinct rounds)', () => {
    const tracked = [round({ companyName: 'Acme', amountEur: 5_000_000 })];
    const researched = [round({ companyName: 'Acme', amountEur: 12_000_000, source: 'research' })];
    expect(mergeComparableRounds(tracked, researched)).toHaveLength(2);
  });

  it('sorts the merged list by investedAt, most recent first', () => {
    const tracked = [round({ companyName: 'Old Co', investedAt: '2025-01-01' })];
    const researched = [round({ companyName: 'New Co', investedAt: '2026-06-01', source: 'research' })];
    const merged = mergeComparableRounds(tracked, researched);
    expect(merged.map((r) => r.companyName)).toEqual(['New Co', 'Old Co']);
  });

  it('handles empty lists on either side', () => {
    expect(mergeComparableRounds([], [])).toEqual([]);
    expect(mergeComparableRounds([round()], [])).toHaveLength(1);
    expect(mergeComparableRounds([], [round({ source: 'research' })])).toHaveLength(1);
  });
});
