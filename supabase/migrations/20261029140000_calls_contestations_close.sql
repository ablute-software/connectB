-- Prompt 924 (Etapa 4, I3, 29/10/2026) — contestations, completing a call, and keeping the applicants' data for a limited time. Additive only.
-- APPLIED 29/10/2026 to wkjcaoqdvhykrfacsylr (ledger version 20261029131202, name calls_contestations_close) after a dry run (a DO block that ended in DRYRUN_OK).
--
--   calls.status accepts 'completed'   the call is finished: everything is read-only (the server refuses every write but the few that make sense afterwards: delete, archive, postpone the deletion).
--   calls.completed_at / completed_by  when and by whom.
--   calls.data_purge_after             when the applicants' data goes: completed_at + the months the call chose (24 by default — Nuno, 28/10/2026). The administrator is warned 30 days before
--                                      (data_purge_warned_at) and may export or postpone ONCE, with a reason (data_purge_extended_at / _reason). data_purged_at: it has gone.
--   call_contestations                 an applicant's contestation of a "Not selected": the reason (required), at most one file, who answered, Upheld or Rejected, the written response, and — for Upheld — the new
--                                      result that replaced the old one. ONE per application and phase (unique index). The email of the answer is recorded (email_sent_at / email_error): a failure never hides the answer in the app.
--   call_data_summaries                what stays when the data goes: a summary WITHOUT personal data (counts, criteria, aggregated decisions). No foreign key: it outlives the call's own deletion.
--   purge_completed_call_data()        the end of the retention: records the summary, then removes the applications of the call (and with them their answers, submissions, files, evaluations, results and
--                                      contestations, in cascade), its notices and events about applicants and the record of which startups reached it. The app removes the files from Storage FIRST. Same guard as purge_deleted_call.

alter table public.calls drop constraint if exists calls_status_check;
alter table public.calls add constraint calls_status_check
  check (status in ('draft', 'validated', 'scheduled', 'open', 'closed', 'evaluating', 'results_published', 'completed', 'archived'));
alter table public.calls add column if not exists completed_at timestamptz;
alter table public.calls add column if not exists completed_by uuid;
alter table public.calls add column if not exists data_purge_after timestamptz;
alter table public.calls add column if not exists data_purge_warned_at timestamptz;
alter table public.calls add column if not exists data_purge_extended_at timestamptz;
alter table public.calls add column if not exists data_purge_extended_reason text;
alter table public.calls add column if not exists data_purged_at timestamptz;

create table if not exists public.call_contestations (
  id                 uuid primary key default gen_random_uuid(),
  call_id            uuid        not null references public.calls(id) on delete cascade,
  application_id     uuid        not null references public.call_applications(id) on delete cascade,
  phase_id           uuid        references public.call_phases(id) on delete set null,
  result_id          uuid        references public.call_results(id) on delete set null,
  user_id            uuid        not null,
  reason             text        not null check (btrim(reason) <> ''),
  file_name          text,
  storage_path       text,
  file_size          integer,
  status             text        not null default 'open' check (status in ('open', 'upheld', 'rejected')),
  response           text,
  answered_by        uuid,
  answered_at        timestamptz,
  new_result_id      uuid        references public.call_results(id) on delete set null,
  email_sent_at      timestamptz,
  email_error        text,
  created_at         timestamptz not null default now(),
  check (status = 'open' or (answered_by is not null and answered_at is not null))
);
alter table public.call_contestations enable row level security;
create unique index if not exists call_contestations_one_uq on public.call_contestations (application_id, coalesce(phase_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists call_contestations_call_idx on public.call_contestations (call_id, status);

create table if not exists public.call_data_summaries (
  call_id      uuid primary key,
  call_name    text        not null,
  completed_at timestamptz,
  purged_at    timestamptz not null default now(),
  summary      jsonb       not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object')
);
alter table public.call_data_summaries enable row level security;

create or replace function public.purge_completed_call_data(p_call uuid, p_summary jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c      public.calls;
  n_apps integer;
begin
  select * into c from public.calls where id = p_call for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status <> 'completed' then return jsonb_build_object('ok', false, 'reason', 'not_completed'); end if;
  if c.data_purged_at is not null then return jsonb_build_object('ok', false, 'reason', 'already_purged'); end if;
  if c.data_purge_after is null or c.data_purge_after > now() then return jsonb_build_object('ok', false, 'reason', 'too_early'); end if;

  select count(*) into n_apps from public.call_applications where call_id = p_call;
  insert into public.call_data_summaries (call_id, call_name, completed_at, purged_at, summary)
  values (c.id, c.name, c.completed_at, now(), coalesce(p_summary, '{}'::jsonb) || jsonb_build_object('applications', n_apps))
  on conflict (call_id) do update set purged_at = now(), summary = excluded.summary;

  -- A submission is append-only for everybody, including a cascade; the end of the retention is the one thing allowed to remove it (same guard as purge_deleted_call: lifted for this transaction only).
  alter table public.call_application_submissions disable trigger trg_call_submissions_immutable;
  delete from public.call_events where call_id = p_call and application_id is not null;     -- no cascade on application_id
  delete from public.call_notices where call_id = p_call;
  delete from public.call_link_access where call_id = p_call;
  delete from public.call_applications where call_id = p_call;                                -- answers, submissions, files, evaluations, decisions, results, contestations…: in cascade
  alter table public.call_application_submissions enable trigger trg_call_submissions_immutable;
  update public.calls set data_purged_at = now(), updated_at = now() where id = p_call;

  return jsonb_build_object('ok', true, 'applications', n_apps);
end;
$$;

revoke all on public.call_contestations, public.call_data_summaries from public, anon, authenticated;
revoke all on function public.purge_completed_call_data(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.purge_completed_call_data(uuid, jsonb) to service_role;
