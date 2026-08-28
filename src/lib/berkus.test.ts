import { describe, expect, it } from 'vitest';
import { berkusFactorEur, berkusLevelPct, berkusTotalEur, isInvestorCalibrated, BERKUS_DEFAULT_CALIBRATION_REF_EUR, type BerkusFactorLevel } from './berkus';
import type { BerkusFactorKey } from '@/content/berkus/factors_v1';

function makeFactor(overrides: Partial<BerkusFactorLevel> & { key: BerkusFactorKey }): BerkusFactorLevel {
  return { level: null, skipped: false, ...overrides };
}

describe('isInvestorCalibrated — Prompt 428 §C', () => {
  it('is false at the classic €500k default', () => {
    expect(isInvestorCalibrated(BERKUS_DEFAULT_CALIBRATION_REF_EUR)).toBe(false);
  });

  it('is true for any reference other than €500k', () => {
    expect(isInvestorCalibrated(600000)).toBe(true);
    expect(isInvestorCalibrated(250000)).toBe(true);
  });
});

describe('berkusLevelPct — Prompt 428 §D', () => {
  it('Simplified: L1=0%, L2=25%, L3=50%, L4=75%, L5=100%', () => {
    expect(berkusLevelPct('simplified', 1, false)).toBe(0);
    expect(berkusLevelPct('simplified', 2, false)).toBe(25);
    expect(berkusLevelPct('simplified', 3, false)).toBe(50);
    expect(berkusLevelPct('simplified', 4, false)).toBe(75);
    expect(berkusLevelPct('simplified', 5, false)).toBe(100);
  });

  it('Detailed: L0=0%, L1=20%, L2=40%, L3=60%, L4=80%, L5=100%', () => {
    expect(berkusLevelPct('detailed', 0, false)).toBe(0);
    expect(berkusLevelPct('detailed', 1, false)).toBe(20);
    expect(berkusLevelPct('detailed', 2, false)).toBe(40);
    expect(berkusLevelPct('detailed', 3, false)).toBe(60);
    expect(berkusLevelPct('detailed', 4, false)).toBe(80);
    expect(berkusLevelPct('detailed', 5, false)).toBe(100);
  });

  it('the two modes deliberately use different tables at the same level — never unified', () => {
    expect(berkusLevelPct('simplified', 3, false)).not.toBe(berkusLevelPct('detailed', 3, false));
    expect(berkusLevelPct('simplified', 2, false)).not.toBe(berkusLevelPct('detailed', 2, false));
  });

  it('an unanswered factor (level=null) is 0% regardless of mode', () => {
    expect(berkusLevelPct('simplified', null, false)).toBe(0);
    expect(berkusLevelPct('detailed', null, false)).toBe(0);
  });

  it('a skipped factor is 0% even if a level value is somehow present', () => {
    expect(berkusLevelPct('simplified', 5, true)).toBe(0);
    expect(berkusLevelPct('detailed', 5, true)).toBe(0);
  });

  it('Simplified has no Level 0 entry — falls back to 0%', () => {
    expect(berkusLevelPct('simplified', 0, false)).toBe(0);
  });
});

describe('berkusFactorEur — Prompt 428 §C/§D', () => {
  it('Simplified level 3 at the default €500k reference is €250,000 (50%)', () => {
    expect(berkusFactorEur('simplified', 3, false, BERKUS_DEFAULT_CALIBRATION_REF_EUR)).toBe(250000);
  });

  it('Detailed level 3 at the default €500k reference is €300,000 (60%) — different from Simplified at the same level', () => {
    expect(berkusFactorEur('detailed', 3, false, BERKUS_DEFAULT_CALIBRATION_REF_EUR)).toBe(300000);
  });

  it('an unanswered or skipped factor is always €0, regardless of the reference', () => {
    expect(berkusFactorEur('simplified', null, false, BERKUS_DEFAULT_CALIBRATION_REF_EUR)).toBe(0);
    expect(berkusFactorEur('detailed', 4, true, 1000000)).toBe(0);
  });

  it('rounds to the nearest whole euro rather than carrying fractional cents', () => {
    // 333,333 * 50% = 166,666.5 -> rounds to 166,667
    expect(berkusFactorEur('simplified', 3, false, 333333)).toBe(166667);
  });
});

describe('berkusTotalEur — Prompt 428 §C (proportional recalibration)', () => {
  const factors: BerkusFactorLevel[] = [
    makeFactor({ key: 'sound_idea', level: 5 }),
    makeFactor({ key: 'prototype', level: 3 }),
    makeFactor({ key: 'team', level: 4 }),
    makeFactor({ key: 'relationships', level: null }), // unanswered
    makeFactor({ key: 'sales', level: 2, skipped: true }), // explicitly skipped
  ];

  it('sums only the answered, non-skipped factors', () => {
    // Simplified: L5=100%, L3=50%, L4=75%, unanswered=0%, skipped=0%
    // (1 + 0.5 + 0.75) * 500000 = 1,125,000
    expect(berkusTotalEur('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR)).toBe(1125000);
  });

  it('is exactly €0 for an entirely empty/unanswered factor set', () => {
    expect(berkusTotalEur('simplified', [], BERKUS_DEFAULT_CALIBRATION_REF_EUR)).toBe(0);
    expect(berkusTotalEur('detailed', [makeFactor({ key: 'team' })], BERKUS_DEFAULT_CALIBRATION_REF_EUR)).toBe(0);
  });

  it('recalibrating scales the total proportionally — the whole point of §C', () => {
    const atDefault = berkusTotalEur('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR);
    const atDouble = berkusTotalEur('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR * 2);
    expect(atDouble).toBeCloseTo(atDefault * 2);
  });

  it('Simplified and Detailed totals differ for the same levels, since each mode has its own table', () => {
    const simplifiedTotal = berkusTotalEur('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR);
    const detailedTotal = berkusTotalEur('detailed', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR);
    expect(simplifiedTotal).not.toBe(detailedTotal);
  });
});
