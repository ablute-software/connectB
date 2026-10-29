-- Prompt 924 (Etapa 4, I2, 29/10/2026) — publishing the results. Additive only.
-- APPLIED 29/10/2026 to wkjcaoqdvhykrfacsylr (ledger version 20261029121553, name calls_results_publish) after a dry run (a DO block that ended in DRYRUN_OK).
--
--   call_result_settings.share_grade   Nuno, 28/10/2026: an option PER CALL, OFF by default — a public entity (Portugal Ventures) may have to tell applicants their score. Only the grade an administrator
--                                      VALIDATED is ever sent: never the average of the evaluations, never an evaluator's score.
--   call_result_grades                 that validated grade (0–100 %), written by an administrator, per application and phase.
--   call_result_batches                one publication per call and phase: 'scheduled' (waits for its time), 'publishing', 'published' or 'cancelled', with who and when, the counts and the settings it
--                                      went out with (what was sent cannot be changed by editing the settings afterwards).
--   call_results                       the published result of an application, per phase: the words of the message, the grade (if shared), where it moved to. History is kept: a result that a contestation
--                                      changes (I3) becomes a NEW row (supersedes_id points to the old one, is_current says which counts) — never an overwrite.
--   call_result_sends                  the email of each result: queued → sent, or retried with a growing wait, or bounced / failed. A failed email never keeps the result from showing in the app.
--   call_notices.kind                  also accepts 'result_published' (and, for the next increment, 'contestation_received' and 'contestation_answered').
--
-- Same trust boundary as the other calls tables: RLS on, no access for anon/authenticated — every access goes through our routes with the service role, and the SERVER decides who may read or write what
-- ("Publish results").

alter table public.call_result_settings add column if not exists share_grade boolean not null default false;

create table if not exists public.call_result_grades (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid        not null references public.calls(id) on delete cascade,
  application_id uuid        not null references public.call_applications(id) on delete cascade,
  phase_id       uuid        references public.call_phases(id) on delete set null,
  grade          numeric(5, 2) not null check (grade >= 0 and grade <= 100),
  set_by         uuid        not null,
  updated_at     timestamptz not null default now()
);
alter table public.call_result_grades enable row level security;
create unique index if not exists call_result_grades_one_uq on public.call_result_grades (application_id, coalesce(phase_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.call_result_batches (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid        not null references public.calls(id) on delete cascade,
  phase_id       uuid        references public.call_phases(id) on delete set null,
  status         text        not null check (status in ('scheduled', 'publishing', 'published', 'cancelled')),
  scheduled_at   timestamptz,
  scheduled_by   uuid,
  published_at   timestamptz,
  published_by   uuid,
  total          integer     not null default 0,
  counts         jsonb       not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  settings       jsonb       not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at     timestamptz not null default now()
);
alter table public.call_result_batches enable row level security;
create unique index if not exists call_result_batches_one_live_uq on public.call_result_batches (call_id, coalesce(phase_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status in ('scheduled', 'publishing', 'published');
create index if not exists call_result_batches_due_idx on public.call_result_batches (scheduled_at) where status = 'scheduled';

create table if not exists public.call_results (
  id               uuid primary key default gen_random_uuid(),
  call_id          uuid        not null references public.calls(id) on delete cascade,
  application_id   uuid        not null references public.call_applications(id) on delete cascade,
  phase_id         uuid        references public.call_phases(id) on delete set null,
  batch_id         uuid        references public.call_result_batches(id) on delete set null,
  result           text        not null check (result in ('advance', 'reject', 'waitlist')),
  label            text        not null,
  source           text        not null check (source in ('decision', 'eligibility', 'contestation')),
  subject          text        not null,
  body_html        text        not null,
  grade            numeric(5, 2),
  moved_to_phase_id uuid       references public.call_phases(id) on delete set null,
  is_current       boolean     not null default true,
  supersedes_id    uuid        references public.call_results(id) on delete set null,
  published_at     timestamptz not null default now()
);
alter table public.call_results enable row level security;
create unique index if not exists call_results_current_uq on public.call_results (application_id, coalesce(phase_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_current;
create index if not exists call_results_call_idx on public.call_results (call_id) where is_current;

create table if not exists public.call_result_sends (
  id              uuid primary key default gen_random_uuid(),
  call_id         uuid        not null references public.calls(id) on delete cascade,
  result_id       uuid        not null references public.call_results(id) on delete cascade,
  user_id         uuid        not null,
  status          text        not null default 'queued' check (status in ('queued', 'sent', 'bounced', 'failed')),
  attempts        integer     not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (result_id)
);
alter table public.call_result_sends enable row level security;
create index if not exists call_result_sends_due_idx on public.call_result_sends (next_attempt_at) where status = 'queued';
create index if not exists call_result_sends_call_idx on public.call_result_sends (call_id, status);

alter table public.call_notices drop constraint if exists call_notices_kind_check;
alter table public.call_notices add constraint call_notices_kind_check
  check (kind in ('submission_received', 'draft_reminder', 'deadline_extended', 'import_ready', 'import_failed', 'call_cancelled', 'form_changed', 'call_restored', 'eval_assigned', 'eval_reminder',
                  'result_published', 'contestation_received', 'contestation_answered'));

revoke all on public.call_result_grades, public.call_result_batches, public.call_results, public.call_result_sends from public, anon, authenticated;
