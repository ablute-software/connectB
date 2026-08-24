import { describe, it, expect } from 'vitest';
import { computeScoreStats, canPublishDigest, buildFeedbackDigestPrompt, MIN_CONTRIBUTORS } from './watson-investor-feedback-digest';

describe('canPublishDigest', () => {
  it('the k-anonymity gate: fewer than 3 contributors means no digest at all', () => {
    expect(canPublishDigest(0)).toBe(false);
    expect(canPublishDigest(1)).toBe(false);
    expect(canPublishDigest(2)).toBe(false);
  });

  it('3 or more contributors clears the gate', () => {
    expect(canPublishDigest(3)).toBe(true);
    expect(canPublishDigest(10)).toBe(true);
  });

  it('MIN_CONTRIBUTORS is exactly 3', () => {
    expect(MIN_CONTRIBUTORS).toBe(3);
  });
});

describe('computeScoreStats', () => {
  it('returns null for an empty set — nothing to summarize', () => {
    expect(computeScoreStats([])).toBeNull();
  });

  it('computes avg/min/max across per-investor averages, never exposing the raw list', () => {
    expect(computeScoreStats([6, 8, 10])).toEqual({ avg: 8, min: 6, max: 10 });
  });

  it('rounds the average to one decimal place', () => {
    expect(computeScoreStats([7, 8, 8])).toEqual({ avg: 7.7, min: 7, max: 8 });
  });
});

describe('buildFeedbackDigestPrompt', () => {
  it('numbers each note without attributing it to an investor', () => {
    const prompt = buildFeedbackDigestPrompt(['Strong team', 'Weak GTM']);
    expect(prompt).toContain('Note 1: Strong team');
    expect(prompt).toContain('Note 2: Weak GTM');
    expect(prompt).not.toMatch(/investor \d/i);
  });
});
