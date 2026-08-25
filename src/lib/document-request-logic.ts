// Prompt 372 — pure, DB-free logic for the document-request cycle: task
// priority ranking, reminder cadence, and request/item status derivation.
// No AI, no I/O — mirrors company-canon-logic.ts/needs-review-logic.ts's
// own "importable by client, API route, and vitest alike" convention.

// Block C §4 — priority order the founder actually cares about, decided by
// Nuno: an investor showing interest always outranks a document ask; a
// document ask from someone already in diligence outranks a live
// conversation; a document ask from anyone else is last. Never computed
// ad hoc in a component — this is the one place the order lives.
export type TaskPriorityKind =
  | 'investor_interest' | 'document_request_diligence' | 'active_conversation' | 'document_request_other';

const PRIORITY_ORDER: TaskPriorityKind[] = [
  'investor_interest', 'document_request_diligence', 'active_conversation', 'document_request_other',
];

export function priorityRank(kind: TaskPriorityKind): number {
  return PRIORITY_ORDER.indexOf(kind);
}

export function compareTaskPriority(a: TaskPriorityKind, b: TaskPriorityKind): number {
  return priorityRank(a) - priorityRank(b);
}

export function documentRequestPriorityKind(inDiligence: boolean): TaskPriorityKind {
  return inDiligence ? 'document_request_diligence' : 'document_request_other';
}

// Block C §5 — reminder cadence: 2 days apart for the first 3 reminders,
// then weekly "until resolved" — never a bare infinite nag, consistent
// with this codebase's other stop-rules (never a 3rd unanswered follow-up,
// LOCK_DAYS, etc.). A founder who answers "not yet, by {date}" reschedules
// the WHOLE cadence to that date instead of the counter continuing — the
// founder already gave a real answer, insisting every 2 days on top of it
// would be exactly the "blind insistence" this rule exists to prevent.
export function nextReminderAt(lastReminderAt: Date, remindersSentSoFar: number, promisedFor?: string | null): Date {
  if (promisedFor) return new Date(`${promisedFor}T09:00:00.000Z`);
  const intervalDays = remindersSentSoFar < 3 ? 2 : 7;
  return new Date(lastReminderAt.getTime() + intervalDays * 86_400_000);
}

// Block A — "the request's status is derived from its items, not stored
// independently": pending while ANY item is pending, resolved once every
// item has an outcome (granted/promised/declined all count as resolved —
// each is a real, honest answer, never silence).
export type AccessRequestItemStatus = 'pending' | 'granted' | 'promised' | 'declined';
export interface ItemLike { status: AccessRequestItemStatus }

export function derivedRequestStatus(items: ItemLike[]): 'pending' | 'resolved' {
  return items.some((i) => i.status === 'pending') ? 'pending' : 'resolved';
}

export function requestProgress(items: ItemLike[]): { resolved: number; total: number } {
  return { resolved: items.filter((i) => i.status !== 'pending').length, total: items.length };
}

// Block C §3 — the task backing a document request closes ONLY when every
// item has an outcome, never on the first response to a multi-item ask.
export function allItemsResolved(items: ItemLike[]): boolean {
  return items.length > 0 && items.every((i) => i.status !== 'pending');
}
