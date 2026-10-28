// Prompt 922 (I1) — what the "Evaluation grid" step shows, built in one place (pure): the criteria, the live sum of the weights, what is wrong, the formula in words and the examples worked out, the settings,
// and how the grid can be changed now (in place, locked, frozen with versions) — read by the route and the tests alike.
import { exampleGrades, formulaText, gridProblems, weightsLine, type Criterion, type Grade, type GridSettings } from './eval-grid';
import type { CallStatus } from './types';

/**
 *   edit       the grid is edited in place (the call is a draft, or it is open but no evaluation was SUBMITTED yet);
 *   locked     confirmed or scheduled: like the form ("Edit configuration" first);
 *   versioned  an evaluation was submitted: the grid is FROZEN — a change makes a new version (the evaluations keep theirs) and asks first;
 *   archived   nothing changes.
 */
export type GridMode = 'edit' | 'locked' | 'versioned' | 'archived';
export function gridMode(status: CallStatus, submittedEvaluations: number): GridMode {
  if (status === 'archived') return 'archived';
  if (status === 'validated' || status === 'scheduled') return 'locked';
  if (submittedEvaluations > 0) return 'versioned';
  return 'edit';
}

export interface GridView {
  version: number; rev: number; mode: GridMode;
  criteria: Criterion[];
  settings: GridSettings;
  weights: { ok: boolean; sum: number; text: string };
  problems: string[];
  formula: string;
  examples: { label: string; grade: Grade }[];
  /** Evaluations that exist (started, submitted): what freezes the grid and what locks the blind option. */
  evaluations: { started: number; submitted: number };
  /** The blind option and "comment required for all" cannot change once an evaluation exists. */
  settingsLocked: boolean;
  phases: { id: string; name: string }[];
}

export function buildGridView(input: {
  status: CallStatus; version: number; rev: number; criteria: Criterion[]; settings: GridSettings; evaluations: { started: number; submitted: number }; phases: { id: string; name: string }[];
}): GridView {
  return {
    version: input.version, rev: input.rev, mode: gridMode(input.status, input.evaluations.submitted), criteria: input.criteria, settings: input.settings,
    weights: weightsLine(input.criteria), problems: gridProblems(input.criteria), formula: formulaText(input.criteria), examples: exampleGrades(input.criteria),
    evaluations: input.evaluations, settingsLocked: input.evaluations.started > 0, phases: input.phases,
  };
}
