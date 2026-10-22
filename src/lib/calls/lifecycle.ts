// Prompt 905 — a call's life (spec §8): what "ready to confirm" means, what each state allows, and the
// transitions as pure functions that return the patch to write (or the reason they are refused). The routes
// apply the patch; the editor uses the same functions to decide which buttons to show.
//
// Draft -> Confirmed (validated) -> Scheduled / Open -> Closed -> (evaluation, later stages) -> Archived.
import { UNTITLED, UNTITLED_DOCUMENT, conditionOrderProblems } from './form-builder';
import { isChoiceKind, type Call, type CallPhase, type CallStatus, type FormField } from './types';

export type EditorTab = 'general' | 'phases' | 'form' | 'preview' | 'team' | 'submissions';

/** `target`: the field or row the issue is about ("name", "opens", "closes", a phase id, a question id) — "What is missing" takes the person straight to it. */
export interface ReadinessIssue { tab: EditorTab; message: string; target?: string }

export interface CallSummary {
  phases: number;
  pages: number;
  fields: number;
  /** Questions that are not files. */
  questions: number;
  documents: number;
  required: number;
  mapped: number;
  conditional: number;
}

export function summarise(phases: CallPhase[], fields: FormField[]): CallSummary {
  return {
    phases: phases.length,
    pages: new Set(fields.map((f) => f.page)).size,
    fields: fields.length,
    questions: fields.filter((f) => f.kind !== 'file').length,
    documents: fields.filter((f) => f.kind === 'file').length,
    required: fields.filter((f) => f.required).length,
    mapped: fields.filter((f) => f.platformMapping).length,
    conditional: fields.filter((f) => f.condition).length,
  };
}

/**
 * What is still missing before the administrator may confirm. Empty = ready. Each issue names the tab to go to.
 * (Eligibility, team and evaluation join this list in the next stage.)
 */
export function readiness(call: Call, phases: CallPhase[], fields: FormField[], now: Date = new Date()): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  if (!call.name.trim()) issues.push({ tab: 'general', message: 'Give the call a name.', target: 'name' });
  if (!call.opensAt) issues.push({ tab: 'general', message: 'Set when applications open.', target: 'opens' });
  if (!call.closesAt) issues.push({ tab: 'general', message: 'Set the closing date and time.', target: 'closes' });
  if (call.opensAt && call.closesAt && Date.parse(call.closesAt) <= Date.parse(call.opensAt)) {
    issues.push({ tab: 'general', message: 'The call must close after it opens.', target: 'closes' });
  }
  if (call.closesAt && Date.parse(call.closesAt) <= now.getTime()) {
    issues.push({ tab: 'general', message: 'The closing date is in the past.', target: 'closes' });
  }
  if (phases.length === 0) issues.push({ tab: 'phases', message: 'Add at least one phase.' });
  if (phases.some((p) => !p.name.trim())) issues.push({ tab: 'phases', message: 'Every phase needs a name.', target: phases.find((p) => !p.name.trim())?.id });

  if (fields.length === 0) issues.push({ tab: 'form', message: 'Add at least one question to the form.' });
  for (const f of fields) {
    if (f.label === UNTITLED || f.label === UNTITLED_DOCUMENT || !f.label.trim()) {
      issues.push({ tab: 'form', message: `A ${f.kind === 'file' ? 'document' : 'question'} still has no text.`, target: f.id });
    }
    // Prompt 917: a repeatable group's own questions are held to the same standard as the questions of the form.
    const group = f.kind === 'group' ? f.validations.group : null;
    if (f.kind === 'group' && (!group || group.subFields.length === 0)) issues.push({ tab: 'form', message: `“${f.label}” (a group) needs at least one question.`, target: f.id });
    for (const s of group?.subFields ?? []) {
      if (!s.label.trim() || s.label === UNTITLED) issues.push({ tab: 'form', message: `A question in the group “${f.label}” still has no text.`, target: f.id });
      if (isChoiceKind(s.kind) && s.options.filter((o) => o.label.trim()).length < 2) issues.push({ tab: 'form', message: `“${s.label}” (in “${f.label}”) needs at least two options.`, target: f.id });
    }
    if (isChoiceKind(f.kind)) {
      const labelled = f.options.filter((o) => o.label.trim());
      if (labelled.length < 2) issues.push({ tab: 'form', message: `“${f.label}” needs at least two options.`, target: f.id });
      if (labelled.length !== f.options.length) issues.push({ tab: 'form', message: `“${f.label}” has an empty option.`, target: f.id });
      const names = labelled.map((o) => o.label.trim().toLowerCase());
      if (new Set(names).size !== names.length) issues.push({ tab: 'form', message: `“${f.label}” has two options with the same text.`, target: f.id });
    }
  }
  for (const f of fields) {
    const c = f.condition;
    if (c && (c.operator === 'equals' || c.operator === 'not_equals') && !c.value) {
      issues.push({ tab: 'form', message: `“${f.label}” has a display condition without a value.`, target: f.id });
    }
  }
  for (const label of conditionOrderProblems(fields)) {
    issues.push({ tab: 'form', message: `“${label}” depends on a question that no longer comes before it.` });
  }
  return issues;
}

// --- State ------------------------------------------------------------------------------------------------------

/** What the call is NOW, given the clock: a scheduled call whose time has come is open; an open one past its deadline is closed. */
export function effectiveStatus(call: Pick<Call, 'status' | 'opensAt' | 'closesAt'>, now: Date = new Date()): CallStatus {
  const t = now.getTime();
  const opens = call.opensAt ? Date.parse(call.opensAt) : null;
  const closes = call.closesAt ? Date.parse(call.closesAt) : null;
  if (call.status === 'scheduled' && opens !== null && opens <= t) {
    return closes !== null && closes <= t ? 'closed' : 'open';
  }
  if (call.status === 'open' && closes !== null && closes <= t) return 'closed';
  return call.status;
}

/** The questions, options and the rest of the configuration are editable only in draft; confirming locks them. */
export const isConfigEditable = (status: CallStatus): boolean => status === 'draft';

/** Confirmed but not open yet: "Edit configuration" is available and invalidates the confirmation. */
export const canEditConfiguration = (status: CallStatus): boolean => status === 'validated' || status === 'scheduled';

export type Refusal = { ok: false; error: string; /** A code the screen reacts to (e.g. "confirm_early" asks for a confirmation). */ code?: string };
export type Patch = { ok: true; patch: Partial<Record<string, unknown>>; event: string; detail?: Record<string, unknown> };
export type Transition = Patch | Refusal;

const refuse = (error: string): Refusal => ({ ok: false, error });

export function confirmCall(call: Call, issues: ReadinessIssue[], actor: string, now: Date = new Date()): Transition {
  if (call.status !== 'draft') return refuse('Only a draft can be validated.');
  if (issues.length > 0) return refuse(`Not ready yet: ${issues[0].message}`);
  return { ok: true, event: 'call_confirmed', patch: { status: 'validated', validated_at: now.toISOString(), validated_by: actor }, detail: { configVersion: call.configVersion } };
}

/** "Edit configuration": back to draft, the confirmation (and a scheduled opening) no longer stand. */
export function editConfiguration(call: Call): Transition {
  if (!canEditConfiguration(call.status)) {
    return refuse(call.status === 'draft' ? 'The call is already a draft.' : 'The configuration can no longer be edited once the call is open.');
  }
  return { ok: true, event: 'call_unconfirmed', patch: { status: 'draft', validated_at: null, validated_by: null }, detail: { from: call.status } };
}

/** Publish a confirmed call: it gets its link, and is Scheduled (opens by itself) or Open. */
export function publishCall(call: Call, linkToken: string, now: Date = new Date()): Transition {
  if (call.status !== 'validated') return refuse(call.status === 'draft' ? 'Validate the form and settings before publishing the call.' : 'This call is already published.');
  if (!call.opensAt || !call.closesAt) return refuse('The call needs opening and closing dates.');
  if (Date.parse(call.closesAt) <= now.getTime()) return refuse('The closing date is in the past.');
  const opensNow = Date.parse(call.opensAt) <= now.getTime();
  return {
    ok: true, event: 'call_published',
    patch: { status: opensNow ? 'open' : 'scheduled', link_token: call.linkToken ?? linkToken, published_at: now.toISOString() },
    detail: { opensNow },
  };
}

/** Extend the deadline for everyone (§14.4). Only later, only while the call can still receive applications. */
export function extendDeadline(call: Call, newClosesAtIso: string, now: Date = new Date()): Transition {
  const status = effectiveStatus(call, now);
  if (status !== 'open' && status !== 'scheduled') return refuse('The deadline can only be extended while the call is scheduled or open.');
  const next = Date.parse(newClosesAtIso);
  if (Number.isNaN(next)) return refuse('Invalid date.');
  if (!call.closesAt || next <= Date.parse(call.closesAt)) return refuse('The new deadline must be later than the current one.');
  return { ok: true, event: 'deadline_extended', patch: { closes_at: new Date(next).toISOString() }, detail: { from: call.closesAt, to: new Date(next).toISOString() } };
}

/**
 * Has the evaluation of this call started? Reopening a closed call is only allowed before it does. The evaluation stage (Etapa 3) does not exist yet, so this is always false; the
 * condition is written HERE so that when it does exist, reopening stops being possible by changing one line (Prompt 918, Adenda 1 B).
 */
/** Did the call close — by its deadline or early? (An archived call has lost that from its status; its dates and its closing time say.) */
export const hadClosed = (call: Pick<Call, 'closedAt' | 'closesAt'>, now: Date = new Date()): boolean => !!call.closedAt || (!!call.closesAt && Date.parse(call.closesAt) <= now.getTime());

export const evaluationStarted = (_call: Pick<Call, 'id'>): boolean => false;

/**
 * "Reopen and extend" (Nuno, 19/10/2026): a call that CLOSED can be reopened with a new deadline in the future — the applicants who had not submitted can then submit, and what was
 * submitted is untouched. Allowed for a call that closed by its deadline, or closed early only when the person confirms it on purpose; never an archived one, never after the
 * evaluation started.
 */
export function reopenCall(call: Call, newClosesAtIso: string, o: { closedEarly: boolean; confirmEarly: boolean }, now: Date = new Date()): Transition {
  // A call that was archived AFTER it closed (the usual way to "get rid of" a finished call) can be reopened too: reopening takes it out of the archive. One that never opened cannot.
  const archived = call.status === 'archived';
  if (archived) { if (!hadClosed(call, now)) return refuse('This archived call never closed, so it cannot be reopened.'); }
  else if (effectiveStatus(call, now) !== 'closed') return refuse('Only a closed call can be reopened. To move the deadline of an open call, use “Extend the deadline”.');
  if (evaluationStarted(call)) return refuse('The evaluation of this call has started, so it can no longer be reopened.');
  if (o.closedEarly && !o.confirmEarly) {
    return { ok: false, error: 'This call was closed early, on purpose. Confirm that you want to reopen it.', code: 'confirm_early' };
  }
  const next = Date.parse(newClosesAtIso);
  if (Number.isNaN(next)) return refuse('Invalid date.');
  if (next <= now.getTime()) return refuse('The new deadline must be in the future.');
  const to = new Date(next).toISOString();
  return {
    ok: true, event: 'call_reopened', patch: { status: 'open', closes_at: to, closed_at: null, ...(archived ? { archived_at: null, archived_by: null } : {}) },
    detail: { from: call.closesAt, to, closedEarly: o.closedEarly, confirmedEarly: o.closedEarly && o.confirmEarly, ...(archived ? { unarchived: true } : {}) },
  };
}

/** Close early: no new submissions; what already came in is untouched (§8). */
export function closeEarly(call: Call, now: Date = new Date()): Transition {
  if (effectiveStatus(call, now) !== 'open') return refuse('Only an open call can be closed early.');
  return { ok: true, event: 'call_closed', patch: { status: 'closed', closed_at: now.toISOString() }, detail: { early: true } };
}

/** How many applications a call has, by state. The entity is told the NUMBER of drafts, never who they belong to. */
export interface ApplicationCounts { submitted: number; inProgress: number; withdrawn: number; total: number }

/**
 * Delete (Prompt 918, Adenda 2, C — it replaces "after it opens, only archive", Prompts 909 and 918 Adenda 1): a call can be deleted in ANY state, by whoever may "Configure call".
 * Deleting is not instant — the call goes to "Deleted calls" for 30 days (see deletion.ts) — so there is nothing left to refuse by state or by applications: what protects the
 * applicants' data is the confirmation (the summary and the name typed), the notice they get, and the 30 days. A call that is already deleted is not reachable by the editor at all.
 * The screen and the server share this answer, so a disabled "Delete call" can never be explained by a sentence that is not true.
 */
export const canDeleteCall = (): boolean => true;

/** Archive: for calls with applications, or already open or closed. An open call must be closed first. */
export function archiveCall(call: Call, actor: string, now: Date = new Date()): Transition {
  if (call.status === 'archived') return refuse('This call is already archived.');
  if (effectiveStatus(call, now) === 'open') return refuse('Close the call before archiving it.');
  return {
    ok: true, event: 'call_archived',
    patch: { status: 'archived', archived_at: now.toISOString(), archived_by: actor }, detail: { from: call.status },
  };
}

/** Which actions the editor offers for this state. */
export function availableActions(call: Call, issues: ReadinessIssue[], now: Date = new Date(), applications: ApplicationCounts | number = 0, ctx: { closedEarly?: boolean } = {}) {
  const status = effectiveStatus(call, now);
  void applications;
  return {
    canDelete: canDeleteCall(),
    canArchive: call.status !== 'archived' && status !== 'open',
    status,
    canEditForm: isConfigEditable(call.status),
    canConfirm: call.status === 'draft' && issues.length === 0,
    canEditConfiguration: canEditConfiguration(call.status),
    canPublish: call.status === 'validated',
    canExtend: status === 'open' || status === 'scheduled',
    canClose: status === 'open',
    /** "Reopen and extend": a call that closed, before the evaluation starts. */
    canReopen: (status === 'closed' || (call.status === 'archived' && hadClosed(call, now))) && !evaluationStarted(call),
    /** It was closed early, on purpose: reopening asks for an explicit confirmation. */
    reopenNeedsConfirm: (status === 'closed' || call.status === 'archived') && ctx.closedEarly === true,
  };
}

/** The sentence under a published call's link while the real applicant screen does not exist yet (Prompt 906). */
export function linkPlaceholderText(call: Pick<Call, 'status' | 'opensAt' | 'closesAt'>, formattedOpens: string, now: Date = new Date()): string {
  const status = effectiveStatus(call, now);
  if (status === 'scheduled' || status === 'validated') return `Applications open on ${formattedOpens}.`;
  if (status === 'open') return 'Applications are open.';
  return 'This call is closed.';
}
