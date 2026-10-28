// Prompt 922 (I1) — the evaluation grid: scales 1–5, 1–10, 0–10 and custom — including criteria with DIFFERENT scales in one grid and the conversion to % in the weighted average —, the weights adding up to
// 100, the eliminatory minimum that flags and never excludes, descriptions per level and per range, and what the server refuses.
import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE_LEVELS, SCALE_PRESETS, belowMinimum, exampleGrades, formulaText, gradeText, gridProblems, levelDescription, parseCriteriaPayload, parseSettingsPayload, presetKeyOf, sameScale, scaleLevels,
  toPercent, weightedGrade, weightsLine, weightsOk, weightsSum, type Criterion,
} from './eval-grid';

const c = (id: string, weight: number, min = 1, max = 5, over: Partial<Criterion> = {}): Criterion => ({
  id, section: null, position: 0, name: `Criterion ${id}`, guidance: '', weight, format: 'scale', scaleMin: min, scaleMax: max, levels: [], commentRequired: false, minScore: null, ...over,
});

describe('the scales are chosen by the entity', () => {
  it('the shortcuts are 1–5, 1–10 and 0–10; anything else is custom; the step is always 1', () => {
    expect(SCALE_PRESETS.map((p) => p.label)).toEqual(['1–5', '1–10', '0–10']);
    expect(presetKeyOf({ scaleMin: 1, scaleMax: 5 })).toBe('1-5');
    expect(presetKeyOf({ scaleMin: 0, scaleMax: 10 })).toBe('0-10');
    expect(presetKeyOf({ scaleMin: 2, scaleMax: 8 })).toBe('custom');
    expect(scaleLevels({ scaleMin: 0, scaleMax: 4 })).toEqual([0, 1, 2, 3, 4]);
  });
  it('a score is a fraction of ITS scale: the minimum is 0 %, the maximum 100 %', () => {
    expect([toPercent(1, c('a', 100, 1, 5)), toPercent(3, c('a', 100, 1, 5)), toPercent(5, c('a', 100, 1, 5))]).toEqual([0, 50, 100]);
    expect([toPercent(0, c('a', 100, 0, 10)), toPercent(7, c('a', 100, 0, 10))]).toEqual([0, 70]);
    expect(toPercent(2, c('a', 100, 1, 10))).toBeCloseTo(11.11, 1);
  });
});

describe('the weighted average', () => {
  it('one scale 1–5: every criterion at 3 gives 3.00; Team (25 %) at 5 and the rest at 3 gives 3.50', () => {
    const grid = [c('team', 25), c('tech', 10), c('market', 40), c('fit', 25)];
    const all3 = Object.fromEntries(grid.map((x) => [x.id, 3]));
    expect(weightedGrade(grid, all3)).toMatchObject({ percent: 50, onScale: { value: 3, min: 1, max: 5 } });
    expect(weightedGrade(grid, { ...all3, team: 5 }).onScale?.value).toBe(3.5);
  });
  it('criteria with DIFFERENT scales are converted to the same base before weighting: 5/5 on a 1–5 and 5/10 on a 0–10 average 75 % at equal weight, and there is no common scale to show', () => {
    const grid = [c('a', 50, 1, 5), c('b', 50, 0, 10)];
    const g = weightedGrade(grid, { a: 5, b: 5 });
    expect(g.percent).toBe(75);
    expect(g.onScale).toBeNull();
    expect(gradeText(g)).toBe('75 %');
    expect(sameScale(grid)).toBeNull();
    expect(sameScale([c('a', 50, 1, 10), c('b', 50, 1, 10)])).toEqual({ min: 1, max: 10 });
  });
  it('1–10 and 0–10 and a custom scale give the same percentages at the same relative position', () => {
    for (const [min, max] of [[1, 10], [0, 10], [2, 8], [0, 4]]) {
      const mid = (min + max) / 2;
      const grid = [c('x', 100, min, max)];
      expect(weightedGrade(grid, { x: max }).percent).toBe(100);
      expect(weightedGrade(grid, { x: min }).percent).toBe(0);
      if (Number.isInteger(mid)) expect(weightedGrade(grid, { x: mid }).percent).toBe(50);
    }
  });
  it('an incomplete grid has NO total (empty is never zero): "N/A" until every criterion has a score', () => {
    const grid = [c('a', 50), c('b', 50)];
    expect(weightedGrade(grid, { a: 4 })).toEqual({ percent: null, onScale: null, scored: 1, total: 2 });
    expect(gradeText(weightedGrade(grid, { a: 4 }))).toBe('N/A');
    expect(weightedGrade(grid, { a: 4, b: null }).percent).toBeNull();
    expect(weightedGrade([], {}).percent).toBeNull();
  });
  it('shows the grade in % and, on a common scale, on the scale', () => {
    expect(gradeText(weightedGrade([c('a', 100, 1, 5)], { a: 4 }))).toBe('4 / 5 (75 %)');
  });
});

describe('the weights add up to 100', () => {
  it('the sum is live and says what is missing or over', () => {
    expect(weightsSum([c('a', 33.3), c('b', 33.3), c('c', 33.4)])).toBe(100);
    expect(weightsOk([c('a', 60), c('b', 40)])).toBe(true);
    expect(weightsOk([c('a', 60), c('b', 30)])).toBe(false);
    expect(weightsLine([c('a', 60), c('b', 40)])).toEqual({ ok: true, sum: 100, text: 'Sum of the weights: 100 % ✓' });
    expect(weightsLine([c('a', 60), c('b', 30)]).text).toBe('Sum of the weights: 90 % — 10 % missing');
    expect(weightsLine([c('a', 60), c('b', 50)]).text).toBe('Sum of the weights: 110 % — 10 % over');
    expect(weightsLine([]).ok).toBe(false);
  });
  it('a grid that does not add up, or has no criteria, or a criterion that counts for nothing, has problems to fix', () => {
    expect(gridProblems([])).toEqual(['The evaluation grid has no criteria.']);
    expect(gridProblems([c('a', 60), c('b', 30)])[0]).toContain('add up to 90 %');
    expect(gridProblems([c('a', 100), c('b', 0)])[0]).toContain('weight of 0 %');
    expect(gridProblems([c('a', 60), c('b', 40)])).toEqual([]);
  });
});

describe('the eliminatory minimum flags, never excludes', () => {
  it('a score below the minimum is reported; at the minimum it is not; a criterion with no minimum never is', () => {
    const grid = [c('a', 50, 1, 5, { minScore: 3, name: 'Team' }), c('b', 50, 1, 5)];
    expect(belowMinimum(grid, { a: 2, b: 1 })).toEqual([{ id: 'a', name: 'Team', score: 2, min: 3 }]);
    expect(belowMinimum(grid, { a: 3, b: 1 })).toEqual([]);
    expect(belowMinimum(grid, {})).toEqual([]);
  });
});

describe('descriptions of the levels', () => {
  it('a text for one level, or a range on a long scale ("1–3: weak")', () => {
    const k = c('a', 100, 1, 10, { levels: [{ from: 1, to: 3, text: 'weak' }, { from: 8, to: 10, text: 'strong' }, { from: 5, to: 5, text: 'average' }] });
    expect([levelDescription(k, 2), levelDescription(k, 5), levelDescription(k, 9), levelDescription(k, 4)]).toEqual(['weak', 'average', 'strong', null]);
  });
});

describe('what the server reads', () => {
  const ok = (rows: unknown[]) => parseCriteriaPayload(rows);
  const err = (rows: unknown[]) => { const r = ok(rows); return r.ok ? null : r.error; };
  it('a good grid with different scales per criterion, descriptions, comments and a minimum; the weights are NOT forced to 100 while it is being built', () => {
    const r = ok([
      { name: 'Team', weight: 25, scaleMin: 1, scaleMax: 5, levels: [{ from: 1, text: 'weak' }, { from: 5, text: 'excellent' }], commentRequired: true, minScore: 2, section: 'People', guidance: 'Look at the CVs' },
      { name: 'Technology', weight: '10', scaleMin: 0, scaleMax: 10, levels: [{ from: 0, to: 3, text: 'immature' }] },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.criteria.map((x) => [x.name, x.weight, `${x.scaleMin}-${x.scaleMax}`])).toEqual([['Team', 25, '1-5'], ['Technology', 10, '0-10']]);
    expect(r.criteria[0]).toMatchObject({ commentRequired: true, minScore: 2, section: 'People', guidance: 'Look at the CVs', format: 'scale' });
    expect(r.criteria[1].levels).toEqual([{ from: 0, to: 3, text: 'immature' }]);
    expect(new Set(r.criteria.map((x) => x.id)).size).toBe(2);
  });
  it('refuses, with a sentence: no name, a bad weight, a scale that is not a scale, too many levels, a description outside the scale, a range on a short scale, a minimum outside the scale, a format that does not exist yet', () => {
    expect(err([{ name: ' ', weight: 10, scaleMin: 1, scaleMax: 5 }])).toMatch(/give it a name/);
    expect(err([{ name: 'A', weight: 101, scaleMin: 1, scaleMax: 5 }])).toMatch(/between 0 and 100/);
    expect(err([{ name: 'A', weight: 'lots', scaleMin: 1, scaleMax: 5 }])).toMatch(/between 0 and 100/);
    expect(err([{ name: 'A', weight: 10, scaleMin: 5, scaleMax: 5 }])).toMatch(/minimum below its maximum/);
    expect(err([{ name: 'A', weight: 10, scaleMin: 0, scaleMax: MAX_SCALE_LEVELS }])).toMatch(/at most 21 levels/);
    expect(err([{ name: 'A', weight: 10, scaleMin: 1, scaleMax: 5, levels: [{ from: 6, text: 'x' }] }])).toMatch(/inside the scale 1–5/);
    expect(err([{ name: 'A', weight: 10, scaleMin: 1, scaleMax: 5, levels: [{ from: 1, to: 3, text: 'x' }] }])).toMatch(/ranges are for scales with more than 5 levels/);
    expect(err([{ name: 'A', weight: 10, scaleMin: 1, scaleMax: 5, minScore: 9 }])).toMatch(/eliminatory minimum must be inside/);
    expect(err([{ name: 'A', weight: 10, scaleMin: 1, scaleMax: 5, format: 'yes_no' }])).toMatch(/not available yet/);
    expect(err('x' as never)).toMatch(/must be a list/);
    expect(err(Array.from({ length: 61 }, () => ({})))).toMatch(/at most 60/);
  });
  it('a blank description is dropped; a repeated id gets a new one', () => {
    const dup = 'a0000000-0000-4000-8000-000000000001';
    const r = ok([{ id: dup, name: 'A', weight: 50, scaleMin: 1, scaleMax: 5, levels: [{ from: 1, text: '   ' }] }, { id: dup, name: 'B', weight: 50, scaleMin: 1, scaleMax: 5 }]);
    expect(r.ok && r.criteria[0].levels).toEqual([]);
    expect(r.ok && r.criteria[0].id).toBe(dup);
    expect(r.ok && r.criteria[1].id).not.toBe(dup);
  });
  it('the settings: 2 evaluators by default (no maximum), "all", blind off, divergence on at 40 % of the scale and 20 % in total — each can be changed', () => {
    expect(parseSettingsPayload({})).toMatchObject({ ok: true, settings: { evaluatorsPerApplication: 2, blind: false, divergence: { enabled: true, scalePct: 40, totalPct: 20 } } });
    expect(parseSettingsPayload({ evaluatorsPerApplication: 25, blind: true, divergence: { enabled: false, scalePct: 30, totalPct: 10 } })).toMatchObject({ ok: true, settings: { evaluatorsPerApplication: 25, blind: true, divergence: { enabled: false, scalePct: 30, totalPct: 10 } } });
    expect(parseSettingsPayload({ evaluatorsPerApplication: 'all' })).toMatchObject({ ok: true, settings: { evaluatorsPerApplication: 'all' } });
    expect((parseSettingsPayload({ evaluatorsPerApplication: 0 }) as { error: string }).error).toMatch(/at least 1/);
    expect((parseSettingsPayload({ divergence: { scalePct: 0 } }) as { error: string }).error).toMatch(/between 1 and 100/);
    expect((parseSettingsPayload({ deadlines: [{ phaseId: 'p1', day: 'tomorrow' }] }) as { error: string }).error).toMatch(/is a date/);
    expect((parseSettingsPayload({ deadlines: [{ phaseId: 'nope', day: '2026-12-01' }] }, ['p1']) as { error: string }).error).toMatch(/belong to a phase/);
    expect(parseSettingsPayload({ deadlines: [{ phaseId: 'p1', day: '2026-12-01' }] }, ['p1'])).toMatchObject({ ok: true, settings: { deadlines: [{ phaseId: 'p1', day: '2026-12-01' }] } });
  });
});

describe('"as the evaluator will see it"', () => {
  it('the formula in words and the examples worked out on the grid', () => {
    const grid = [c('a', 25, 1, 5, { name: 'Team' }), c('b', 75, 1, 5, { name: 'Technology' })];
    expect(formulaText(grid)).toBe('Final grade = weighted average on a 1–5 scale = Team × 25 % + Technology × 75 %');
    expect(formulaText([c('a', 50, 1, 5, { name: 'A' }), c('b', 50, 0, 10, { name: 'B' })])).toContain('each score converted to % of its own scale first');
    expect(exampleGrades(grid).map((e) => gradeText(e.grade))).toEqual(['5 / 5 (100 %)', '3 / 5 (50 %)', '1 / 5 (0 %)']);
    expect(exampleGrades([])).toEqual([]);
  });
});
