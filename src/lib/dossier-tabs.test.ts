import { describe, it, expect } from 'vitest';
import { resolveInitialTabFromHash } from './dossier-tabs';

describe('resolveInitialTabFromHash', () => {
  it('opens the tab named by the hash when it exists among the available sections', () => {
    expect(resolveInitialTabFromHash('#round', ['about', 'round', 'market'], 'about')).toBe('round');
  });

  it('falls back to the default when the hash names a section that does not exist for this dossier', () => {
    expect(resolveInitialTabFromHash('#team', ['about', 'round'], 'about')).toBe('about');
  });

  it('falls back to the default for an empty hash', () => {
    expect(resolveInitialTabFromHash('', ['about', 'round'], 'about')).toBe('about');
  });

  it('strips a leading # before matching', () => {
    expect(resolveInitialTabFromHash('#market', ['market'], 'about')).toBe('market');
  });
});
