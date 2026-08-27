-- Prompt 398 §3 — recurring reminder for an investor interest (L3) request
-- sitting unanswered. New automation trigger, listed in Settings ->
-- Automations like every other one; execution is a dedicated daily sweep
-- (src/lib/interest-reminder-sweep.ts), not the generic automation-rules
-- engine — that engine is still a documented placeholder server-side (see
-- /api/automations/route.ts's own "TODO: implement server-side
-- automation-rules tick" comment), same pattern every OTHER real job in
-- that route already uses (malware scans, Pioneer badges, monthly
-- delivery: its own dedicated function, called directly from the daily
-- cron tick, not routed through the unbuilt generic engine).
alter type automation_trigger add value if not exists 'interest_request_unanswered';

-- Reuses the EXISTING ReminderPopup mechanism (tasks.reminder_at,
-- src/lib/reminders.ts's dueReminders — already mounted shell-wide via
-- ReminderPopup.tsx, fires regardless of which page is open) instead of
-- building a second, parallel banner system. Two new columns carry what
-- that mechanism doesn't already have:
--   reminder_muted — "stop reminding for this investor" (§3.2.2): distinct
--     from Dismiss (which only clears reminder_at until the next sweep
--     resets it) — this tells the sweep to never reset reminder_at again
--     for this task. The request itself stays pending; muting is not
--     deciding.
--   last_reminded_at — when the sweep last set reminder_at, independent of
--     Dismiss/Snooze cycles, so "have >=2 days passed since the last
--     reminder" can be evaluated without conflating "was it dismissed"
--     with "was it actually reminded".
alter table tasks add column if not exists reminder_muted boolean not null default false;
alter table tasks add column if not exists last_reminded_at timestamptz;
