import { describe, expect, it } from 'vitest';
import { seniorityRankLabel } from './seniority-rank-label';

describe('seniorityRankLabel', () => {
  it('labels every real rank 1-4 and 9', () => {
    expect(seniorityRankLabel(1)).toBe('Founding / Managing / General Partner');
    expect(seniorityRankLabel(2)).toBe('Partner');
    expect(seniorityRankLabel(3)).toBe('Venture Partner / Associate');
    expect(seniorityRankLabel(4)).toBe('Analyst');
    expect(seniorityRankLabel(9)).toBe('Other role');
  });

  it('returns null for an unmapped rank rather than guessing', () => {
    expect(seniorityRankLabel(5)).toBeNull();
    expect(seniorityRankLabel(0)).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(seniorityRankLabel(null)).toBeNull();
    expect(seniorityRankLabel(undefined)).toBeNull();
  });
});
