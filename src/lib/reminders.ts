// Prompt 126 D — pure logic behind ReminderPopup's due-reminder selection,
// split out of the component (which is .tsx and can't be imported by vitest
// without a JSX-aware config) so it stays unit-testable in isolation.
import type { TaskItem } from '@/lib/types';

export function dueReminders(tasks: TaskItem[], now: number): TaskItem[] {
  return tasks
    .filter((t) => !t.done && t.reminder_at && new Date(t.reminder_at).getTime() <= now
      && (!t.snoozed_until || new Date(t.snoozed_until).getTime() <= now))
    .sort((a, b) => new Date(a.reminder_at!).getTime() - new Date(b.reminder_at!).getTime());
}
