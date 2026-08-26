import { describe, expect, it } from 'vitest';
import { weightedCriterionValues, overallWeightedAverage } from './investor-scorecard-summary';

const CRITERIA = [
  { id: 'team', label: 'Team', weight: 10 },
  { id: 'tech', label: 'Technology', weight: 4 },
];

describe('weightedCriterionValues', () => {
  // Nuno's own example, verbatim: "se damos 5 a tecnologia em swot, ao
  // passar para roadmap está a zero e pode levar um 6 ou 9" — independent
  // per tab, never pre-filled, never counted as 0 when unrated.
  it('averages a criterion across only the tabs it was actually rated on', () => {
    const rows = [
      { criteriaId: 'tech', tab: 'swot', score: 5 },
      { criteriaId: 'tech', tab: 'roadmap', score: 9 },
      // team never rated anywhere.
    ];
    const result = weightedCriterionValues(CRITERIA, rows);
    expect(result.find((r) => r.id === 'tech')?.value).toBe(7); // (5+9)/2
    expect(result.find((r) => r.id === 'team')?.value).toBeNull();
  });

  it('an unrated tab entry never counts as 0', () => {
    const rows = [{ criteriaId: 'tech', tab: 'swot', score: 10 }];
    const result = weightedCriterionValues(CRITERIA, rows);
    // If the missing roadmap/about/etc entries counted as 0 this would be
    // well below 10 — they must not exist as entries at all.
    expect(result.find((r) => r.id === 'tech')?.value).toBe(10);
  });

  it('a criterion with zero ratings anywhere is null, not 0', () => {
    const result = weightedCriterionValues(CRITERIA, []);
    expect(result.every((r) => r.value === null)).toBe(true);
  });
});

describe('overallWeightedAverage', () => {
  it('weights each rated entry by its OWN criterion weight, across all criteria and tabs', () => {
    const rows = [
      { criteriaId: 'team', tab: 'about', score: 8 }, // weight 10
      { criteriaId: 'tech', tab: 'swot', score: 2 }, // weight 4
    ];
    // (10*8 + 4*2) / (10+4) = 88/14
    expect(overallWeightedAverage(CRITERIA, rows)).toBeCloseTo(88 / 14, 6);
  });

  it('unrated entries never enter the sum or the denominator', () => {
    const rows = [{ criteriaId: 'team', tab: 'about', score: 8 }];
    expect(overallWeightedAverage(CRITERIA, rows)).toBe(8);
  });

  it('no ratings at all -> null, not 0', () => {
    expect(overallWeightedAverage(CRITERIA, [])).toBeNull();
  });
});
