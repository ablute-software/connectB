// Prompt 126 D — pure logic behind ReminderPopup's due-reminder selection,
// split out of the component (which is .tsx and can't be imported by vitest
// without a JSX-aware config) so it stays unit-testable in isolation.
//
// Prompt 247 B — widened from `TaskItem[]` to any `ReminderSource[]` so the
// investor workspace's own task shape (investor_tasks, a different table
// entirely — see migration 0182) can reuse this exact function instead of
// being force-fit into the founder's TaskItem type. Purely a type-level
// change (structural — TaskItem already satisfies ReminderSource): the
// filter/sort logic itself is untouched, still the one function both sides
// call.
export interface ReminderSource {
  id: string;
  done: boolean;
  reminder_at?: string | null;
  snoozed_until?: string | null;
}

// Prompt 126 D — offsets for the "create appointment" modal's Reminder
// select, shared by the founder (AgendaPanel.tsx) and investor
// (InvestorAgendaPanel.tsx, Prompt 247 B) calendars — one list, not two
// that could drift. `null` = no reminder at all; `0` = fire right at the
// event's own time. Minutes-before, not an absolute time, so the popup
// logic only ever needs one field (reminder_at) regardless of which option
// was picked.
export interface ReminderOption { value: string; label: string; offsetMin: number | null }
export const REMINDER_OPTIONS: ReminderOption[] = [
  { value: 'none', label: 'No reminder', offsetMin: null },
  { value: 'at_time', label: 'At the time', offsetMin: 0 },
  { value: '10_before', label: '10 minutes before', offsetMin: 10 },
  { value: '1h_before', label: '1 hour before', offsetMin: 60 },
  { value: '1d_before', label: '1 day before', offsetMin: 1440 },
];

export function dueReminders<T extends ReminderSource>(tasks: T[], now: number): T[] {
  return tasks
    .filter((t) => !t.done && t.reminder_at && new Date(t.reminder_at).getTime() <= now
      && (!t.snoozed_until || new Date(t.snoozed_until).getTime() <= now))
    .sort((a, b) => new Date(a.reminder_at!).getTime() - new Date(b.reminder_at!).getTime());
}
