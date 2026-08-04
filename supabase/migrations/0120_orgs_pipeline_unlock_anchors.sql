-- Prompt 123 Block B.2 — the pipeline-unlock engine (src/lib/pipeline-unlock.ts)
-- needs two anchors that don't exist on `orgs` today:
--   profile_completed_at  — when the B.2 minimum-profile gate first passed,
--                           the zero-point for "complete months since unlock"
--                           in the monthly_addition term.
--   plan_started_at       — when the CURRENT plan tier took effect, so an
--                           upgrade/downgrade resets the monthly-addition
--                           clock instead of inheriting the previous plan's
--                           elapsed months. Defaults to `created_at` for
--                           existing rows (best available anchor; a plan
--                           change going forward always sets this fresh).
-- PROPOSE ONLY — not applied. Free migration number confirmed against
-- supabase/migrations at commit time (next after 0119).
alter table public.orgs
  add column if not exists profile_completed_at timestamptz,
  add column if not exists plan_started_at timestamptz;

update public.orgs set plan_started_at = created_at where plan_started_at is null;
