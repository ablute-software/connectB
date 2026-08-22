import { describe, expect, it } from 'vitest';
import { pickCurrentGap } from './gap-rotation';

describe('pickCurrentGap', () => {
  const gaps = [{ key: 'g1' }, { key: 'g3' }, { key: 'g5' }];

  it('picks the first gap when nothing has been skipped', () => {
    expect(pickCurrentGap(gaps, new Set())).toEqual({ key: 'g1' });
  });

  it('skipping the current gap advances to the next different one — the exact bug from Prompt 309', () => {
    const skipped = new Set(['g1']);
    expect(pickCurrentGap(gaps, skipped)).toEqual({ key: 'g3' });
  });

  it('skipping in sequence walks through every remaining gap, never repeating one already skipped', () => {
    const skipped = new Set(['g1', 'g3']);
    expect(pickCurrentGap(gaps, skipped)).toEqual({ key: 'g5' });
  });

  it('once every gap has been skipped, the rotation restarts from the top (never gets stuck with nothing shown)', () => {
    const skipped = new Set(['g1', 'g3', 'g5']);
    expect(pickCurrentGap(gaps, skipped)).toEqual({ key: 'g1' });
  });

  it('returns undefined when there are no gaps at all, regardless of skip state', () => {
    expect(pickCurrentGap([], new Set())).toBeUndefined();
    expect(pickCurrentGap([], new Set(['g1']))).toBeUndefined();
  });

  it('a skipped key for a gap no longer present (e.g. answered/resolved elsewhere) is harmless', () => {
    const skipped = new Set(['g1', 'gone']);
    expect(pickCurrentGap(gaps, skipped)).toEqual({ key: 'g3' });
  });

  it('preserves the caller-provided gap order — never reorders by anything other than skip state', () => {
    const reordered = [{ key: 'g5' }, { key: 'g1' }, { key: 'g3' }];
    expect(pickCurrentGap(reordered, new Set(['g5']))).toEqual({ key: 'g1' });
  });
});
