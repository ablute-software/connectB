-- Prompt 922 (Etapa 3, 27/10/2026) — the evaluation grid, the distribution of applications among evaluators, conflicts of interest, the evaluations and the consolidation. Additive only.
-- APPLIED 28/10/2026 to wkjcaoqdvhykrfacsylr (ledger version 20261028095514, name calls_evaluation) after a dry run (a transaction that was rolled back).
--
--   calls.eval_grid_version / eval_grid_rev    the version of the grid in force (a change after the first evaluation was submitted makes a new one; the evaluations keep the version they were made on) and the
--                                              optimistic-concurrency token of the step. calls.evaluation_closed_at: "Close evaluation".
--   call_eval_settings                         per call: how many evaluators per application (a number, or all), blind evaluation, "comment required" for all, the divergence limits, the deadline per phase, the
--                                              distribution mode.
--   call_eval_criteria                         the criteria of the grid, per call and version: weight, scale chosen by the entity, descriptions of the levels, the eliminatory minimum, and a `format` for later (only `scale`).
--   call_eval_templates                        grids saved at the level of the ENTITY ("Save as template"); "Start from template" copies one — nothing is shared afterwards.
--   call_eval_import_runs                      a grid read from a document by the platform's own reader (never an AI provider): the proposal, and what the administrator corrected, kept per call.
--   call_eval_assignments / call_eval_conflicts  who evaluates what; the conflicts of interest (automatic and declared), with who, when and why.
--   call_evaluations / call_eval_scores / call_eval_reopenings   one evaluation per evaluator and application; scores per criterion; the history when an administrator reopens a submitted evaluation.
--   call_eval_decisions                        Advance / Reject / Waitlist per application — a decision does not send anything to the applicant (Etapa 4).
--   call_eval_reminders                        which reminders (3 days, 1 day before the deadline) were already sent, once each.
--   call_notices.kind also accepts 'eval_assigned' and 'eval_reminder' (the evaluators' own notices).
--
-- Each call is isolated: every row carries call_id and nothing is read across calls. Same trust boundary as the other calls tables: RLS on, no access for anon/authenticated — every access goes through our routes
-- with the service role, and the SERVER decides who may read or write what.

alter table public.calls add column if not exists eval_grid_version integer not null default 1 check (eval_grid_version >= 1);
alter table public.calls add column if not exists eval_grid_rev integer not null default 0 check (eval_grid_rev >= 0);
alter table public.calls add column if not exists evaluation_closed_at timestamptz;
alter table public.calls add column if not exists evaluation_closed_by uuid;

create table if not exists public.call_eval_settings (
  call_id                  uuid primary key references public.calls(id) on delete cascade,
  evaluators_per_application integer not null default 2 check (evaluators_per_application >= 1),
  evaluators_all           boolean     not null default false,
  blind                    boolean     not null default false,
  comment_required_all     boolean     not null default false,
  divergence               jsonb       not null default '{"enabled": true, "scalePct": 40, "totalPct": 20}'::jsonb check (jsonb_typeof(divergence) = 'object'),
  deadlines                jsonb       not null default '[]'::jsonb check (jsonb_typeof(deadlines) = 'array'),
  distribution_mode        text        not null default 'auto' check (distribution_mode in ('auto', 'manual', 'mixed')),
  updated_by               uuid,
  updated_at               timestamptz not null default now()
);
alter table public.call_eval_settings enable row level security;

create table if not exists public.call_eval_criteria (
  id               uuid primary key default gen_random_uuid(),
  call_id          uuid        not null references public.calls(id) on delete cascade,
  version          integer     not null default 1 check (version >= 1),
  position         integer     not null default 0,
  section          text,
  name             text        not null check (btrim(name) <> ''),
  guidance         text        not null default '',
  weight           numeric(7, 3) not null check (weight >= 0 and weight <= 100),
  format           text        not null default 'scale' check (format in ('scale')),
  scale_min        integer     not null check (scale_min >= 0),
  scale_max        integer     not null check (scale_max > scale_min),
  levels           jsonb       not null default '[]'::jsonb check (jsonb_typeof(levels) = 'array'),
  comment_required boolean     not null default false,
  min_score        integer,
  created_at       timestamptz not null default now()
);
alter table public.call_eval_criteria enable row level security;
create index if not exists call_eval_criteria_call_idx on public.call_eval_criteria (call_id, version, position);

create table if not exists public.call_eval_templates (
  id                uuid primary key default gen_random_uuid(),
  catalog_entity_id uuid references public.catalog_entities(id) on delete cascade,
  incubator_id      uuid references public.incubators(id) on delete cascade,
  name              text        not null check (btrim(name) <> ''),
  criteria          jsonb       not null check (jsonb_typeof(criteria) = 'array'),
  settings          jsonb       not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  check ((catalog_entity_id is not null) <> (incubator_id is not null))
);
alter table public.call_eval_templates enable row level security;
create unique index if not exists call_eval_templates_name_uq on public.call_eval_templates ((coalesce(catalog_entity_id, incubator_id)), (lower(btrim(name))));

create table if not exists public.call_eval_import_runs (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid        not null references public.calls(id) on delete cascade,
  file_name   text        not null,
  proposal    jsonb       not null,
  status      text        not null default 'proposed' check (status in ('proposed', 'applied', 'discarded')),
  corrections jsonb       not null default '[]'::jsonb check (jsonb_typeof(corrections) = 'array'),
  created_by  uuid        not null,
  created_at  timestamptz not null default now(),
  applied_at  timestamptz
);
alter table public.call_eval_import_runs enable row level security;
create index if not exists call_eval_import_runs_call_idx on public.call_eval_import_runs (call_id, created_at desc);

create table if not exists public.call_eval_assignments (
  id                uuid primary key default gen_random_uuid(),
  call_id           uuid        not null references public.calls(id) on delete cascade,
  application_id    uuid        not null references public.call_applications(id) on delete cascade,
  evaluator_user_id uuid        not null,
  source            text        not null default 'auto' check (source in ('auto', 'manual')),
  status            text        not null default 'assigned' check (status in ('assigned', 'removed')),
  reason            text,
  assigned_by       uuid,
  created_at        timestamptz not null default now(),
  removed_at        timestamptz
);
alter table public.call_eval_assignments enable row level security;
create unique index if not exists call_eval_assignments_one_uq on public.call_eval_assignments (application_id, evaluator_user_id) where status = 'assigned';
create index if not exists call_eval_assignments_call_idx on public.call_eval_assignments (call_id, status);
create index if not exists call_eval_assignments_user_idx on public.call_eval_assignments (evaluator_user_id, status);

create table if not exists public.call_eval_conflicts (
  id                uuid primary key default gen_random_uuid(),
  call_id           uuid        not null references public.calls(id) on delete cascade,
  evaluator_user_id uuid        not null,
  application_id    uuid        references public.call_applications(id) on delete cascade,
  kind              text        not null check (kind in ('auto', 'declared')),
  code              text        not null,
  note              text,
  declared_by       uuid,
  created_at        timestamptz not null default now()
);
alter table public.call_eval_conflicts enable row level security;
create index if not exists call_eval_conflicts_call_idx on public.call_eval_conflicts (call_id, evaluator_user_id);
create unique index if not exists call_eval_conflicts_one_uq on public.call_eval_conflicts (call_id, evaluator_user_id, application_id, kind) where application_id is not null;

create table if not exists public.call_evaluations (
  id                uuid primary key default gen_random_uuid(),
  call_id           uuid        not null references public.calls(id) on delete cascade,
  application_id    uuid        not null references public.call_applications(id) on delete cascade,
  evaluator_user_id uuid        not null,
  submission_id     uuid,
  grid_version      integer     not null check (grid_version >= 1),
  status            text        not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  overall_comment   text        not null default '',
  private_note      text        not null default '',
  grade_percent     numeric(6, 2),
  revision          integer     not null default 0,
  reopened_count    integer     not null default 0,
  submitted_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (application_id, evaluator_user_id)
);
alter table public.call_evaluations enable row level security;
create index if not exists call_evaluations_call_idx on public.call_evaluations (call_id, status);

create table if not exists public.call_eval_scores (
  evaluation_id uuid        not null references public.call_evaluations(id) on delete cascade,
  criterion_id  uuid        not null,
  score         integer     not null,
  comment       text        not null default '',
  updated_at    timestamptz not null default now(),
  primary key (evaluation_id, criterion_id)
);
alter table public.call_eval_scores enable row level security;

create table if not exists public.call_eval_reopenings (
  id            uuid primary key default gen_random_uuid(),
  evaluation_id uuid        not null references public.call_evaluations(id) on delete cascade,
  reopened_by   uuid        not null,
  reason        text        not null check (btrim(reason) <> ''),
  snapshot      jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
alter table public.call_eval_reopenings enable row level security;

create table if not exists public.call_eval_decisions (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid        not null references public.calls(id) on delete cascade,
  application_id uuid        not null references public.call_applications(id) on delete cascade,
  decision       text        not null check (decision in ('advance', 'reject', 'waitlist')),
  note           text,
  decided_by     uuid        not null,
  is_current     boolean     not null default true,
  decided_at     timestamptz not null default now()
);
alter table public.call_eval_decisions enable row level security;
create unique index if not exists call_eval_decisions_current_uq on public.call_eval_decisions (application_id) where is_current;
create index if not exists call_eval_decisions_call_idx on public.call_eval_decisions (call_id) where is_current;

create table if not exists public.call_eval_reminders (
  id                uuid primary key default gen_random_uuid(),
  call_id           uuid        not null references public.calls(id) on delete cascade,
  evaluator_user_id uuid        not null,
  kind              text        not null check (kind in ('3d', '1d')),
  deadline_day      text        not null,
  sent_at           timestamptz not null default now(),
  unique (call_id, evaluator_user_id, kind, deadline_day)
);
alter table public.call_eval_reminders enable row level security;

alter table public.call_notices drop constraint if exists call_notices_kind_check;
alter table public.call_notices add constraint call_notices_kind_check
  check (kind in ('submission_received', 'draft_reminder', 'deadline_extended', 'import_ready', 'import_failed', 'call_cancelled', 'form_changed', 'call_restored', 'eval_assigned', 'eval_reminder'));

revoke all on public.call_eval_settings, public.call_eval_criteria, public.call_eval_templates, public.call_eval_import_runs, public.call_eval_assignments, public.call_eval_conflicts,
  public.call_evaluations, public.call_eval_scores, public.call_eval_reopenings, public.call_eval_decisions, public.call_eval_reminders from public, anon, authenticated;
