import { describe, it, expect } from 'vitest';
import { computeSnapshotDelta, matchScoreCrossedThreshold, deltaMagnitude, sortWatchItems } from './investor-watching';
import type { SnapshotData } from './startup-snapshot';

const BASE: SnapshotData = {
  stage: 'seed', sectors: ['fintech'], one_liner: 'a', description: 'd',
  round_target_eur: 1_000_000, round_valuation_eur: 5_000_000, round_valuation_basis: 'pre_money',
  round_instruments: ['equity'], round_target_close_date: null, round_raising: true,
  employee_count: 5, traction: [{ label: 'MRR', value: '€10k' }],
};

describe('computeSnapshotDelta', () => {
  it('no changes yields an empty delta', () => {
    expect(computeSnapshotDelta(BASE, { ...BASE })).toEqual([]);
  });

  it('detects a changed field, with a human label and both values', () => {
    const current = { ...BASE, round_target_eur: 2_000_000 };
    const delta = computeSnapshotDelta(BASE, current);
    expect(delta).toEqual([{ field: 'round_target_eur', label: 'Round target', from: 1_000_000, to: 2_000_000 }]);
  });

  it('detects a traction metrics change even when nothing else moved', () => {
    const current = { ...BASE, traction: [{ label: 'MRR', value: '€20k' }] };
    const delta = computeSnapshotDelta(BASE, current);
    expect(delta.map((d) => d.field)).toEqual(['traction']);
  });

  it('detects multiple simultaneous field changes', () => {
    const current = { ...BASE, stage: 'series_a', employee_count: 12 };
    const delta = computeSnapshotDelta(BASE, current);
    expect(delta.map((d) => d.field).sort()).toEqual(['employee_count', 'stage']);
  });
});

describe('matchScoreCrossedThreshold', () => {
  it('fires only on the crossing, not while already above', () => {
    expect(matchScoreCrossedThreshold(60, 75, 70)).toBe(true);
    expect(matchScoreCrossedThreshold(75, 80, 70)).toBe(false); // already above before this check
  });

  it('does not fire when the score stays at or below the threshold', () => {
    expect(matchScoreCrossedThreshold(50, 70, 70)).toBe(false);
    expect(matchScoreCrossedThreshold(40, 60, 70)).toBe(false);
  });
});

describe('deltaMagnitude', () => {
  it('weighs class-1 evidence heavier than class-2, both heavier than a plain field change', () => {
    const fieldOnly = deltaMagnitude({ changedFieldsCount: 1, newClass1Count: 0, newClass2Count: 0, newRoadmapCount: 0 });
    const class2 = deltaMagnitude({ changedFieldsCount: 0, newClass1Count: 0, newClass2Count: 1, newRoadmapCount: 0 });
    const class1 = deltaMagnitude({ changedFieldsCount: 0, newClass1Count: 1, newClass2Count: 0, newRoadmapCount: 0 });
    expect(class1).toBeGreaterThan(class2);
    expect(class2).toBeGreaterThan(fieldOnly);
  });
});

describe('sortWatchItems', () => {
  const items = [
    { id: 'a', matchScore: 50, deltaScore: 10 },
    { id: 'b', matchScore: 90, deltaScore: 2 },
  ];

  it('closest_to_criteria orders by matchScore descending', () => {
    expect(sortWatchItems(items, 'closest_to_criteria').map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('most_changed orders by deltaScore descending', () => {
    expect(sortWatchItems(items, 'most_changed').map((i) => i.id)).toEqual(['a', 'b']);
  });
});
