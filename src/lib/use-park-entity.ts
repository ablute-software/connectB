'use client';

// Prompt 527 — one place that knows what "park this investor" means.
//
// The whole flow already existed and worked; it was just unreachable from
// anywhere except the entity dossier. applyPlan lived as a local function
// inside RelationshipSummaryCard.tsx (lines 190-211), so the Today panel and
// the reawakening card — the two screens where the founder actually meets
// Sherlock's suggestions — had no way to call it without copying it.
// Duplicating it would have been the fourth copy of a decision this codebase
// deliberately keeps in one pure module (exit-effects.ts). So it moved here,
// unchanged in behaviour, and gained the one thing it was missing.
//
// What it was missing: a record. journey.ts:108-116 already documented the
// gap in as many words — neither the Frozen/Cold menu nor the propose_dormant
// automation logged anything, so a founder could decline advice and later
// find no trace that a decision had been made. Every caller of this hook now
// writes that note, including the dossier menu that has had the gap longest.
import { useStore } from './store';
import {
  dismissDormantReason, dismissNoteContent, planPark,
  type DismissSource, type ExitPlan,
} from './exit-effects';
import type { Entity } from './types';

export function useParkEntity() {
  const { db, setEntityStatus, addTask, toggleTask, updateTask, logSystemNote } = useStore();

  // Verbatim the applyPlan that lived in RelationshipSummaryCard, including
  // the revisit-task-first ordering (so the "Next:" line picks it up in the
  // same render) and Prompt 269's appending of each auto-close reason onto
  // the task's own notes without overwriting a founder's note.
  function applyPlan(entityId: string, plan: ExitPlan): string {
    if (plan.revisitTask) {
      addTask({
        title: plan.revisitTask.title, due_at: plan.revisitTask.dueAt,
        entity_id: entityId, kind: 'follow_up', action_type: 'other', source: 'suggested',
      });
    }
    for (const d of plan.dispositions) {
      if (d.action === 'done') {
        toggleTask(d.taskId);
        const existing = db.tasks.find((t) => t.id === d.taskId)?.notes;
        updateTask(d.taskId, { notes: existing ? `${existing}\n\n${d.reason}` : d.reason });
      } else {
        updateTask(d.taskId, { due_at: d.dueAt });
      }
    }
    return plan.confirmation;
  }

  /**
   * Park an ACTIVE investor: mark it dormant, resolve its open tasks through
   * planPark, and record why. Returns the confirmation line to show.
   *
   * `dormantReason` is optional so the dossier menu keeps its own wording
   * ("Cold — no reply" / "Frozen — no continuity"); a dismissal from Today
   * has no such context and falls back to naming the dismissal itself.
   */
  function parkEntity(opts: {
    entity: Pick<Entity, 'id' | 'name'>;
    source: DismissSource;
    dormantReason?: string;
    now?: Date;
  }): string {
    const now = opts.now ?? new Date();
    // The note goes first so it is timestamped before the revisit task this
    // same action creates — a history that reads in the order things happened.
    logSystemNote(opts.entity.id, dismissNoteContent(opts.source, now));
    setEntityStatus(opts.entity.id, 'dormant', opts.dormantReason ?? dismissDormantReason(now));
    return applyPlan(opts.entity.id, planPark(opts.entity, db.tasks, now));
  }

  /**
   * Record a dismissal WITHOUT parking: the reawakening card, where the
   * entity is already dormant. Calling setEntityStatus again there would
   * overwrite dormant_since and make the history claim a second state change
   * that never happened.
   */
  function logDismiss(entityId: string, source: DismissSource, now: Date = new Date()): void {
    logSystemNote(entityId, dismissNoteContent(source, now));
  }

  return { parkEntity, logDismiss, applyPlan };
}
