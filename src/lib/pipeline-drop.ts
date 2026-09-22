// Prompt 647 — what dragging a Pipeline row onto ❄ Frozen / ✕ Passed means.
//
// Nuno's request (2026-09-10, from two screenshots): press a row, drag it
// onto the header buttons, the button opens like a vault door, drop, confirm,
// done. Every consequence already existed and is not rebuilt here: Frozen is
// the dossier menu's park (setEntityStatus 'dormant' + planPark + the 527
// history note), Passed is the three-exit banner's pass (status + stage +
// planPass). This module writes nothing. It decides what the dialog says,
// what a confirmed drop commits and what Undo restores — pure, so
// pipeline-drop.test.ts fixes the wording and the counts, and the page only
// draws (205's discipline: decision in a pure module, execution in the
// component).
//
// §3 of the prompt left "Stale" to Nuno: is it a shelf a founder can drop a
// row on, or the alarm classifyEntityFrozenState computes ("they wrote last,
// you owe the reply")? Prompt 873 (2026-09-10 08:14 UTC) had already merged
// Stale into Frozen, so the header has no Stale button to drop on and option
// (A) — only Frozen and Passed accept a row — holds by construction.
// dropTargetAccepts keeps that rule in one place should the button return.
//
// Prompt 704 (18/09/2026) — Phase 4 (PipelineFunnel.tsx's own header already
// named it): the drop targets move onto the six funnel cards themselves, and
// three more become real — Not contacted, Contacted and Due diligence, the
// other three of the five real buckets pipeline-taxonomy.ts defines. Active
// is deliberately excluded: it "is total − passed, overlaps the buckets, is
// not a drop target, has no group" (pipeline-taxonomy.ts's own words,
// Nuno's decision, Prompt 650 v2 §1) — there is no single status a drop on a
// roll-up could mean, so it keeps refusing drops exactly as PipelineFunnel's
// header already documented ("Active refusing drops" — planned, unbuilt,
// until now). A drop on Active (or anywhere else with no data-drop-target)
// is the same "outside a valid zone" case as a drop that misses every
// target — nothing changes, the row returns to where it was.
//
// Every drop now asks for a reason, not just Passed's optional one: Nuno's
// request was explicit ("campo de razão obrigatório antes de gravar") for
// every drag-triggered status change, not only the two that already had a
// dialog. dropDialog marks every `reason` field `required: true`; confirm.tsx
// is what actually enforces it (blocks Confirm while a required field is
// empty) — this module only describes the field, same split as always.
import { dismissNoteContent, planPark, planPass, REVISIT_DAYS_DEFAULT, type ExitPlan } from './exit-effects';
import type { Entity, EntityStatus, RelationshipStage, TaskItem } from './types';
import { pipelineStageLabel } from './pipeline-taxonomy';

export type DropTarget = 'not_contacted' | 'contacted' | 'diligence' | 'passed' | 'frozen';

// Prompt 671 — the friendly destination name, same vocabulary the funnel
// cards and pipelineStageLabel already use ("Frozen", never the raw enum
// value `dormant`).
const DROP_TARGET_LABEL: Record<DropTarget, string> = {
  not_contacted: 'Not contacted', contacted: 'Contacted', diligence: 'Due diligence',
  frozen: 'Frozen', passed: 'Passed',
};

/**
 * Which funnel cards take a dropped row: the five REAL buckets
 * (pipeline-taxonomy.ts's PIPELINE_GROUPS), never the Active roll-up —
 * see this file's own Prompt 704 header for why. Reported/Stale never
 * existed as cards to begin with (277 A / Prompt 873).
 */
export function dropTargetAccepts(view: string | null | undefined): view is DropTarget {
  return view === 'not_contacted' || view === 'contacted' || view === 'diligence'
    || view === 'frozen' || view === 'passed';
}

/**
 * Prompt 712 — a per-status guard on top of dropTargetAccepts' per-card one:
 * an entity already `invested` must never be demoted to Contacted by a
 * drag — the dialog already shows the transition and requires a reason
 * (not silent), but a real investment shouldn't be reversible by a gesture
 * at all. `in_conversation` stays allowed: that one is a legitimate
 * correction (e.g. marked prematurely). The caller treats `false` exactly
 * like a drop outside any valid zone — no dialog, row returns to origin.
 */
export function dropAllowedForStatus(status: EntityStatus, target: DropTarget): boolean {
  return !(status === 'invested' && target === 'contacted');
}

/** What the open door shows, above the current count. */
export const DROP_TARGET_INTERIOR: Record<DropTarget, string> = {
  not_contacted: 'Drop to reset',
  contacted: 'Drop to mark Contacted',
  diligence: 'Drop for Due diligence',
  frozen: 'Drop to freeze',
  passed: 'Drop to pass',
};

/** §1.6 — how long the toast keeps its Undo. */
export const UNDO_WINDOW_MS = 8000;

export interface DropDialogField {
  key: 'revisit_date' | 'reason';
  label: string;
  type: 'date' | 'text';
  defaultValue?: string;
  placeholder?: string;
  min?: string;
  /** Prompt 704 — confirm.tsx blocks Confirm while this key is empty. */
  required?: boolean;
}

export interface DropDialog {
  title: string;
  message: string;
  confirmLabel: string;
  destructive: boolean;
  fields: DropDialogField[];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayPlus(now: Date, days: number): string {
  return isoDay(new Date(now.getTime() + days * 86400000));
}

function openTasks(n: number): string {
  return `${n} open task${n === 1 ? '' : 's'}`;
}

const REASON_FIELD: Record<DropTarget, DropDialogField> = {
  not_contacted: { key: 'reason', label: 'Reason', type: 'text', required: true, placeholder: 'Why reset — e.g. re-approaching after a long gap' },
  contacted: { key: 'reason', label: 'Reason', type: 'text', required: true, placeholder: 'Why mark Contacted — e.g. sent the first outreach' },
  diligence: { key: 'reason', label: 'Reason', type: 'text', required: true, placeholder: 'Why Due diligence — e.g. they asked for the data room' },
  frozen: { key: 'reason', label: 'Reason', type: 'text', required: true, placeholder: 'Why freeze — e.g. no reply, or a specific impasse' },
  passed: { key: 'reason', label: 'Reason', type: 'text', required: true, placeholder: 'What they said, or why you are closing it' },
};

/**
 * §2 — the confirmation says what will happen, not "are you sure?". The
 * counts come from the same plan the commit will apply, so the dialog tells
 * the truth rather than an estimate. Frozen carries an editable revisit date
 * (default +30 days) alongside the reason; every target carries the reason.
 *
 * Prompt 671 — the first line now states the transition explicitly, in the
 * exact friendly names the funnel cards use ("Contacted → Frozen"), never the
 * raw enum. The rest of the message is unchanged from Prompt 647 — it already
 * told the truth about consequences; it just never named the "from".
 *
 * Prompt 704 — every target now REQUIRES a reason (Nuno's explicit ask:
 * "campo de razão obrigatório antes de gravar"), where Passed's used to be
 * optional and Frozen had none at all. Three new targets (Not contacted,
 * Contacted, Due diligence) reuse the exact same confirm-with-fields shape;
 * none of them touch tasks, so there is nothing to count in their message.
 */
export function dropDialog(
  target: DropTarget, entity: Pick<Entity, 'id' | 'name' | 'status'>, tasks: TaskItem[], now: Date, revisitDays = REVISIT_DAYS_DEFAULT,
): DropDialog {
  const transition = `${pipelineStageLabel(entity.status)} → ${DROP_TARGET_LABEL[target]}.`;
  const reasonField = REASON_FIELD[target];
  if (target === 'frozen') {
    const plan = planPark(entity, tasks, now, revisitDays);
    const reDated = plan.dispositions.filter((d) => d.action === 'reschedule').length;
    const closed = plan.dispositions.filter((d) => d.action === 'done').length;
    const lines = [transition, `Parks this investor. Creates "Revisit ${entity.name}" on the date below.`];
    if (reDated > 0) lines.push(`${openTasks(reDated)} will be re-dated to that day.`);
    if (closed > 0) lines.push(`${openTasks(closed)} that asked for a reply will be closed — parking is the answer.`);
    if (reDated === 0 && closed === 0) lines.push('No open tasks to move.');
    return {
      title: `Freeze ${entity.name}?`,
      message: lines.join('\n'),
      confirmLabel: 'Freeze',
      destructive: false,
      fields: [{ key: 'revisit_date', label: 'Revisit on', type: 'date', defaultValue: dayPlus(now, revisitDays), min: dayPlus(now, 1) }, reasonField],
    };
  }
  if (target === 'passed') {
    const closed = planPass(entity, tasks).dispositions.length;
    return {
      title: `Mark ${entity.name} as passed?`,
      message: `${transition}\nCloses this relationship. ${closed > 0 ? `${openTasks(closed)} will be closed.` : 'No open tasks to close.'}`,
      confirmLabel: 'Pass',
      destructive: true,
      fields: [reasonField],
    };
  }
  const REQUALIFY_COPY: Record<'not_contacted' | 'contacted' | 'diligence', { title: string; message: string; confirmLabel: string }> = {
    not_contacted: {
      title: `Move ${entity.name} back to Not contacted?`,
      message: `${transition}\nResets outreach — this investor goes back to the top of your list, as if you hadn't reached out yet.`,
      confirmLabel: 'Reset',
    },
    contacted: {
      title: `Mark ${entity.name} as Contacted?`,
      message: `${transition}\nRecords that outreach has happened, without claiming a specific conversation stage.`,
      confirmLabel: 'Mark Contacted',
    },
    diligence: {
      title: `Move ${entity.name} to Due diligence?`,
      message: `${transition}\nMaterials under review — the investor is actively evaluating.`,
      confirmLabel: 'Move',
    },
  };
  const copy = REQUALIFY_COPY[target];
  return { ...copy, destructive: false, fields: [reasonField] };
}

/**
 * The revisit date the founder picked, as the day count planPark expects.
 * Never less than one day; an unparseable value falls back to the default
 * rather than parking someone until yesterday.
 */
export function revisitDaysFor(now: Date, chosenDay: string | undefined, fallback = REVISIT_DAYS_DEFAULT): number {
  if (!chosenDay || !/^\d{4}-\d{2}-\d{2}$/.test(chosenDay)) return fallback;
  const chosen = Date.parse(`${chosenDay}T00:00:00Z`);
  if (Number.isNaN(chosen)) return fallback;
  const today = Date.parse(`${isoDay(now)}T00:00:00Z`);
  return Math.max(1, Math.round((chosen - today) / 86400000));
}

export interface DropCommit {
  status: EntityStatus;
  /** Only a pass moves the stage: the dossier's own pass exit sets 'decision'. */
  stage?: RelationshipStage;
  dormantReason?: string;
  /** The 527 history note — written before the status, so the history reads in order. */
  note: string;
  plan: ExitPlan;
  toast: string;
}

const REQUALIFY_STATUS: Record<'not_contacted' | 'contacted' | 'diligence', EntityStatus> = {
  not_contacted: 'not_contacted', contacted: 'contacted', diligence: 'diligence',
};
const REQUALIFY_TOAST_ICON: Record<'not_contacted' | 'contacted' | 'diligence', string> = {
  not_contacted: '↺', contacted: '💬', diligence: '📄',
};

/**
 * What a confirmed drop commits. The page applies it in this order: note,
 * status, stage, plan.
 *
 * Prompt 671 §1/§2 — the note now leads with the same explicit "current →
 * new" transition the dialog showed, and, when the caller supplies one
 * (pipeline/page.tsx resolves the current session's own email), names who
 * dragged it — the founder-visible half of "who moved this to what state,
 * when" (interactions.author_user_id, set by logSystemNote, is the durable
 * half). Neither addition changes journey.ts's stageChangeAt parser: that
 * only matches the literal "stage changed to X" phrase, never used here.
 *
 * Prompt 704 — the reason is now required by the dialog (dropDialog/
 * confirm.tsx), so every note below states it plainly rather than hedging
 * with "if present". Not contacted / Contacted / Due diligence are pure
 * requalifications: no stage change (only a pass moves the stage), no task
 * disposition (nothing here is an exit) — the plan is the same empty,
 * no-op ExitPlan applyPlan already treats as a safe no-op for every other
 * caller that has nothing to apply.
 */
export function planDrop(
  target: DropTarget, entity: Pick<Entity, 'id' | 'name' | 'status'>, tasks: TaskItem[], now: Date,
  values: { revisit_date?: string; reason?: string } = {}, actorLabel?: string,
): DropCommit {
  const transition = `${pipelineStageLabel(entity.status)} → ${DROP_TARGET_LABEL[target]}`;
  const by = actorLabel ? ` — moved by ${actorLabel}` : '';
  const reason = values.reason?.trim() ?? '';
  if (target === 'frozen') {
    const plan = planPark(entity, tasks, now, revisitDaysFor(now, values.revisit_date));
    const day = plan.revisitTask ? plan.revisitTask.dueAt.slice(0, 10) : isoDay(now);
    return {
      status: 'dormant',
      dormantReason: 'Frozen — dragged from the Pipeline',
      note: `${transition}${by}. ${dismissNoteContent({ kind: 'manual', label: 'dragged onto Frozen in the Pipeline' }, now)}${reason ? ` (${reason})` : ''}`,
      plan,
      toast: `❄ ${entity.name} parked — revisit on ${day}.`,
    };
  }
  if (target === 'passed') {
    return {
      status: 'passed',
      stage: 'decision',
      note: `${transition}${by}. Passed by choice — dragged onto Passed in the Pipeline${reason ? ` (${reason})` : ''}. Marked passed on ${isoDay(now)}.`,
      plan: planPass(entity, tasks),
      toast: reason ? `✕ ${entity.name} passed — reason recorded.` : `✕ ${entity.name} passed.`,
    };
  }
  const status = REQUALIFY_STATUS[target];
  const label = DROP_TARGET_LABEL[target];
  return {
    status,
    note: `${transition}${by}. Moved to ${label} — dragged in the Pipeline${reason ? ` (${reason})` : ''}. Marked ${label.toLowerCase()} on ${isoDay(now)}.`,
    plan: { dispositions: [], confirmation: '' },
    toast: `${REQUALIFY_TOAST_ICON[target]} ${entity.name} marked ${label}.`,
  };
}

export interface DropPrevious {
  status: EntityStatus;
  stage: RelationshipStage;
}

export interface DropUndo {
  status: EntityStatus;
  /** Restored only for a pass, the one drop that moved it. */
  stage?: RelationshipStage;
  note: string;
}

/**
 * §1.6 — Undo restores the previous status; leaving 'dormant' already closes
 * the revisit task in the store (205 §B, revisitTasksToClose), and the tasks
 * planPark re-dated or planPass closed stay as the plan left them — the same
 * as reactivating from the dossier. The note keeps the history honest: a
 * "Parked by choice" line with no counterpart would contradict the status.
 */
const UNDO_VERB: Record<DropTarget, string> = {
  frozen: 'un-parked', passed: 'reopened',
  not_contacted: 'reverted', contacted: 'reverted', diligence: 'reverted',
};

export function planUndo(target: DropTarget, previous: DropPrevious, now: Date): DropUndo {
  const label = previous.status.replace(/_/g, ' ');
  return {
    status: previous.status,
    stage: target === 'passed' ? previous.stage : undefined,
    note: `Undone — ${UNDO_VERB[target]} moments later; status restored to ${label} on ${isoDay(now)}.`,
  };
}
