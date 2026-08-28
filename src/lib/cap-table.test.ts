import { describe, expect, it } from 'vitest';
import { applyCapTableDilution, capTableTotal, isCapTableTotalOff, toCapTableSlices, quarterYearToIsoDate } from './cap-table';
import type { CapTableEntry } from './types';

function makeEntry(overrides: Partial<CapTableEntry> & { id: string }): CapTableEntry {
  return { category: 'founder', label: overrides.id, pct: 0, as_of: '2026-08-28', ...overrides };
}

describe('capTableTotal / isCapTableTotalOff — Prompt 422 §B', () => {
  it('sums every entry\'s pct', () => {
    const entries = [makeEntry({ id: '1', pct: 60 }), makeEntry({ id: '2', pct: 25 }), makeEntry({ id: '3', pct: 15 })];
    expect(capTableTotal(entries)).toBe(100);
  });

  it('is not off when the total is exactly 100', () => {
    expect(isCapTableTotalOff([makeEntry({ id: '1', pct: 100 })])).toBe(false);
  });

  it('is not off within the small rounding tolerance', () => {
    expect(isCapTableTotalOff([makeEntry({ id: '1', pct: 99.8 })])).toBe(false);
  });

  it('is off when the total is meaningfully short of 100', () => {
    expect(isCapTableTotalOff([makeEntry({ id: '1', pct: 60 })])).toBe(true);
  });

  it('is off when the total meaningfully exceeds 100', () => {
    expect(isCapTableTotalOff([makeEntry({ id: '1', pct: 70 }), makeEntry({ id: '2', pct: 50 })])).toBe(true);
  });

  it('is never off for an empty cap table — nothing entered yet is not "wrong"', () => {
    expect(isCapTableTotalOff([])).toBe(false);
  });
});

describe('applyCapTableDilution — Prompt 422 §C.2', () => {
  const entries = [
    makeEntry({ id: 'founder-a', category: 'founder', label: 'Founder A', pct: 50 }),
    makeEntry({ id: 'founder-b', category: 'founder', label: 'Founder B', pct: 30 }),
    makeEntry({ id: 'pool', category: 'option_pool', label: 'ESOP pool', pct: 20 }),
  ];

  it('proportionally shrinks every existing line by the investor\'s slice', () => {
    const result = applyCapTableDilution(entries, 10);
    // Each existing line multiplied by (1 - 10/100) = 0.9
    expect(result.find((s) => s.label === 'Founder A')?.pct).toBeCloseTo(45);
    expect(result.find((s) => s.label === 'Founder B')?.pct).toBeCloseTo(27);
    expect(result.find((s) => s.label === 'ESOP pool')?.pct).toBeCloseTo(18);
  });

  it('adds the investor\'s own slice as a distinct entry', () => {
    const result = applyCapTableDilution(entries, 10);
    const mine = result.find((s) => s.label === 'You (estimated)');
    expect(mine?.pct).toBe(10);
    expect(mine?.category).toBe('investor_estimate');
  });

  it('keeps the total at ~100 after dilution — the whole point vs. a naive add-on-top', () => {
    const result = applyCapTableDilution(entries, 10);
    const total = result.reduce((s, r) => s + r.pct, 0);
    expect(total).toBeCloseTo(100);
  });

  it('at 0% investor slice, existing lines are unchanged', () => {
    const result = applyCapTableDilution(entries, 0);
    expect(result.find((s) => s.label === 'Founder A')?.pct).toBe(50);
    expect(result.find((s) => s.label === 'You (estimated)')?.pct).toBe(0);
  });

  it('clamps an out-of-range slice rather than producing a negative or >100 result', () => {
    const over = applyCapTableDilution(entries, 150);
    expect(over.find((s) => s.label === 'You (estimated)')?.pct).toBe(100);
    const under = applyCapTableDilution(entries, -5);
    expect(under.find((s) => s.label === 'You (estimated)')?.pct).toBe(0);
  });
});

describe('toCapTableSlices — Prompt 422 §C.3 (excluding the investor\'s stake)', () => {
  it('passes founder-declared entries through unchanged when the checkbox is off', () => {
    const entries = [makeEntry({ id: '1', label: 'Founder A', pct: 70 }), makeEntry({ id: '2', label: 'Investors', category: 'investor', pct: 30 })];
    expect(toCapTableSlices(entries)).toEqual([
      { label: 'Founder A', pct: 70, category: 'founder' },
      { label: 'Investors', pct: 30, category: 'investor' },
    ]);
  });
});

describe('quarterYearToIsoDate — Prompt 432 §C', () => {
  it('converts a quarter/year pair to the 1st of that quarter\'s first month', () => {
    expect(quarterYearToIsoDate('Q2', '2027')).toBe('2027-04-01');
  });

  it('covers all four quarters', () => {
    expect(quarterYearToIsoDate('Q1', '2026')).toBe('2026-01-01');
    expect(quarterYearToIsoDate('Q3', '2026')).toBe('2026-07-01');
    expect(quarterYearToIsoDate('Q4', '2026')).toBe('2026-10-01');
  });
});
