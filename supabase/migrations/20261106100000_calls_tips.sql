-- Prompt 929 (B, 06/11/2026) — tips from Sherlock Deal to an applicant who was NOT selected after being evaluated. Additive only.
--
--   call_result_settings.tips_enabled   the ENTITY's authorisation, per call (Results → Options): "Let Sherlock Deal send unsuccessful applicants up to 3 general improvement tips based on the evaluation (no
--                                        scores or comments are shared)". OFF by default: the evaluations are the entity's confidential data and Sherlock Deal may only use them for its own tips if the entity allows it.
--   call_tips                           what was done for each application, ONE row per application: the categories and the sentences that were chosen, the language, when it was sent, and why nothing was sent when
--                                        nothing was ('opted_out', 'not_enough_evaluations', ...). It never holds a score, a position, a criterion or a comment — it serves to measure and to improve the tips.
-- Service role only (RLS on, nothing granted), like every other calls table. The applicant's own choice (the box "I don't want to receive feedback from Sherlock Deal about my evaluations") is
-- user_email_preferences.tips_opt_out, created with Prompt 929 (A).

alter table public.call_result_settings add column if not exists tips_enabled boolean not null default false;

create table if not exists public.call_tips (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid        not null references public.calls(id) on delete cascade,
  application_id uuid        not null references public.call_applications(id) on delete cascade,
  user_id        uuid        not null,
  language       text        not null default 'en',
  status         text        not null check (status in ('sent', 'invitation_only', 'skipped', 'failed')),
  skip_reason    text,
  categories     jsonb       not null default '[]'::jsonb check (jsonb_typeof(categories) = 'array'),
  sentences      jsonb       not null default '[]'::jsonb check (jsonb_typeof(sentences) = 'array'),
  attempts       integer     not null default 1,
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  unique (application_id)
);
alter table public.call_tips enable row level security;
create index if not exists call_tips_call_idx on public.call_tips (call_id);
revoke all on public.call_tips from anon, authenticated;
