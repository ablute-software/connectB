-- Prompt 747 §B — per-member watermark for the daily investor notify-digest
-- cron (investor-notify-digest-server.ts, wired into /api/automations).
-- Lives on matchdeal_investor_members, same posture as its sibling column
-- notify_new_eligible_startup (migration 0267): per-SEAT, not per-firm —
-- colleagues at the same firm can each be on a different cadence relative
-- to when THEY were last told, even though they share one firm-wide set of
-- investor_pipeline_admissions rows. Nullable, defaults to null: a member
-- who has never received a digest gets treated as "catch me up on
-- everything currently presented" the first time the sweep runs for them
-- (see decideNotifyDigestForMember's own header for that rule), not
-- silently starting the clock with nothing to show.
--
-- FILE ONLY per this codebase's migration discipline (CLAUDE.md) — not
-- applied via apply_migration. Apply only after Nuno's own explicit "yes"
-- in the orchestrating session.
alter table public.matchdeal_investor_members
  add column if not exists notify_new_eligible_last_sent_at timestamptz;
