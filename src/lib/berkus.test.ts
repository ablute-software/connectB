import { describe, expect, it } from 'vitest';
import {
  berkusFactorEur, berkusLevelPct, berkusTotalEur, isInvestorCalibrated, berkusApplicability, berkusDiagnostic, berkusSensitivity,
  BERKUS_DEFAULT_CALIBRATION_REF_EUR, type BerkusFactorLevel,
} from './berkus';
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

describe('berkusApplicability — Prompt 428 §B', () => {
  it('is applicable pre-revenue (concept_idea, prototype, pilot)', () => {
    expect(berkusApplicability('concept_idea').applicable).toBe(true);
    expect(berkusApplicability('prototype').applicable).toBe(true);
    expect(berkusApplicability('pilot').applicable).toBe(true);
  });

  it('is low relevance once the company has real market traction', () => {
    expect(berkusApplicability('launch_early_adopters').applicable).toBe(false);
    expect(berkusApplicability('growth').applicable).toBe(false);
  });

  it('always returns a non-empty explanation either way — never a bare boolean', () => {
    expect(berkusApplicability('concept_idea').reason.length).toBeGreaterThan(0);
    expect(berkusApplicability('growth').reason.length).toBeGreaterThan(0);
  });
});

describe('berkusDiagnostic — Prompt 428 §E Step 5', () => {
  it('picks the highest and lowest EUR contribution among answered factors only', () => {
    const factors: BerkusFactorLevel[] = [
      makeFactor({ key: 'sound_idea', level: 5 }), // strongest
      makeFactor({ key: 'prototype', level: 1 }), // weakest among answered
      makeFactor({ key: 'team', level: 3 }),
      makeFactor({ key: 'relationships', level: null }), // unanswered — never wins/loses this comparison
      makeFactor({ key: 'sales', level: 2, skipped: true }), // skipped — same
    ];
    const d = berkusDiagnostic('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR);
    expect(d.strongest).toBe('sound_idea');
    expect(d.weakest).toBe('prototype');
  });

  it('criticalUnknown prefers an explicitly skipped factor over a merely-unanswered one', () => {
    const factors: BerkusFactorLevel[] = [
      makeFactor({ key: 'sound_idea', level: 4 }),
      makeFactor({ key: 'prototype', level: null }), // unanswered
      makeFactor({ key: 'team', level: 2, skipped: true }), // deliberately skipped — stronger signal
      makeFactor({ key: 'relationships', level: 3 }),
      makeFactor({ key: 'sales', level: 3 }),
    ];
    expect(berkusDiagnostic('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR).criticalUnknown).toBe('team');
  });

  it('criticalUnknown falls back to the first unanswered factor when nothing was skipped', () => {
    const factors: BerkusFactorLevel[] = [
      makeFactor({ key: 'sound_idea', level: 4 }),
      makeFactor({ key: 'prototype', level: null }),
      makeFactor({ key: 'team', level: 2 }),
      makeFactor({ key: 'relationships', level: null }),
      makeFactor({ key: 'sales', level: 3 }),
    ];
    expect(berkusDiagnostic('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR).criticalUnknown).toBe('prototype');
  });

  it('everything is null for a completely untouched set of factors', () => {
    const factors: BerkusFactorLevel[] = [makeFactor({ key: 'sound_idea' }), makeFactor({ key: 'prototype' })];
    const d = berkusDiagnostic('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR);
    expect(d.strongest).toBeNull();
    expect(d.weakest).toBeNull();
    expect(d.criticalUnknown).toBe('sound_idea');
  });

  it('is null across the board for an empty factor list', () => {
    const d = berkusDiagnostic('simplified', [], BERKUS_DEFAULT_CALIBRATION_REF_EUR);
    expect(d).toEqual({ strongest: null, weakest: null, criticalUnknown: null });
  });
});

describe('berkusSensitivity — Prompt 428 §E Step 6', () => {
  it('reports the one-level-up EUR delta, not a jump straight to the max', () => {
    const factors: BerkusFactorLevel[] = [makeFactor({ key: 'team', level: 3 })];
    const s = berkusSensitivity('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR);
    expect(s).toEqual({ factor: 'team', fromLevel: 3, toLevel: 4, deltaEur: 125000 }); // 75%-50% of €500k
  });

  it('is null when nothing has been answered yet', () => {
    expect(berkusSensitivity('simplified', [makeFactor({ key: 'team' })], BERKUS_DEFAULT_CALIBRATION_REF_EUR)).toBeNull();
  });

  it('is null once every answered factor is already at Level 5 — nothing left to move', () => {
    const factors: BerkusFactorLevel[] = [makeFactor({ key: 'sound_idea', level: 5 }), makeFactor({ key: 'team', level: 5 })];
    expect(berkusSensitivity('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR)).toBeNull();
  });

  it('ignores skipped and unanswered factors as candidates', () => {
    const factors: BerkusFactorLevel[] = [
      makeFactor({ key: 'sound_idea', level: 2, skipped: true }),
      makeFactor({ key: 'prototype', level: null }),
      makeFactor({ key: 'team', level: 4 }),
    ];
    expect(berkusSensitivity('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR)?.factor).toBe('team');
  });

  it('under a tied EUR delta (both level->% tables are linear), prefers the factor with the most overall room left', () => {
    // Simplified: every level step is worth 25% of the reference — team at
    // L2 and sales at L4 both gain the SAME €125k moving up one level, so
    // this is a genuine tie the function must break deterministically.
    const factors: BerkusFactorLevel[] = [makeFactor({ key: 'team', level: 2 }), makeFactor({ key: 'sales', level: 4 })];
    const s = berkusSensitivity('simplified', factors, BERKUS_DEFAULT_CALIBRATION_REF_EUR);
    expect(s?.deltaEur).toBe(125000);
    expect(s?.factor).toBe('team'); // lower current level wins the tie
  });
});
