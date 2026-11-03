// Prompt 922 (I1) — what the "Evaluation grid" step shows, built in one place (pure): the criteria, the live sum of the weights, what is wrong, the formula in words and the examples worked out, the settings,
// and how the grid can be changed now (in place, locked, frozen with versions) — read by the route and the tests alike.
import { barLine, exampleGrades, formulaText, gridProblems, scoringOf, weightsLine, type Criterion, type Grade, type GridSettings } from './eval-grid';
import { linkableFields, type LinkableField } from './eval-links';
import type { CallStatus, FormField } from './types';

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
  /** Prompt 922, Adenda 3: how the criteria are combined can no longer change once results were published; what the bar says (weights, or "6 criteria · max 30 points"). */
  scoringLocked: boolean; bar: { ok: boolean; text: string };
  /** The questions of the form, numbered and by page (Adenda 1, B): what a criterion can be based on, and what the side panel "Form questions" lists. */
  fields: LinkableField[];
}

export function buildGridView(input: {
  status: CallStatus; version: number; rev: number; criteria: Criterion[]; settings: GridSettings; evaluations: { started: number; submitted: number }; phases: { id: string; name: string }[]; fields?: FormField[]; scoringLocked?: boolean;
}): GridView {
  return {
    version: input.version, rev: input.rev, mode: gridMode(input.status, input.evaluations.submitted), criteria: input.criteria, settings: input.settings,
    weights: weightsLine(input.criteria), problems: gridProblems(input.criteria, input.fields, scoringOf(input.settings)), formula: formulaText(input.criteria, scoringOf(input.settings)), examples: exampleGrades(input.criteria, scoringOf(input.settings)),
    scoringLocked: input.scoringLocked === true, bar: barLine(input.criteria, scoringOf(input.settings)),
    evaluations: input.evaluations, settingsLocked: input.evaluations.started > 0, phases: input.phases, fields: linkableFields(input.fields ?? []),
  };
}
