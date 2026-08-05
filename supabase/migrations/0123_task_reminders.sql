-- Prompt 126 D — "create an appointment on any day" + reminder popups
-- (Dismiss / Snooze 10min / 1h / tomorrow). The popup needs somewhere to
-- store "when should this next nag" (reminder_at, cleared by Dismiss) and
-- "snoozed past a specific time" (snoozed_until, rescheduled by Snooze),
-- independent of the task's own due_at, which stays the ground truth for
-- the calendar/agenda views. `notes` is the new free-text field for the
-- appointment-creation modal, beyond the existing `title`.
--
-- PROPOSE ONLY — not applied. Apply manually via Supabase dashboard/CLI.
-- Rides the existing tasks_all RLS policy (is_org_member(org_id)) — no new
-- policy needed, same rows, just new columns.
alter table tasks add column if not exists notes text;
alter table tasks add column if not exists reminder_at timestamptz;
alter table tasks add column if not exists snoozed_until timestamptz;
