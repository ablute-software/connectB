-- Prompt 924 (Etapa 4, I1, 28/10/2026) — preparing the results of a call. Additive only.
-- APPLIED 28/10/2026 to wkjcaoqdvhykrfacsylr (ledger version 20261028181120, name calls_results_prepare) after a dry run (a DO block that ended in DRYRUN_OK).
--
--   call_result_settings    per call: the visible name of each result (Selected / Not selected / Waiting list, which the entity may rename), one message per result (formatted text, with fields that fill themselves in),
--                           whether an eligibility "Not a fit" carries its reason, whether feedback is on (default OFF), whether contestations are on (default OFF; 10 calendar days once on), how long the
--                           applicants' data is kept after the call is completed (default 24 months — Nuno, 28/10/2026), and the text and date of the next phase.
--   call_result_feedback    "Feedback to the applicant": written BY an administrator, per application (and per phase). It is never filled from an evaluator's comments: nothing in this table or in the code that writes it
--                           reads call_evaluations / call_eval_scores.
--   call_applications.current_phase_id   the phase an application is in (null = the call's first phase). "Selected" in a call with more phases moves it to the next one when the results are published (I2).
--
-- Same trust boundary as the other calls tables: RLS on, no access for anon/authenticated — every access goes through our routes with the service role, and the SERVER decides who may read or write what
-- ("Publish results" for all of this).

create table if not exists public.call_result_settings (
  call_id                    uuid primary key references public.calls(id) on delete cascade,
  labels                     jsonb       not null default '{}'::jsonb check (jsonb_typeof(labels) = 'object'),
  messages                   jsonb       not null default '{}'::jsonb check (jsonb_typeof(messages) = 'object'),
  include_eligibility_reason boolean     not null default false,
  feedback_enabled           boolean     not null default false,
  contestations_enabled      boolean     not null default false,
  contestation_days          integer     not null default 10 check (contestation_days between 1 and 90),
  retention_months           integer     not null default 24 check (retention_months between 1 and 120),
  next_steps_text            text        not null default '',
  next_steps_date            date,
  updated_by                 uuid,
  updated_at                 timestamptz not null default now()
);
alter table public.call_result_settings enable row level security;

create table if not exists public.call_result_feedback (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid        not null references public.calls(id) on delete cascade,
  application_id uuid        not null references public.call_applications(id) on delete cascade,
  phase_id       uuid        references public.call_phases(id) on delete set null,
  body           text        not null check (btrim(body) <> ''),
  updated_by     uuid        not null,
  updated_at     timestamptz not null default now()
);
alter table public.call_result_feedback enable row level security;
create unique index if not exists call_result_feedback_one_uq on public.call_result_feedback (application_id, coalesce(phase_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists call_result_feedback_call_idx on public.call_result_feedback (call_id);

alter table public.call_applications add column if not exists current_phase_id uuid references public.call_phases(id) on delete set null;

revoke all on public.call_result_settings, public.call_result_feedback from public, anon, authenticated;
