// Prompt 126 D — propose-only migration 0123 (tasks.notes/reminder_at/
// snoozed_until). Gates whether the appointment-creation modal is allowed
// to send these three columns to a real Supabase backend; irrelevant in
// demo mode, where localStorage has no schema to violate.
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const taskRemindersAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('tasks').select('notes, reminder_at, snoozed_until').limit(1);
  return !error;
});
