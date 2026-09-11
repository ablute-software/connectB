'use client';
// Prompt 883 §3 — the three actions on the automation's "Decide: mark
// {entity} dormant" task, in Actions Required's own Confirmation card.
//
// Deliberately a separate hook from useParkEntity(), not an extra branch
// on it: Confirm needs its own honestly-labeled note/reason (not the
// "Dismissed…" copy dismissNoteContent/dismissDormantReason produce for
// every other park path — the founder here is AGREEING with the
// proposal, the opposite of what "Dismissed" says), and Decline/Dismiss
// have no equivalent there at all. Confirm's own effects are exactly what
// the prompt names — setEntityStatus + logSystemNote — plus closing this
// one task via toggleTask, the same closing mechanism applyPlan uses for
// every other disposition; it does NOT run planPark's own disposition
// loop over the entity's OTHER pending tasks (no revisit task, no
// rescheduling), which the prompt never asked for and which would risk
// double-toggling this same task (its title contains "no reply", which
// planPark's answersByParking regex already matches on "reply").
import { useStore } from './store';
import {
  dormantConfirmationNoteContent, dormantConfirmationReason, dormantDeclineNoteContent,
} from './exit-effects';

export interface DormantConfirmationTarget {
  taskId: string;
  entityId: string;
}

export function useDormantConfirmation() {
  const { setEntityStatus, toggleTask, logSystemNote, updateEntity, updateTask } = useStore();

  // Confirm — the real decision to accept the automation's suggestion.
  function confirmDormant(target: DormantConfirmationTarget, now: Date = new Date()): void {
    // Note first, same ordering as useParkEntity.parkEntity: timestamped
    // before the status change it explains, so the history reads in the
    // order things happened.
    logSystemNote(target.entityId, dormantConfirmationNoteContent(now));
    setEntityStatus(target.entityId, 'dormant', dormantConfirmationReason(now));
    toggleTask(target.taskId);
  }

  // Decline — rejects the proposal. No entity-status effect; the note is
  // the only record this decision leaves. dormant_decline_at is read by
  // automation-rules-tick.ts to suppress re-proposing the identical
  // decision for 6 months (migration 0351).
  function declineDormant(target: DormantConfirmationTarget, now: Date = new Date()): void {
    logSystemNote(target.entityId, dormantDeclineNoteContent(now));
    updateEntity(target.entityId, { dormant_decline_at: now.toISOString() });
    toggleTask(target.taskId);
  }

  // Dismiss — Nuno's own definition, verbatim: "an option to simply not
  // appear there anymore." No note, no entity effect, no automation
  // effect — `done` stays false, so hasOpenDormant keeps suppressing a
  // duplicate task; only founderActionsRequired()'s own filter changes.
  function dismissDormant(target: Pick<DormantConfirmationTarget, 'taskId'>, now: Date = new Date()): void {
    updateTask(target.taskId, { confirmation_dismissed_at: now.toISOString() });
  }

  return { confirmDormant, declineDormant, dismissDormant };
}
