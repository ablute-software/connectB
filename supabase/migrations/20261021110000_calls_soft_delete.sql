-- Prompt 918, Adenda 2 (C) — deleting a call, with 30 days to take it back.
--
-- The rule it replaces ("after it opens, only archive") is gone (Nuno, 20/10/2026): a call can be deleted whatever its state. Deleting is NOT instant:
--   1. soft_delete_call  — the call is marked deleted (deleted_at / deleted_by / delete_purge_after = +30 days). An open call is closed at once. Nothing
--                          of it is removed yet, so it can be restored; every reader of `calls` leaves a deleted call out, the link answers "no longer available",
--                          and call_accepting() says no, so nobody can start, save or submit an application on it.
--   2. restore_call      — inside the 30 days, whoever may configure the call brings it back (as it was; a call that was open comes back closed).
--   3. purge_deleted_call — after the 30 days the call goes for good, with its applications, drafts and submissions; the app removes the files from Storage
--                          first. Only a minimal record stays: call_deletions, which has always survived the call.
-- The record is append-only and now carries what happened (event: soft_deleted / restored / purged / the old 'deleted'), who did it and the COUNTS (submitted, drafts,
-- files) — never an applicant's data.
--
-- Additive only: three columns on calls, two on call_deletions, a wider check on call_notices.kind (the applicants are told the call was cancelled), call_accepting()
-- re-created with one more condition, and three functions (service role only, like every other mutation of the Calls area).

-- 1. The call ---------------------------------------------------------------------------------------------------------
alter table public.calls add column if not exists deleted_at          timestamptz;
alter table public.calls add column if not exists deleted_by          uuid;
alter table public.calls add column if not exists delete_purge_after  timestamptz;
create index if not exists calls_deleted_idx on public.calls (delete_purge_after) where deleted_at is not null;

-- 2. The record that survives -----------------------------------------------------------------------------------------
alter table public.call_deletions add column if not exists event  text not null default 'deleted';
alter table public.call_deletions add column if not exists counts jsonb;
alter table public.call_deletions add column if not exists actor  uuid;       -- who did THIS event (deleted_by stays: who deleted the call)
alter table public.call_deletions drop constraint if exists call_deletions_event_check;
alter table public.call_deletions add constraint call_deletions_event_check check (event in ('deleted', 'soft_deleted', 'restored', 'purged'));

-- 3. The applicants are told ------------------------------------------------------------------------------------------
alter table public.call_notices drop constraint if exists call_notices_kind_check;
alter table public.call_notices add constraint call_notices_kind_check
  check (kind in ('submission_received', 'draft_reminder', 'deadline_extended', 'import_ready', 'import_failed', 'call_cancelled'));

-- 4. A deleted call accepts nothing (the server's clock and state decide, as before) ------------------------------------
create or replace function public.call_accepting(p_call uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.calls c
     where c.id = p_call
       and c.deleted_at is null
       and c.status in ('open', 'scheduled')
       and c.opens_at is not null and c.opens_at <= now()
       and (c.closes_at is null or c.closes_at > now()));
$$;

-- 5. Delete (soft) ------------------------------------------------------------------------------------------------------
create or replace function public.soft_delete_call(p_call uuid, p_actor uuid, p_promoter_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c         public.calls;
  n_sub     integer;
  n_drafts  integer;
  n_files   integer;
  purge_at  timestamptz := now() + interval '30 days';
  closed_it boolean := false;
begin
  select * into c from public.calls where id = p_call for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.deleted_at is not null then return jsonb_build_object('ok', false, 'reason', 'already_deleted'); end if;

  select count(*) filter (where status in ('submitted', 'withdrawn')), count(*) filter (where status = 'draft')
    into n_sub, n_drafts from public.call_applications where call_id = p_call;
  select count(*) into n_files from public.call_application_files where call_id = p_call;

  -- An open call is closed at once: nobody is left applying to a call that is going away.
  if c.status = 'open' then closed_it := true; end if;
  update public.calls
     set deleted_at = now(), deleted_by = p_actor, delete_purge_after = purge_at,
         status = case when closed_it then 'closed' else status end,
         closed_at = case when closed_it then now() else closed_at end,
         updated_at = now()
   where id = p_call;

  insert into public.call_deletions
    (call_id, call_name, promoter_kind, promoter_id, promoter_name, status_at_deletion, deleted_by, event, counts, actor)
  values
    (c.id, c.name, c.promoter_kind, coalesce(c.catalog_entity_id, c.incubator_id), p_promoter_name, c.status, p_actor, 'soft_deleted',
     jsonb_build_object('submitted', n_sub, 'drafts', n_drafts, 'files', n_files), p_actor);

  return jsonb_build_object('ok', true, 'call_name', c.name, 'status_before', c.status, 'submitted', n_sub, 'drafts', n_drafts, 'files', n_files,
                            'purge_after', purge_at, 'closed_it', closed_it);
end;
$$;

-- 6. Restore ------------------------------------------------------------------------------------------------------------
create or replace function public.restore_call(p_call uuid, p_actor uuid, p_promoter_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.calls;
begin
  select * into c from public.calls where id = p_call for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.deleted_at is null then return jsonb_build_object('ok', false, 'reason', 'not_deleted'); end if;
  if c.delete_purge_after <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;

  update public.calls set deleted_at = null, deleted_by = null, delete_purge_after = null, updated_at = now() where id = p_call;
  insert into public.call_deletions
    (call_id, call_name, promoter_kind, promoter_id, promoter_name, status_at_deletion, deleted_by, event, actor)
  values
    (c.id, c.name, c.promoter_kind, coalesce(c.catalog_entity_id, c.incubator_id), p_promoter_name, c.status, c.deleted_by, 'restored', p_actor);
  return jsonb_build_object('ok', true, 'call_name', c.name, 'status', c.status);
end;
$$;

-- 7. Purge (after the 30 days; the app has removed the files from Storage already) --------------------------------------
create or replace function public.purge_deleted_call(p_call uuid, p_promoter_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c        public.calls;
  n_sub    integer;
  n_drafts integer;
  n_files  integer;
begin
  select * into c from public.calls where id = p_call for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.deleted_at is null then return jsonb_build_object('ok', false, 'reason', 'not_deleted'); end if;
  if c.delete_purge_after > now() then return jsonb_build_object('ok', false, 'reason', 'too_early'); end if;

  select count(*) filter (where status in ('submitted', 'withdrawn')), count(*) filter (where status = 'draft')
    into n_sub, n_drafts from public.call_applications where call_id = p_call;
  select count(*) into n_files from public.call_application_files where call_id = p_call;

  insert into public.call_deletions
    (call_id, call_name, promoter_kind, promoter_id, promoter_name, status_at_deletion, deleted_by, event, counts)
  values
    (c.id, c.name, c.promoter_kind, coalesce(c.catalog_entity_id, c.incubator_id), p_promoter_name, c.status, c.deleted_by, 'purged',
     jsonb_build_object('submitted', n_sub, 'drafts', n_drafts, 'files', n_files));

  -- A submission is append-only for everybody, including a cascade. A purge is the one thing allowed to remove it, so the guard is lifted for this
  -- transaction only (it is re-enabled below; if anything fails, the transaction rolls back and it was never lifted).
  alter table public.call_application_submissions disable trigger trg_call_submissions_immutable;
  delete from public.call_events where call_id = p_call;     -- call_events.application_id has no cascade
  delete from public.calls where id = p_call;                -- phases, fields, snapshots, applications, submissions, files, notices, team…: in cascade
  alter table public.call_application_submissions enable trigger trg_call_submissions_immutable;

  return jsonb_build_object('ok', true, 'call_name', c.name, 'submitted', n_sub, 'drafts', n_drafts, 'files', n_files);
end;
$$;

revoke all on function public.soft_delete_call(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.restore_call(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.purge_deleted_call(uuid, text) from public, anon, authenticated;
grant execute on function public.soft_delete_call(uuid, uuid, text) to service_role;
grant execute on function public.restore_call(uuid, uuid, text) to service_role;
grant execute on function public.purge_deleted_call(uuid, text) to service_role;
