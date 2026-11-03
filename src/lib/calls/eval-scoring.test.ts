// Prompt 922 (Adenda 3, 02/11/2026) — weighted or not: the final score in the three ways (weighted as always; equal weight with the sum of the points or the average), the weights that stop being a requirement, the bar of
// the grid, the score in the unit of the call (the board and the exports), and the divergence of the total.
import { describe, expect, it } from 'vitest';
import { computeBoard, boardTable, scoreNumber, type BoardInput } from './eval-board';
import { DEFAULT_SETTINGS, barLine, exampleGrades, finalGrade, formulaText, gradeText, gridProblems, parseSettingsPayload, sameScoring, scoreText, scoringOf, weightedGrade, type Criterion, type Scoring } from './eval-grid';

const SUM: Scoring = { mode: 'equal', aggregation: 'sum' };
const AVG: Scoring = { mode: 'equal', aggregation: 'average' };
const W: Scoring = { mode: 'weighted', aggregation: 'sum' };
const crit = (id: string, min: number, max: number, weight = 0, over: Partial<Criterion> = {}): Criterion => ({ id, section: null, position: 0, name: id, guidance: '', weight, format: 'scale', scaleMin: min, scaleMax: max, levels: [], commentRequired: false, minScore: null, ...over });
const THREE = [crit('a', 1, 5), crit('b', 1, 5), crit('c', 1, 5)];

describe('the final score', () => {
  it('SUM: 3 criteria from 1 to 5 with 4, 3 and 5 give "12 / 15 points" (the maximum is the sum of the maxima)', () => {
    const g = finalGrade(THREE, { a: 4, b: 3, c: 5 }, SUM);
    expect(gradeText(g)).toBe('12 / 15 points');
    expect(g.points).toEqual({ value: 12, max: 15 });
    expect(g.percent).toBe(75);                                          // the same position on 0–100, from the minimum (3) to the maximum (15): (12 − 3) / (15 − 3)
  });
  it('AVERAGE with the same scale on every criterion: the same notes give "4.0 / 5"', () => {
    const g = finalGrade(THREE, { a: 4, b: 3, c: 5 }, AVG);
    expect(gradeText(g)).toBe('4.0 / 5');
    expect(g.mixedScales).toBe(false);
  });
  it('AVERAGE with different scales: each score becomes a % of its own scale first, and the result is in %', () => {
    const two = [crit('a', 1, 5), crit('b', 1, 10)];
    const g = finalGrade(two, { a: 4, b: 6 }, AVG);
    expect(g.percent).toBe(65.28);                                       // (75 % + 55.56 %) / 2
    expect(gradeText(g)).toBe('65.3 %');
    expect(g.mixedScales).toBe(true);
  });
  it('SUM with different scales still adds the points ("10 / 15 points")', () => {
    expect(gradeText(finalGrade([crit('a', 1, 5), crit('b', 1, 10)], { a: 4, b: 6 }, SUM))).toBe('10 / 15 points');
  });
  it('an incomplete evaluation has no total, in any mode', () => {
    for (const s of [W, SUM, AVG]) expect(finalGrade(THREE, { a: 4, b: 3 }, s).percent).toBeNull();
    expect(gradeText(finalGrade(THREE, { a: 4 }, SUM))).toBe('N/A');
  });
  it('WEIGHTED is exactly what it always was (and a call that never chose is weighted)', () => {
    const cs = [crit('a', 1, 5, 25), crit('b', 1, 5, 75)];
    expect(finalGrade(cs, { a: 5, b: 1 }, W)).toMatchObject({ percent: weightedGrade(cs, { a: 5, b: 1 }).percent, kind: 'weighted' });
    expect(finalGrade(cs, { a: 5, b: 1 })).toMatchObject({ percent: 25 });
    expect(scoringOf(undefined)).toEqual({ mode: 'weighted', aggregation: 'sum' });
    expect(scoringOf(DEFAULT_SETTINGS)).toEqual({ mode: 'weighted', aggregation: 'sum' });
    expect(scoringOf({ scoringMode: 'equal', equalAggregation: 'average' })).toEqual(AVG);
    expect(sameScoring(W, { mode: 'weighted', aggregation: 'average' })).toBe(true);                  // the aggregation means nothing when weighted
    expect(sameScoring(SUM, AVG)).toBe(false);
  });
});

describe('the weights are not a requirement with equal weight', () => {
  const noWeights = [crit('a', 1, 5, 0), crit('b', 1, 5, 0)];
  it('the sum of the weights is a problem only when weighted; a weight of 0 only means something there', () => {
    expect(gridProblems(noWeights, undefined, W)).toEqual(expect.arrayContaining([expect.stringContaining('The weights add up to 0 %')]));
    expect(gridProblems(noWeights, undefined, SUM)).toEqual([]);
    expect(gridProblems(noWeights, undefined, AVG)).toEqual([]);
    expect(gridProblems([], undefined, SUM)).toEqual(['The evaluation grid has no criteria.']);
  });
  it('the bar says how many criteria and how they are combined — or the weights while they count', () => {
    expect(barLine([crit('a', 1, 5, 25), crit('b', 1, 5, 50)], W)).toEqual({ ok: false, text: '⚠ Weights: 75 / 100 %' });
    expect(barLine([crit('a', 1, 5, 50), crit('b', 1, 5, 50)], W)).toEqual({ ok: true, text: 'Weights: 100 / 100 % ✓' });
    expect(barLine(Array.from({ length: 6 }, (_, i) => crit(`k${i}`, 1, 5)), SUM)).toEqual({ ok: true, text: '6 criteria · max 30 points' });
    expect(barLine(Array.from({ length: 6 }, (_, i) => crit(`k${i}`, 1, 5)), AVG)).toEqual({ ok: true, text: '6 criteria · average' });
    expect(barLine([], SUM).text).toBe('No criteria yet');
  });
  it('the formula and the examples speak the mode', () => {
    expect(formulaText(THREE, SUM)).toBe('Final score = the sum of the points of every criterion (at most 15 points)');
    expect(formulaText(THREE, AVG)).toContain('the average of the criteria on a 1–5 scale');
    expect(formulaText([crit('a', 1, 5), crit('b', 1, 10)], AVG)).toContain('each score converted to % of its own scale first');
    expect(exampleGrades(THREE, SUM).map((e) => gradeText(e.grade))).toEqual(['15 / 15 points', '9 / 15 points', '3 / 15 points']);
  });
  it('the settings carry the mode; an unknown value is refused and nothing means weighted', () => {
    expect(parseSettingsPayload({})).toMatchObject({ ok: true, settings: { scoringMode: 'weighted', equalAggregation: 'sum' } });
    expect(parseSettingsPayload({ scoringMode: 'equal', equalAggregation: 'average' })).toMatchObject({ ok: true, settings: { scoringMode: 'equal', equalAggregation: 'average' } });
    expect(parseSettingsPayload({ scoringMode: 'whatever' })).toMatchObject({ ok: false });
    expect(parseSettingsPayload({ equalAggregation: 'median' })).toMatchObject({ ok: false });
  });
});

describe('the score in the unit of the call (the board, the exports)', () => {
  it('a position on 0–100 is read back in points, on the scale, or in %', () => {
    expect(scoreText(75, THREE, SUM)).toBe('12 / 15 points');
    expect(scoreText(75, THREE, AVG)).toBe('4.0 / 5');
    expect(scoreText(65.28, [crit('a', 1, 5), crit('b', 1, 10)], AVG)).toBe('65.3 %');
    expect(scoreText(72.5, THREE, W)).toBe('72.5 %');
    expect(scoreText(null, THREE, SUM)).toBe('N/A');
    expect(scoreNumber(50, THREE, SUM)).toBe(9);
    expect(scoreNumber(50, THREE, AVG)).toBe(3);
    expect(scoreNumber(50, THREE, W)).toBe(50);
    expect(scoreNumber(null, THREE, SUM)).toBe('');
  });
  it('the export names its unit: points, the scale or %', () => {
    const rows = [{ rank: 1, reference: 'R1', startupName: 'S', submitted: 2, assigned: 2, average: 75, deviation: 0, perCriterion: [], divergence: [], below: [], gridVersions: [1], decision: null, autoCriteria: [], overrides: [] }] as never;
    expect(boardTable(rows, THREE, SUM).header).toContain('Average score (points)');
    expect(boardTable(rows, THREE, SUM).body[0][5]).toBe(12);
    expect(boardTable(rows, THREE, AVG).header).toContain('Average score (scale)');
    expect(boardTable(rows, THREE, W).header).toContain('Average grade (%)');
    expect(boardTable(rows, [crit('a', 1, 5), crit('b', 1, 10)], AVG).header).toContain('Average grade (%)');
  });
  it('the divergence of the total is worked out the same way the final score is', () => {
    const crits = [crit('a', 1, 5), crit('b', 1, 5, 0, { auto: { fieldId: 'f', kind: 'yes_no', options: {}, yes: 5, no: 1, ranges: [], multi: 'sum', override: false } })];
    const ev = (u: string, a: number) => ({ applicationId: 'a1', evaluatorUserId: u, status: 'submitted' as const, gridVersion: 1, gradePercent: 50, scores: { a, b: 3 }, sources: { a: 'manual' as const, b: 'auto' as const }, autoValues: { b: 3 } });
    const input = (scoring: Scoring): BoardInput => ({ apps: [{ applicationId: 'a1', reference: 'R', startupName: null }], evaluations: [ev('u1', 1), ev('u2', 5)], assignments: [{ applicationId: 'a1', userId: 'u1' }, { applicationId: 'a1', userId: 'u2' }], criteriaByVersion: { 1: crits }, currentVersion: 1, divergence: { enabled: true, scalePct: 90, totalPct: 20 }, decisions: {}, scoring });
    for (const s of [SUM, AVG]) expect(computeBoard(input(s)).rows[0].divergence.map((d) => d.kind)).toContain('total');       // only the hand-scored criterion counts: 1 vs 5 on a 1–5 scale is 100 % apart
  });
});
