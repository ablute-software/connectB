// Prompt 922 (I4) — the consolidation of the evaluation, pure: from the evaluations that exist it builds the board the administrator reads — progress, the ranking by weighted average, the average of each
// criterion, the divergence between evaluators, who scored below an eliminatory minimum, and the decision — and the table that is exported. Nothing here changes a score or decides anything: a flag is a
// flag. The ranking only reads SUBMITTED evaluations; an evaluation in progress counts as progress, never as a grade.
import { belowMinimum, type Criterion, type GridSettings } from './eval-grid';

export type Decision = 'advance' | 'reject' | 'waitlist';
export const DECISION_LABEL: Record<Decision, string> = { advance: 'Advance', reject: 'Reject', waitlist: 'Waitlist' };

export interface BoardApp { applicationId: string; reference: string | null; startupName: string | null }
export interface BoardEval { applicationId: string; evaluatorUserId: string; status: 'in_progress' | 'submitted'; gridVersion: number; gradePercent: number | null; scores: Record<string, number | null> }
export interface BoardInput {
  apps: BoardApp[]; evaluations: BoardEval[]; assignments: { applicationId: string; userId: string }[];
  criteriaByVersion: Record<number, Criterion[]>; currentVersion: number; divergence: GridSettings['divergence'];
  decisions: Record<string, { decision: Decision; note: string | null }>;
}

export interface DivergenceFlag { criterionId: string | null; name: string; range: number; limit: number; kind: 'criterion' | 'total' }
export interface BoardRow {
  applicationId: string; reference: string | null; startupName: string | null;
  state: 'unassigned' | 'not_started' | 'in_progress' | 'complete';
  assigned: number; started: number; submitted: number;
  average: number | null; deviation: number | null; rank: number | null;
  perCriterion: { criterionId: string; name: string; average: number; percent: number; count: number }[];
  divergence: DivergenceFlag[];
  below: { criterionId: string; name: string; min: number; evaluators: number }[];
  gridVersions: number[];
  decision: { decision: Decision; note: string | null } | null;
}
export interface BoardProgress { applications: number; assigned: number; started: number; submitted: number; complete: number; unassigned: number; decided: number }

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs: number[]): number => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

export function computeBoard(input: BoardInput): { rows: BoardRow[]; progress: BoardProgress } {
  const current = input.criteriaByVersion[input.currentVersion] ?? [];
  const rows: BoardRow[] = input.apps.map((a) => {
    const asg = input.assignments.filter((x) => x.applicationId === a.applicationId);
    const evs = input.evaluations.filter((e) => e.applicationId === a.applicationId);
    const submitted = evs.filter((e) => e.status === 'submitted');
    const grades = submitted.map((e) => e.gradePercent).filter((g): g is number => typeof g === 'number');
    const state: BoardRow['state'] = asg.length === 0 && evs.length === 0 ? 'unassigned' : submitted.length > 0 && submitted.length >= Math.max(asg.length, 1) ? 'complete' : evs.length > 0 ? 'in_progress' : 'not_started';

    // The average of each criterion of the grid IN FORCE, over the evaluations made on that version.
    const onCurrent = submitted.filter((e) => e.gridVersion === input.currentVersion);
    const perCriterion = current.map((c) => {
      const xs = onCurrent.map((e) => e.scores[c.id]).filter((s): s is number => typeof s === 'number');
      return xs.length ? { criterionId: c.id, name: c.name, average: round(mean(xs)), percent: round(((mean(xs) - c.scaleMin) / (c.scaleMax - c.scaleMin)) * 100), count: xs.length } : null;
    }).filter((x): x is NonNullable<typeof x> => x !== null);

    // Divergence: only between evaluations on the SAME grid version (the criteria are the same), and only when the entity left it on. It never changes a score.
    const divergence: DivergenceFlag[] = [];
    if (input.divergence.enabled) {
      for (const v of [...new Set(submitted.map((e) => e.gridVersion))]) {
        const same = submitted.filter((e) => e.gridVersion === v);
        if (same.length < 2) continue;
        for (const c of input.criteriaByVersion[v] ?? []) {
          const xs = same.map((e) => e.scores[c.id]).filter((s): s is number => typeof s === 'number');
          if (xs.length < 2) continue;
          const range = Math.max(...xs) - Math.min(...xs); const amplitude = c.scaleMax - c.scaleMin;
          if (amplitude > 0 && (range / amplitude) * 100 >= input.divergence.scalePct) divergence.push({ criterionId: c.id, name: c.name, range, limit: round((input.divergence.scalePct / 100) * amplitude), kind: 'criterion' });
        }
        const gs = same.map((e) => e.gradePercent).filter((g): g is number => typeof g === 'number');
        if (gs.length >= 2) { const range = round(Math.max(...gs) - Math.min(...gs)); if (range >= input.divergence.totalPct) divergence.push({ criterionId: null, name: 'Total', range, limit: input.divergence.totalPct, kind: 'total' }); }
      }
    }

    // Below an eliminatory minimum: counted per criterion across the submitted evaluations. A flag, never an exclusion.
    const belowMap = new Map<string, { criterionId: string; name: string; min: number; evaluators: number }>();
    for (const e of submitted) for (const b of belowMinimum(input.criteriaByVersion[e.gridVersion] ?? [], e.scores)) {
      const cur = belowMap.get(b.id) ?? { criterionId: b.id, name: b.name, min: b.min, evaluators: 0 }; cur.evaluators++; belowMap.set(b.id, cur);
    }
    return {
      applicationId: a.applicationId, reference: a.reference, startupName: a.startupName, state,
      assigned: asg.length, started: evs.length, submitted: submitted.length,
      average: grades.length ? round(mean(grades)) : null, deviation: grades.length >= 2 ? round(stdev(grades)) : null, rank: null,
      perCriterion, divergence, below: [...belowMap.values()], gridVersions: [...new Set(submitted.map((e) => e.gridVersion))].sort((x, y) => x - y),
      decision: input.decisions[a.applicationId] ?? null,
    };
  });

  // Ranking: by average, best first; equal averages share a rank (1, 2, 2, 4); no grade yet = not ranked, listed after.
  const ranked = rows.filter((r) => r.average !== null).sort((a, b) => (b.average as number) - (a.average as number) || ((a.reference ?? a.applicationId) < (b.reference ?? b.applicationId) ? -1 : 1));
  ranked.forEach((r, i) => { r.rank = i > 0 && r.average === ranked[i - 1].average ? ranked[i - 1].rank : i + 1; });
  const unranked = rows.filter((r) => r.average === null).sort((a, b) => ((a.reference ?? a.applicationId) < (b.reference ?? b.applicationId) ? -1 : 1));
  const ordered = [...ranked, ...unranked];
  return {
    rows: ordered,
    progress: {
      applications: rows.length, assigned: rows.reduce((n, r) => n + r.assigned, 0), started: rows.reduce((n, r) => n + r.started, 0), submitted: rows.reduce((n, r) => n + r.submitted, 0),
      complete: rows.filter((r) => r.state === 'complete').length, unassigned: rows.filter((r) => r.state === 'unassigned').length, decided: rows.filter((r) => r.decision).length,
    },
  };
}

// --- The export ------------------------------------------------------------------------------------------------------------------------------------------

/** A cell that starts with = + - @ would be read as a formula by a spreadsheet: a leading apostrophe keeps it text (the usual defence against CSV injection). */
export const safeCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
const csvCell = (v: unknown): string => { const s = safeCell(v); return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * The table that is exported: one row per application — rank, reference, startup, how many evaluations, the average, the deviation, the average of each criterion, the flags and the decision. NEVER a comment:
 * not the evaluators' comments per criterion, not the general ones, not the private notes (those stay in the platform, read by administrators).
 */
export function boardTable(rows: BoardRow[], criteria: Pick<Criterion, 'id' | 'name'>[]): { header: string[]; body: (string | number)[][] } {
  const header = ['Rank', 'Reference', 'Startup', 'Evaluations submitted', 'Evaluations expected', 'Average grade (%)', 'Deviation', ...criteria.map((c) => `${c.name} (average score)`), 'Divergence', 'Below minimum', 'Grid version', 'Decision', 'Decision note'];
  const body = rows.map((r) => [
    r.rank ?? '', r.reference ?? '', r.startupName ?? '', r.submitted, r.assigned, r.average ?? '', r.deviation ?? '',
    ...criteria.map((c) => r.perCriterion.find((p) => p.criterionId === c.id)?.average ?? ''),
    r.divergence.map((d) => (d.kind === 'total' ? `Total: ${d.range} points apart` : `${d.name}: ${d.range} points apart`)).join('; '),
    r.below.map((b) => `${b.name} (${b.evaluators} evaluator${b.evaluators === 1 ? '' : 's'} below ${b.min})`).join('; '),
    r.gridVersions.join(', '), r.decision ? DECISION_LABEL[r.decision.decision] : '', r.decision?.note ?? '',
  ]);
  return { header, body };
}
export function boardCsv(rows: BoardRow[], criteria: Pick<Criterion, 'id' | 'name'>[]): string {
  const { header, body } = boardTable(rows, criteria);
  return `﻿${[header, ...body].map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`;                 // BOM + semicolons: opens correctly in Excel in a Portuguese locale
}
