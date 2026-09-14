// Prompt 681 §4 — what dropping a Pipeline row onto one of the six taxonomy
// cards means. Same gesture/mechanics as the founder side's pipeline-drop.ts
// (confirm-before-apply, an 8s Undo), but the destinations and what they
// commit are different: the founder drops onto Frozen/Passed and this module
// writes nothing itself — a confirmed drop always calls the SAME action
// (`act`/`archiveManually`) the existing buttons already call. The drag is
// an alternate path to that action, never a new one.
import type { InvestorPipelineCardKey } from './investor-pipeline-taxonomy';

// Only these three cards accept a drop — the other three (New, Evaluating,
// Due diligence) are not destinations you can drag INTO (§4's own table:
// each shows a message and does nothing on drop). Passed/Archived rows
// aren't draggable AT ALL (the Pass is final; reopening an archive is a
// deliberate menu action) — that's enforced by the caller deciding which
// rows start a drag, not by this predicate.
export type InvestorDropTarget = 'interested' | 'passed' | 'archived';

export function investorDropTargetAccepts(view: string | null | undefined): view is InvestorDropTarget {
  return view === 'interested' || view === 'passed' || view === 'archived';
}

// The three non-destination cards' door message, verbatim from §4's table.
export const NON_DROP_TARGET_MESSAGE: Partial<Record<InvestorPipelineCardKey, string>> = {
  new: "Can't move back to New — withdraw interest from the dossier",
  evaluating: 'Start evaluating from the dossier (scorecard, notes)',
  due_diligence: 'Access is granted by the founder — request it from the dossier',
};

export const DROP_TARGET_INTERIOR: Record<InvestorDropTarget, string> = {
  interested: 'Drop to express interest',
  passed: 'Drop to pass',
  archived: 'Drop to archive',
};

// §4 — 8s Undo window, same duration the founder side uses.
export const UNDO_WINDOW_MS = 8000;
