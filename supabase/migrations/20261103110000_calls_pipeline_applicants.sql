-- APPLIED on 03/11/2026 to wkjcaoqdvhykrfacsylr (dry run in a rolled-back transaction first), before the code that reads it was deployed.
-- Prompt 927 (A, 03/11/2026) — a startup that submits an application to a call of an investor firm appears in the deal flow (Pipeline) of the people of that firm who may see it. Additive only.
--
--   call_applications.pipeline_notice_at   when the applicant was SHOWN "Your startup's profile will be added to «Entity»'s deal flow on Sherlock Deal." as they submitted. Nothing is added to a
--                                          pipeline for an application that has none (those submitted before this prompt have none).
--   call_pipeline_backfills                "Add applicants to my pipeline": a call administrator pulling the applications that predate the notice into THEIR OWN pipeline (one row per call and person).
--
-- Who sees what is worked out when the pipeline is read (administrators of the call; evaluators for the applications assigned to them, never in a blind call), so a change of team, assignment or blind
-- setting takes effect at once and nothing here goes stale. Service role only (RLS on, no policies, nothing granted), like every other calls table.

alter table public.call_applications add column if not exists pipeline_notice_at timestamptz;

create table if not exists public.call_pipeline_backfills (
  id         uuid primary key default gen_random_uuid(),
  call_id    uuid        not null references public.calls(id) on delete cascade,
  user_id    uuid        not null,
  created_at timestamptz not null default now(),
  unique (call_id, user_id)
);
alter table public.call_pipeline_backfills enable row level security;
revoke all on public.call_pipeline_backfills from anon, authenticated;
