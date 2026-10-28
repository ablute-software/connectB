-- Prompt 918 (I3, 27/10/2026) — the internal eligibility engine, its queue and its results (spec §7.5, §7.6, §16). Additive only.
-- APPLIED 27/10/2026 to wkjcaoqdvhykrfacsylr (ledger version 20261027181543, name calls_eligibility_engine) after a dry run (a transaction that was rolled back).
--
--   call_processing_tasks          the queue: a submission and its task are written TOGETHER (a trigger on the submission, in the same transaction — an application can never exist without its task).
--                                  States Queued / Processing / Done / Technical failure; retries with a back-off; a task stuck in Processing is taken again; one task per submission, kind and rules version.
--   call_application_eligibility   the result of an evaluation: Fit / Not a fit / To validate, the verdict of each rule (with the reason in plain words and the evidence), and what a person overrode. History is kept:
--                                  one row is current, the earlier ones stay (a new evaluation — a new rules version, a correction — never erases what was decided before).
--   call_eligibility_corrections   every human correction, kept as an EXAMPLE for measuring the engine: the rule, what the engine said and why, what the person decided, who, why, when — and whether it is an exception of
--                                  this call or a recognition error. Per call; nothing here crosses to another call.
--
-- Same trust boundary as the other calls tables: RLS on, no access for anon/authenticated — everything goes through our routes with the service role.

create table if not exists public.call_processing_tasks (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid        not null references public.calls(id) on delete cascade,
  application_id uuid        not null references public.call_applications(id) on delete cascade,
  submission_id  uuid        not null references public.call_application_submissions(id) on delete cascade,
  kind           text        not null default 'eligibility' check (kind in ('eligibility')),
  rules_version  integer     not null default 1 check (rules_version >= 1),
  status         text        not null default 'queued' check (status in ('queued', 'processing', 'done', 'technical_failure')),
  attempts       integer     not null default 0 check (attempts >= 0),
  max_attempts   integer     not null default 5 check (max_attempts >= 1),
  run_after      timestamptz not null default now(),
  locked_at      timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  unique (submission_id, kind, rules_version)
);
alter table public.call_processing_tasks enable row level security;
create index if not exists call_processing_tasks_queue_idx on public.call_processing_tasks (status, run_after, created_at);
create index if not exists call_processing_tasks_call_idx on public.call_processing_tasks (call_id, status);

-- A submission and its task are saved together: never one without the other.
create or replace function public.call_enqueue_eligibility_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c uuid;
  v integer;
begin
  select a.call_id, k.eligibility_version into c, v
    from public.call_applications a join public.calls k on k.id = a.call_id
   where a.id = new.application_id;
  insert into public.call_processing_tasks (call_id, application_id, submission_id, kind, rules_version)
  values (c, new.application_id, new.id, 'eligibility', coalesce(v, 1))
  on conflict (submission_id, kind, rules_version) do nothing;
  return new;
end;
$$;
revoke execute on function public.call_enqueue_eligibility_task() from public, anon, authenticated;
drop trigger if exists trg_call_submission_enqueue on public.call_application_submissions;
create trigger trg_call_submission_enqueue
  after insert on public.call_application_submissions
  for each row execute function public.call_enqueue_eligibility_task();

-- Takes the next tasks (and any stuck in Processing for longer than p_stale_minutes), safely for several runners at once.
create or replace function public.claim_call_tasks(p_limit integer, p_stale_minutes integer default 10)
returns setof public.call_processing_tasks
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select t.id from public.call_processing_tasks t
     where (t.status = 'queued' and t.run_after <= now())
        or (t.status = 'processing' and t.locked_at < now() - make_interval(mins => p_stale_minutes))
     order by t.created_at asc
     limit greatest(p_limit, 0)
     for update skip locked
  )
  update public.call_processing_tasks t
     set status = 'processing', locked_at = now(), started_at = coalesce(t.started_at, now()), attempts = t.attempts + 1
    from picked
   where t.id = picked.id
  returning t.*;
end;
$$;
revoke execute on function public.claim_call_tasks(integer, integer) from public, anon, authenticated;

create table if not exists public.call_application_eligibility (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid        not null references public.calls(id) on delete cascade,
  application_id uuid        not null references public.call_applications(id) on delete cascade,
  submission_id  uuid        not null references public.call_application_submissions(id) on delete cascade,
  rules_version  integer     not null check (rules_version >= 1),
  status         text        not null check (status in ('fit', 'not_fit', 'to_validate')),
  -- engine = the automatic result; human = a person reclassified it; flag = a person asked for it to be validated.
  source         text        not null default 'engine' check (source in ('engine', 'human', 'flag')),
  -- [{ruleId, kind, fieldId, outcome: pass|fail|validate, reason, evidence}] as the engine produced them, and what a person overrode: {ruleId: {outcome, by, why, at}}.
  rule_results   jsonb       not null default '[]'::jsonb check (jsonb_typeof(rule_results) = 'array'),
  overrides      jsonb       not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object'),
  -- The sentence a person reads: why this application is in this list.
  reason         text,
  is_current     boolean     not null default true,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
alter table public.call_application_eligibility enable row level security;
create unique index if not exists call_application_eligibility_current_uq on public.call_application_eligibility (application_id) where is_current;
create index if not exists call_application_eligibility_call_idx on public.call_application_eligibility (call_id, status) where is_current;

create table if not exists public.call_eligibility_corrections (
  id               uuid primary key default gen_random_uuid(),
  call_id          uuid        not null references public.calls(id) on delete cascade,
  application_id   uuid        not null references public.call_applications(id) on delete cascade,
  submission_id    uuid,
  rule_id          uuid,
  rule_kind        text,
  doc_type         text,
  rules_version    integer,
  engine_status    text,
  engine_outcome   text,
  engine_reason    text,
  engine_evidence  jsonb,
  human_outcome    text        not null check (human_outcome in ('pass', 'fail', 'fit', 'not_fit', 'to_validate')),
  author_user_id   uuid        not null,
  justification    text        not null check (btrim(justification) <> ''),
  -- true: an exception of THIS call; false: the engine got it wrong (a recognition error).
  is_call_exception boolean    not null default false,
  created_at       timestamptz not null default now()
);
alter table public.call_eligibility_corrections enable row level security;
create index if not exists call_eligibility_corrections_call_idx on public.call_eligibility_corrections (call_id, created_at desc);

revoke all on public.call_processing_tasks, public.call_application_eligibility, public.call_eligibility_corrections from public, anon, authenticated;

-- What was submitted BEFORE the engine existed gets its task too (the trigger only sees new submissions): the same rule — no submitted application without a task.
insert into public.call_processing_tasks (call_id, application_id, submission_id, kind, rules_version)
select a.call_id, a.id, a.current_submission_id, 'eligibility', coalesce(k.eligibility_version, 1)
  from public.call_applications a join public.calls k on k.id = a.call_id
 where a.status = 'submitted' and a.current_submission_id is not null
on conflict (submission_id, kind, rules_version) do nothing;
