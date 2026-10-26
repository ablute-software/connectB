// Prompt 918 (Adenda 3) — WHY a call is closed, and WHEN, said truthfully in one place. Pure.
//
// A call closes in three different ways and the editor, the list and the link used to say the same thing about all of them ("closed at its deadline", "Closes 31 Dec"):
//   deadline  its closing date passed;
//   early     the team pressed "Close early" (a decision, so reopening asks for an explicit confirmation);
//   restored  it was DELETED (which closes an open call at once) and then restored — it comes back closed, and reopening it is exactly the undo, so no confirmation is asked.
// The reason is not a column: it is read from the call's history (call_closed with `early`, call_deleted with `closed`, call_restored), newest first, so it can never disagree with what happened.
import { formatDayInZone } from './tz';
import type { Call } from './types';

export type CloseReason = 'deadline' | 'early' | 'restored';

/** Only these events say how a call closed; anything else in the history is ignored. */
export const CLOSE_REASON_EVENTS = ['call_closed', 'call_deleted', 'call_restored', 'call_reopened'] as const;

export interface HistoryEvent { id?: number; event: string; detail?: Record<string, unknown> | null }

/**
 * The reason the call is closed now, from its history (any order: the newest, by `id` when there is one, decides). A call with no closing event in its history closed by its deadline — the usual
 * way, which the platform also records when someone opens the call after the deadline passed.
 */
export function closeReasonFrom(events: HistoryEvent[]): CloseReason {
  const newestFirst = [...events].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  for (const e of newestFirst) {
    switch (e.event) {
      case 'call_restored': return 'restored';
      case 'call_deleted': return e.detail?.closed === true ? 'restored' : 'deadline';   // it was deleted and has not been restored: it is not in the editor at all, but never "early"
      case 'call_closed': return e.detail?.early === true ? 'early' : 'deadline';
      case 'call_reopened': return 'deadline';                                              // it was reopened and closed again by the clock (that would be a newer call_closed)
    }
  }
  return 'deadline';
}

/** The sentence in the "Reopen and extend" box: the TRUE reason the call is closed. */
export function closeReasonSentence(reason: CloseReason): string {
  switch (reason) {
    case 'early': return 'This call was closed early, on purpose.';
    case 'restored': return 'This call was deleted and restored; restoring brings a call back closed.';
    case 'deadline': return 'This call closed at its deadline.';
  }
}

/** Closed BEFORE its deadline (early, or by being deleted and restored): the date it closed on is then not the one it was due to close on. */
export const closedBeforeDeadline = (call: { closedAt?: string | null; closesAt: string | null }): boolean =>
  !!call.closedAt && !!call.closesAt && Date.parse(call.closedAt) < Date.parse(call.closesAt);

export interface ClosingLine { label: string; value: string; early: boolean }

/**
 * The closing row of a call, as the list, the summary and the link show it: "Closes 31 Dec 2026, 14:34 (Europe/Lisbon)" while it has not closed, "Closed on 22 Oct 2026 (early)" when it closed
 * before its deadline. `format` gives the long form (with time and zone) used before closing.
 */
export function closingLine(call: { closedAt?: string | null; closesAt: string | null; timezone: string }, closed: boolean, format: (iso: string | null, tz: string) => string): ClosingLine {
  if (closed && closedBeforeDeadline(call)) return { label: 'Closed on', value: `${formatDayInZone(call.closedAt, call.timezone)} (early)`, early: true };
  return { label: 'Closes', value: format(call.closesAt, call.timezone), early: false };
}
