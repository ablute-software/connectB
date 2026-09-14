import { describe, expect, it } from 'vitest';
import { hasPortfolioRelationship } from './investor-portfolio-relationship';

describe('hasPortfolioRelationship', () => {
  it('a startup whose founder marked this investor invested is a relationship', () => {
    expect(hasPortfolioRelationship(['invested'])).toBe(true);
  });
  it('any other recorded status (e.g. contacted) is normal discovery, not a relationship', () => {
    expect(hasPortfolioRelationship(['contacted'])).toBe(false);
    expect(hasPortfolioRelationship(['not_contacted'])).toBe(false);
    expect(hasPortfolioRelationship(['passed'])).toBe(false);
    expect(hasPortfolioRelationship(['diligence'])).toBe(false);
  });
  it('no entity at all for this org/investor pair is normal discovery — nothing to infer', () => {
    expect(hasPortfolioRelationship([])).toBe(false);
  });
  it('one invested row among several is still a relationship', () => {
    expect(hasPortfolioRelationship(['not_contacted', 'invested'])).toBe(true);
  });
});
