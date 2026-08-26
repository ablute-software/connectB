import { describe, expect, it } from 'vitest';
import { redistributeWeight, redistributeAfterRemoval, DEFAULT_NEW_CRITERION_WEIGHT } from './investor-scorecard-weights';

function sum(criteria: { weight: number }[]): number {
  return criteria.reduce((s, c) => s + c.weight, 0);
}

describe('redistributeWeight', () => {
  // Nuno's own acceptance test, verbatim: "com 6 critérios a 5 cada (soma
  // 30), arrastar Team até 10 (+5) faz as outras 5 descerem simultaneamente
  // para 4 cada (-1 cada, soma continua 30)."
  it("Nuno's exact example: 6 criteria at 5, drag Team to 10, the other 5 drop to 4", () => {
    const criteria = [
      { id: 'team', weight: 5 }, { id: 'execution', weight: 5 }, { id: 'tech', weight: 5 },
      { id: 'market', weight: 5 }, { id: 'traction', weight: 5 }, { id: 'moat', weight: 5 },
    ];
    const result = redistributeWeight(criteria, 'team', 10);
    expect(result.find((c) => c.id === 'team')?.weight).toBe(10);
    for (const id of ['execution', 'tech', 'market', 'traction', 'moat']) {
      expect(result.find((c) => c.id === id)?.weight).toBe(4);
    }
    expect(sum(result)).toBe(30);
  });

  it('dragging down works the same way in reverse — others rise to compensate', () => {
    const criteria = [
      { id: 'team', weight: 5 }, { id: 'execution', weight: 5 }, { id: 'tech', weight: 5 },
      { id: 'market', weight: 5 }, { id: 'traction', weight: 5 }, { id: 'moat', weight: 5 },
    ];
    const result = redistributeWeight(criteria, 'team', 0);
    expect(result.find((c) => c.id === 'team')?.weight).toBe(0);
    for (const id of ['execution', 'tech', 'market', 'traction', 'moat']) {
      expect(result.find((c) => c.id === id)?.weight).toBe(6);
    }
    expect(sum(result)).toBe(30);
  });

  it('the sum is exactly preserved even when the split does not divide evenly', () => {
    // 5 others sharing a -7 change: -1.4 each, must round to an exact sum.
    const criteria = [
      { id: 'a', weight: 5 }, { id: 'b', weight: 5 }, { id: 'c', weight: 5 },
      { id: 'd', weight: 5 }, { id: 'e', weight: 5 }, { id: 'f', weight: 5 },
    ];
    const result = redistributeWeight(criteria, 'a', 12);
    expect(sum(result)).toBe(sum(criteria));
  });

  it('a criterion never goes below 0, even under a large drag', () => {
    const criteria = [{ id: 'a', weight: 5 }, { id: 'b', weight: 5 }, { id: 'c', weight: 5 }];
    const result = redistributeWeight(criteria, 'a', 10);
    for (const c of result) expect(c.weight).toBeGreaterThanOrEqual(0);
    // a takes +5, the other 2 must absorb -5 total (-2.5 each) -> 2/3 or
    // similar, integer-rounded, sum stays 15.
    expect(sum(result)).toBe(15);
  });

  it('overflow spillover: one other criterion already at 0 gives nothing, the rest absorb the shortfall', () => {
    // b is already pinned at the floor — c alone must absorb b's would-be
    // share too, not just its own equal slice.
    const criteria = [{ id: 'a', weight: 5 }, { id: 'b', weight: 0 }, { id: 'c', weight: 10 }];
    const result = redistributeWeight(criteria, 'a', 10);
    expect(result.find((c) => c.id === 'a')?.weight).toBe(10);
    expect(result.find((c) => c.id === 'b')?.weight).toBe(0); // already at floor, stays there
    expect(result.find((c) => c.id === 'c')?.weight).toBe(5); // absorbs the full -5 alone
    expect(sum(result)).toBe(15);
  });

  it('an infeasible drag (others have no more room) clamps the dragged value itself, sum still constant', () => {
    // Both others already at 0 — there is nothing left to take from them,
    // so "a" cannot actually reach 10; it can only rise by what the others
    // can give up, which is nothing.
    const criteria = [{ id: 'a', weight: 5 }, { id: 'b', weight: 0 }, { id: 'c', weight: 0 }];
    const result = redistributeWeight(criteria, 'a', 10);
    expect(sum(result)).toBe(5);
    expect(result.find((c) => c.id === 'a')?.weight).toBe(5);
  });

  it('a no-op drag (target equals current) changes nothing', () => {
    const criteria = [{ id: 'a', weight: 5 }, { id: 'b', weight: 5 }];
    const result = redistributeWeight(criteria, 'a', 5);
    expect(result).toEqual(criteria);
  });

  it('a single criterion just clamps to its own target, no others to redistribute to', () => {
    const result = redistributeWeight([{ id: 'a', weight: 5 }], 'a', 9);
    expect(result).toEqual([{ id: 'a', weight: 9 }]);
  });
});

describe('redistributeAfterRemoval', () => {
  it("removing a criterion spreads what it had across the rest — Nuno's own rule", () => {
    const criteria = [
      { id: 'team', weight: 10 }, { id: 'a', weight: 4 }, { id: 'b', weight: 4 },
      { id: 'c', weight: 4 }, { id: 'd', weight: 4 }, { id: 'e', weight: 4 },
    ];
    const result = redistributeAfterRemoval(criteria, 'team');
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // team's 10 spread across 5 remaining = +2 each -> 6 each.
    for (const c of result) expect(c.weight).toBe(6);
    expect(sum(result)).toBe(30); // unchanged total: 10 removed, +10 distributed
  });

  it('removing the last-but-one criterion leaves a single one absorbing everything, capped at 10', () => {
    const criteria = [{ id: 'a', weight: 10 }, { id: 'b', weight: 2 }];
    const result = redistributeAfterRemoval(criteria, 'a');
    expect(result).toEqual([{ id: 'b', weight: 10 }]); // capped, can't exceed 10 — the excess is simply not placeable
  });

  it('removing the only criterion leaves an empty list, not an error', () => {
    expect(redistributeAfterRemoval([{ id: 'a', weight: 5 }], 'a')).toEqual([]);
  });
});

describe('DEFAULT_NEW_CRITERION_WEIGHT', () => {
  it('is the scale midpoint, 5', () => {
    expect(DEFAULT_NEW_CRITERION_WEIGHT).toBe(5);
  });
});
