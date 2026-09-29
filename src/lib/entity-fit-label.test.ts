import { describe, expect, it } from 'vitest';
import { effectiveFitLabel, hasThesisOrSectors } from './entity-fit-label';

describe('effectiveFitLabel — Prompt 893 §F.3', () => {
  it('no thesis, no sectors → "Fit unknown — thesis missing", regardless of fit_score', () => {
    expect(effectiveFitLabel({ thesis: undefined, sectors: [], fit_score: 'medium' })).toBe('Fit unknown — thesis missing');
    expect(effectiveFitLabel({ thesis: undefined, sectors: [], fit_score: undefined })).toBe('Fit unknown — thesis missing');
  });

  it('a blank/whitespace-only thesis still counts as "no thesis"', () => {
    expect(effectiveFitLabel({ thesis: '   ', sectors: [], fit_score: 'high' })).toBe('Fit unknown — thesis missing');
  });

  it('sectors present (even with no thesis) → a real fit_score renders normally', () => {
    expect(effectiveFitLabel({ thesis: undefined, sectors: ['fintech'], fit_score: 'medium' })).toBe('Medium fit');
  });

  it('thesis present, no fit_score yet → null (no badge), not a fabricated label', () => {
    expect(effectiveFitLabel({ thesis: 'We back deep tech.', sectors: [], fit_score: undefined })).toBeNull();
  });

  it('hasThesisOrSectors mirrors the same gate', () => {
    expect(hasThesisOrSectors({ thesis: undefined, sectors: [] })).toBe(false);
    expect(hasThesisOrSectors({ thesis: 'x', sectors: [] })).toBe(true);
    expect(hasThesisOrSectors({ thesis: undefined, sectors: ['health'] })).toBe(true);
  });
});
