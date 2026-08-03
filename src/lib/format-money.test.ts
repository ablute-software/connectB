import { describe, expect, it } from 'vitest';
import { fmtRoundEur } from './format-money';

// P106 §3 — Nuno's own "7 mandatory examples" weren't included in the
// prompt text handed to Claude Code (only the formatting rules were), so
// these cover the stated rules instead of his literal cases. Flagged back
// rather than guessed.
describe('fmtRoundEur', () => {
  it('formats sub-€1M values spelled out with a thousands separator', () => {
    expect(fmtRoundEur(500_000)).toBe('€500,000');
    expect(fmtRoundEur(0)).toBe('€0');
    expect(fmtRoundEur(999_999)).toBe('€999,999');
  });

  it('formats €1M+ with up to 2 decimals and no trailing zeros', () => {
    expect(fmtRoundEur(1_000_000)).toBe('€1M');
    expect(fmtRoundEur(1_300_000)).toBe('€1.3M');
    expect(fmtRoundEur(2_534_000)).toBe('€2.53M');
  });

  it('formats €1B+ the same way', () => {
    expect(fmtRoundEur(1_500_000_000)).toBe('€1.5B');
  });

  it('returns an em dash for missing values', () => {
    expect(fmtRoundEur(undefined)).toBe('—');
  });
});
