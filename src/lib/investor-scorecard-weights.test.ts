import { describe, expect, it } from 'vitest';
import { DEFAULT_NEW_CRITERION_WEIGHT } from './investor-scorecard-weights';

describe('DEFAULT_NEW_CRITERION_WEIGHT', () => {
  it('is the scale midpoint, 5', () => {
    expect(DEFAULT_NEW_CRITERION_WEIGHT).toBe(5);
  });
});
