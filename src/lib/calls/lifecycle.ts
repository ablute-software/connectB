// Prompt 905 — a call's life (spec §8): what "ready to confirm" means, what each state allows, and the
// transitions as pure functions that return the patch to write (or the reason they are refused). The routes
// apply the patch; the editor uses the same functions to decide which buttons to show.
//
// Draft -> Confirmed (validated) -> Scheduled / Open -> Closed -> (evaluation, later stages) -> Archived.
import { UNTITLED, UNTITLED_DOCUMENT, conditionOrderProblems } from './form-builder';
import { isChoiceKind, type Call, type CallPhase, type CallStatus, type FormField } from './types';

export type EditorTab = 'general' | 'phases' | 'form' | 'preview';

export interface ReadinessIssue { tab: EditorTab; message: string }

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
  if (!call.name.trim()) issues.push({ tab: 'general', message: 'Give the call a name.' });
  if (!call.opensAt) issues.push({ tab: 'general', message: 'Set when applications open.' });
  if (!call.closesAt) issues.push({ tab: 'general', message: 'Set the closing date and time.' });
  if (call.opensAt && call.closesAt && Date.parse(call.closesAt) <= Date.parse(call.opensAt)) {
    issues.push({ tab: 'general', message: 'The call must close after it opens.' });
  }
  if (call.closesAt && Date.parse(call.closesAt) <= now.getTime()) {
    issues.push({ tab: 'general', message: 'The closing date is in the past.' });
  }
  if (phases.length === 0) issues.push({ tab: 'phases', message: 'Add at least one phase.' });
  if (phases.some((p) => !p.name.trim())) issues.push({ tab: 'phases', message: 'Every phase needs a name.' });

  if (fields.length === 0) issues.push({ tab: 'form', message: 'Add at least one question to the form.' });
  for (const f of fields) {
    if (f.label === UNTITLED || f.label === UNTITLED_DOCUMENT || !f.label.trim()) {
      issues.push({ tab: 'form', message: `A ${f.kind === 'file' ? 'document' : 'question'} still has no text.` });
    }
    if (isChoiceKind(f.kind)) {
      const labelled = f.options.filter((o) => o.label.trim());
      if (labelled.length < 2) issues.push({ tab: 'form', message: `“${f.label}” needs at least two options.` });
      if (labelled.length !== f.options.length) issues.push({ tab: 'form', message: `“${f.label}” has an empty option.` });
      const names = labelled.map((o) => o.label.trim().toLowerCase());
      if (new Set(names).size !== names.length) issues.push({ tab: 'form', message: `“${f.label}” has two options with the same text.` });
    }
  }
  for (const f of fields) {
    const c = f.condition;
    if (c && (c.operator === 'equals' || c.operator === 'not_equals') && !c.value) {
      issues.push({ tab: 'form', message: `“${f.label}” has a display condition without a value.` });
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

export type Refusal = { ok: false; error: string };
export type Patch = { ok: true; patch: Partial<Record<string, unknown>>; event: string; detail?: Record<string, unknown> };
export type Transition = Patch | Refusal;

const refuse = (error: string): Refusal => ({ ok: false, error });

export function confirmCall(call: Call, issues: ReadinessIssue[], actor: string, now: Date = new Date()): Transition {
  if (call.status !== 'draft') return refuse('Only a draft can be confirmed.');
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
  if (call.status !== 'validated') return refuse(call.status === 'draft' ? 'Confirm the call before publishing it.' : 'This call is already published.');
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

/** Close early: no new submissions; what already came in is untouched (§8). */
export function closeEarly(call: Call, now: Date = new Date()): Transition {
  if (effectiveStatus(call, now) !== 'open') return refuse('Only an open call can be closed early.');
  return { ok: true, event: 'call_closed', patch: { status: 'closed', closed_at: now.toISOString() }, detail: { early: true } };
}

/** Which actions the editor offers for this state. */
export function availableActions(call: Call, issues: ReadinessIssue[], now: Date = new Date()) {
  const status = effectiveStatus(call, now);
  return {
    status,
    canEditForm: isConfigEditable(call.status),
    canConfirm: call.status === 'draft' && issues.length === 0,
    canEditConfiguration: canEditConfiguration(call.status),
    canPublish: call.status === 'validated',
    canExtend: status === 'open' || status === 'scheduled',
    canClose: status === 'open',
  };
}

/** The sentence under a published call's link while the real applicant screen does not exist yet (Prompt 906). */
export function linkPlaceholderText(call: Pick<Call, 'status' | 'opensAt' | 'closesAt'>, formattedOpens: string, now: Date = new Date()): string {
  const status = effectiveStatus(call, now);
  if (status === 'scheduled' || status === 'validated') return `Applications open on ${formattedOpens}.`;
  if (status === 'open') return 'Applications are open.';
  return 'This call is closed.';
}
