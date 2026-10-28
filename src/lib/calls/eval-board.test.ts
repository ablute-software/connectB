// Prompt 922 (I4) — the consolidation, pure: progress, ranking by weighted average (ties share a rank; no grade = not ranked), the average of each criterion, the deviation, the divergence between evaluators
// (relative to the scale, per criterion and in total, only on the same grid version, switchable), the eliminatory minimum, the decision, and an export that never carries a comment and cannot be read as a formula.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Criterion } from './eval-grid';
import { boardCsv, boardTable, computeBoard, safeCell, type BoardEval, type BoardInput } from './eval-board';

const crit = (id: string, name: string, weight: number, min: number, max: number, minScore: number | null = null): Criterion => ({ id, section: null, position: 0, name, guidance: '', weight, format: 'scale', scaleMin: min, scaleMax: max, levels: [], commentRequired: false, minScore });
const V1 = [crit('t', 'Team', 50, 1, 5, 2), crit('m', 'Market', 50, 0, 10)];
const ev = (applicationId: string, who: string, scores: Record<string, number>, grade: number, status: 'submitted' | 'in_progress' = 'submitted', gridVersion = 1): BoardEval => ({ applicationId, evaluatorUserId: who, status, gridVersion, gradePercent: grade, scores });
const base = (over: Partial<BoardInput> = {}): BoardInput => ({
  apps: [{ applicationId: 'a', reference: 'REF-A', startupName: 'Acme' }, { applicationId: 'b', reference: 'REF-B', startupName: 'Blue' }, { applicationId: 'c', reference: 'REF-C', startupName: 'Cyan' }, { applicationId: 'd', reference: 'REF-D', startupName: null }],
  evaluations: [], assignments: [], criteriaByVersion: { 1: V1 }, currentVersion: 1, divergence: { enabled: true, scalePct: 40, totalPct: 20 }, decisions: {}, ...over,
});
const asg = (a: string, ...u: string[]) => u.map((userId) => ({ applicationId: a, userId }));

describe('progress and state', () => {
  it('unassigned, not started, in progress and complete — and the totals', () => {
    const { rows, progress } = computeBoard(base({
      assignments: [...asg('a', 'u1', 'u2'), ...asg('b', 'u1', 'u2'), ...asg('c', 'u1')],
      evaluations: [ev('a', 'u1', { t: 5, m: 10 }, 100), ev('a', 'u2', { t: 4, m: 8 }, 80), ev('b', 'u1', { t: 3, m: 5 }, 50), ev('b', 'u2', { t: 3 }, 0, 'in_progress')],
    }));
    const by = Object.fromEntries(rows.map((r) => [r.applicationId, r]));
    expect([by.a.state, by.b.state, by.c.state, by.d.state]).toEqual(['complete', 'in_progress', 'not_started', 'unassigned']);
    expect(progress).toEqual({ applications: 4, assigned: 5, started: 4, submitted: 3, complete: 1, unassigned: 1, decided: 0 });
    expect(by.a).toMatchObject({ assigned: 2, started: 2, submitted: 2 });
  });
});

describe('the ranking', () => {
  it('by the average of the submitted grades, best first; an in-progress evaluation never counts; ties share a rank (1, 2, 2, 4); no grade = not ranked, listed after', () => {
    const { rows } = computeBoard(base({
      apps: [...base().apps, { applicationId: 'e', reference: 'REF-E', startupName: null }],
      assignments: [...asg('a', 'u1'), ...asg('b', 'u1'), ...asg('c', 'u1'), ...asg('d', 'u1'), ...asg('e', 'u1')],
      evaluations: [ev('a', 'u1', { t: 5, m: 10 }, 90), ev('b', 'u1', { t: 4, m: 8 }, 70), ev('c', 'u1', { t: 4, m: 8 }, 70), ev('d', 'u1', { t: 1, m: 0 }, 10), ev('e', 'u1', { t: 5 }, 99, 'in_progress')],
    }));
    expect(rows.map((r) => [r.reference, r.rank, r.average])).toEqual([['REF-A', 1, 90], ['REF-B', 2, 70], ['REF-C', 2, 70], ['REF-D', 4, 10], ['REF-E', null, null]]);
  });
  it('the average and the deviation of several evaluators (population deviation); one evaluator has no deviation', () => {
    const { rows } = computeBoard(base({ assignments: asg('a', 'u1', 'u2', 'u3'), evaluations: [ev('a', 'u1', { t: 5, m: 10 }, 100), ev('a', 'u2', { t: 3, m: 5 }, 50), ev('a', 'u3', { t: 4, m: 8 }, 75)] }));
    expect(rows[0]).toMatchObject({ average: 75, deviation: 20.41 });
    expect(computeBoard(base({ evaluations: [ev('a', 'u1', { t: 5, m: 10 }, 88.5)] })).rows[0]).toMatchObject({ average: 88.5, deviation: null });
  });
});

describe('the average of each criterion', () => {
  it('on the grid in force, over the evaluations made on that version, as a score and as a percentage of the scale', () => {
    const { rows } = computeBoard(base({ evaluations: [ev('a', 'u1', { t: 5, m: 10 }, 100), ev('a', 'u2', { t: 3, m: 5 }, 50)] }));
    expect(rows[0].perCriterion).toEqual([{ criterionId: 't', name: 'Team', average: 4, percent: 75, count: 2 }, { criterionId: 'm', name: 'Market', average: 7.5, percent: 75, count: 2 }]);
  });
  it('an evaluation on an OLDER grid version is not mixed into the current criteria; the versions that were used are listed', () => {
    const v2 = [crit('t2', 'Team v2', 100, 1, 3)];
    const { rows } = computeBoard(base({ criteriaByVersion: { 1: V1, 2: v2 }, currentVersion: 2, evaluations: [ev('a', 'u1', { t: 5, m: 10 }, 100, 'submitted', 1), ev('a', 'u2', { t2: 3 }, 100, 'submitted', 2)] }));
    expect(rows[0].perCriterion).toEqual([{ criterionId: 't2', name: 'Team v2', average: 3, percent: 100, count: 1 }]);
    expect(rows[0].gridVersions).toEqual([1, 2]);
    expect(rows[0].divergence).toEqual([]);                                                       // different versions are never compared
  });
});

describe('divergence — a flag relative to the scale, never a change to a score', () => {
  const two = (a: Record<string, number>, ga: number, b: Record<string, number>, gb: number, divergence = { enabled: true, scalePct: 40, totalPct: 20 }) =>
    computeBoard(base({ divergence, evaluations: [ev('a', 'u1', a, ga), ev('a', 'u2', b, gb)] })).rows[0];
  it('flags a criterion when two evaluators are ≥ 40 % of the scale apart (2 points on 1–5, 4 on 0–10) and the total when ≥ 20 points apart', () => {
    const r = two({ t: 5, m: 10 }, 100, { t: 3, m: 6 }, 60);
    expect(r.divergence).toEqual([{ criterionId: 't', name: 'Team', range: 2, limit: 1.6, kind: 'criterion' }, { criterionId: 'm', name: 'Market', range: 4, limit: 4, kind: 'criterion' }, { criterionId: null, name: 'Total', range: 40, limit: 20, kind: 'total' }]);
  });
  it('close scores are not flagged: 1 point on 1–5 (25 %), 3 on 0–10 (30 %), 10 points in total', () => {
    expect(two({ t: 4, m: 8 }, 80, { t: 3, m: 5 }, 70).divergence).toEqual([]);
  });
  it('the limits are the entity\'s: a stricter one flags more, a lax one nothing; switched off, nothing at all; one evaluator cannot diverge', () => {
    expect(two({ t: 4, m: 8 }, 80, { t: 3, m: 5 }, 70, { enabled: true, scalePct: 20, totalPct: 5 }).divergence.map((d) => d.kind)).toEqual(['criterion', 'criterion', 'total']);
    expect(two({ t: 5, m: 10 }, 100, { t: 1, m: 0 }, 0, { enabled: true, scalePct: 100, totalPct: 100 }).divergence.map((d) => d.kind)).toEqual(['criterion', 'criterion', 'total']);
    expect(two({ t: 5, m: 10 }, 100, { t: 1, m: 0 }, 0, { enabled: false, scalePct: 40, totalPct: 20 }).divergence).toEqual([]);
    expect(computeBoard(base({ evaluations: [ev('a', 'u1', { t: 5, m: 10 }, 100)] })).rows[0].divergence).toEqual([]);
    expect(DEFAULT_SETTINGS.divergence).toEqual({ enabled: true, scalePct: 40, totalPct: 20 });
  });
  it('the scores themselves are untouched by the flag', () => {
    const r = two({ t: 5, m: 10 }, 100, { t: 1, m: 0 }, 0);
    expect(r.average).toBe(50);
    expect(r.perCriterion.map((p) => p.average)).toEqual([3, 5]);
  });
});

describe('the eliminatory minimum and the decision', () => {
  it('counts how many evaluators scored below the minimum of a criterion; it only flags — the application keeps its rank', () => {
    const { rows } = computeBoard(base({ evaluations: [ev('a', 'u1', { t: 1, m: 10 }, 55), ev('a', 'u2', { t: 1, m: 10 }, 55), ev('a', 'u3', { t: 4, m: 10 }, 85)] }));
    expect(rows[0].below).toEqual([{ criterionId: 't', name: 'Team', min: 2, evaluators: 2 }]);
    expect(rows[0].rank).toBe(1);
  });
  it('carries the current decision and counts the decided applications', () => {
    const { rows, progress } = computeBoard(base({ decisions: { a: { decision: 'advance', note: 'Strong fit' }, c: { decision: 'waitlist', note: null } }, evaluations: [ev('a', 'u1', { t: 5, m: 10 }, 100)] }));
    expect(rows.find((r) => r.applicationId === 'a')!.decision).toEqual({ decision: 'advance', note: 'Strong fit' });
    expect(progress.decided).toBe(2);
  });
});

describe('the export', () => {
  const { rows } = computeBoard(base({ decisions: { a: { decision: 'advance', note: '=HYPERLINK("http://evil")' } }, assignments: asg('a', 'u1', 'u2'), evaluations: [ev('a', 'u1', { t: 5, m: 10 }, 100), ev('a', 'u2', { t: 1, m: 0 }, 0)] }));
  it('one row per application with the average of each criterion, the flags and the decision — and NOT ONE comment', () => {
    const t = boardTable(rows, V1);
    expect(t.header).toEqual(['Rank', 'Reference', 'Startup', 'Evaluations submitted', 'Evaluations expected', 'Average grade (%)', 'Deviation', 'Team (average score)', 'Market (average score)', 'Divergence', 'Below minimum', 'Grid version', 'Decision', 'Decision note']);
    expect(t.body[0].slice(0, 9)).toEqual([1, 'REF-A', 'Acme', 2, 2, 50, 50, 3, 5]);
    expect(t.body[0][9]).toContain('Team: 4 points apart');
    expect(t.body[0][10]).toBe('Team (1 evaluator below 2)');
    expect(t.header.join(' ').toLowerCase()).not.toContain('comment');
    expect(t.header.join(' ').toLowerCase()).not.toContain('note for');
  });
  it('a cell that a spreadsheet would read as a formula is kept as text; separators and quotes are escaped; a BOM and semicolons for Excel', () => {
    expect(safeCell('=1+1')).toBe("'=1+1"); expect(safeCell('+3')).toBe("'+3"); expect(safeCell('-2')).toBe("'-2"); expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)"); expect(safeCell('plain')).toBe('plain'); expect(safeCell(null)).toBe('');
    const csv = boardCsv(rows, V1);
    expect(csv.startsWith('﻿Rank;Reference;')).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csv.split('\r\n')).toHaveLength(6);                                                    // header + 4 applications + the closing line break
  });
});
