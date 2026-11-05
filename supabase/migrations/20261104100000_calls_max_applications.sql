-- APPLIED on 04/11/2026 to wkjcaoqdvhykrfacsylr (dry run in a rolled-back transaction first), before the code that reads it was deployed.
-- Prompt 929 (A, 04/11/2026) — a maximum number of applications per call. Additive only.
--
--   calls.max_applications   the maximum number of SUBMITTED applications (drafts do not count); null = no limit.
--   calls.show_places_left   show "37 places left" on the entry page (off by default).
--   calls.full_at            when the call became full (null while it has room): the moment drafts are told, once.
--   call_notices.kind        'call_full' (to whoever had a draft), 'call_reopened' (the limit was raised: "accepting applications again"), 'call_full_late' (to who arrived after: sent by Sherlock Deal).
--   user_email_preferences   the applicant's choice about emails from Sherlock Deal itself (not from the entity): `tips_opt_out` (tips and the "call is full" email; unchecked by default) and `announcements_opt_out`
--                            (reserved for the call announcements of Prompt 930). One row per account; the audit trail is `user_email_preference_changes`.
--   call_is_full(), call_open_application(), call_submit_application()   the check is INSIDE the transaction that starts / submits (the submission also sets full_at), so the last place is never given twice.
-- Service role only (RLS on, nothing granted), like every other calls table.

alter table public.calls add column if not exists max_applications integer check (max_applications is null or max_applications >= 1);
alter table public.calls add column if not exists show_places_left boolean not null default false;
alter table public.calls add column if not exists full_at timestamptz;

alter table public.call_notices drop constraint if exists call_notices_kind_check;
alter table public.call_notices add constraint call_notices_kind_check
  check (kind in ('submission_received', 'draft_reminder', 'deadline_extended', 'import_ready', 'import_failed', 'call_cancelled', 'form_changed', 'call_restored', 'eval_assigned', 'eval_reminder',
                  'result_published', 'contestation_received', 'contestation_answered', 'call_full', 'call_reopened', 'call_full_late'));

create table if not exists public.user_email_preferences (
  user_id               uuid primary key,
  tips_opt_out          boolean     not null default false,
  announcements_opt_out boolean     not null default false,
  updated_at            timestamptz not null default now()
);
alter table public.user_email_preferences enable row level security;
create table if not exists public.user_email_preference_changes (
  id         bigserial primary key,
  user_id    uuid        not null,
  preference text        not null check (preference in ('tips_opt_out', 'announcements_opt_out')),
  value      boolean     not null,
  via        text        not null check (btrim(via) <> ''),
  at         timestamptz not null default now()
);
alter table public.user_email_preference_changes enable row level security;
create index if not exists user_email_preference_changes_user_idx on public.user_email_preference_changes (user_id, at desc);
revoke all on public.user_email_preferences, public.user_email_preference_changes from anon, authenticated;
revoke all on sequence public.user_email_preference_changes_id_seq from anon, authenticated;

create or replace function public.call_is_full(p_call uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.calls c
     where c.id = p_call and c.max_applications is not null
       and (select count(*) from public.call_applications a where a.call_id = c.id and a.status = 'submitted') >= c.max_applications);
$$;
revoke execute on function public.call_is_full(uuid) from public, anon, authenticated;
grant execute on function public.call_is_full(uuid) to service_role;

create or replace function public.call_open_application(
  p_call uuid, p_org uuid, p_user uuid, p_unit_key text, p_reference text, p_new boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.calls%rowtype;
  a public.call_applications%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_call::text || '|' || coalesce(p_unit_key, ''), 0));
  select * into c from public.calls where id = p_call;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if not c.allow_multiple then
    -- One per unit: the existing one (draft or submitted) of this unit is THE application.
    select * into a from public.call_applications
     where call_id = p_call and unit_key = p_unit_key and status <> 'withdrawn'
     order by created_at limit 1;
    if found then
      if a.startup_org_id is distinct from p_org then
        return jsonb_build_object('ok', false, 'reason', 'unit_limit');
      end if;
      return jsonb_build_object('ok', true, 'application_id', a.id, 'created', false, 'status', a.status);
    end if;
  else
    if not p_new then
      select * into a from public.call_applications
       where call_id = p_call and startup_org_id = p_org and status = 'draft'
       order by updated_at desc limit 1;
      if found then
        return jsonb_build_object('ok', true, 'application_id', a.id, 'created', false, 'status', a.status);
      end if;
    end if;
  end if;

  if not public.call_accepting(p_call) then
    return jsonb_build_object('ok', false, 'reason', 'not_accepting');
  end if;

  -- Prompt 929 (A): a call that reached its maximum number of SUBMITTED applications takes no new ones (a draft already started is resumed above, and cannot be submitted).
  if c.max_applications is not null and (select count(*) from public.call_applications where call_id = p_call and status = 'submitted') >= c.max_applications then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  insert into public.call_applications (call_id, startup_org_id, applicant_user_id, status, unit_key, reference)
  values (p_call, p_org, p_user, 'draft', p_unit_key, p_reference)
  returning * into a;
  insert into public.call_events (call_id, application_id, event, actor_user_id, detail)
  values (p_call, a.id, 'application_started', p_user, jsonb_build_object('reference', p_reference));
  return jsonb_build_object('ok', true, 'application_id', a.id, 'created', true, 'status', 'draft');
end $$;

create or replace function public.call_submit_application(
  p_application uuid, p_user uuid, p_key text, p_answers jsonb, p_documents jsonb, p_form_snapshot jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.call_applications%rowtype;
  c public.calls%rowtype;
  s public.call_application_submissions%rowtype;
  n integer;
  became_full boolean := false;
begin
  select * into a from public.call_applications where id = p_application for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  -- The same request again (double click, a retry after a flaky network): the answer is the original submission.
  select * into s from public.call_application_submissions where application_id = p_application and idempotency_key = p_key;
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'submission_id', s.id, 'version', s.version, 'submitted_at', s.submitted_at);
  end if;

  if a.status <> 'draft' then return jsonb_build_object('ok', false, 'reason', 'already_submitted'); end if;

  select * into c from public.calls where id = a.call_id;
  if not public.call_accepting(a.call_id) then return jsonb_build_object('ok', false, 'reason', 'not_accepting'); end if;

  -- Prompt 929 (A): the maximum number of applications. The count and the submission are ONE transaction under a lock of the call, so two applicants at the last place never both get it: the second finds the call full.
  perform pg_advisory_xact_lock(hashtextextended('call-full|' || a.call_id::text, 0));
  select count(*) into n from public.call_applications where call_id = a.call_id and status = 'submitted';
  if c.max_applications is not null and n >= c.max_applications then return jsonb_build_object('ok', false, 'reason', 'full'); end if;

  if not c.allow_multiple and exists (
    select 1 from public.call_applications o
     where o.call_id = a.call_id and o.unit_key = a.unit_key and o.id <> a.id and o.status = 'submitted') then
    return jsonb_build_object('ok', false, 'reason', 'unit_limit');
  end if;

  insert into public.call_application_submissions (application_id, version, answers, documents, form_snapshot, submitted_by, idempotency_key)
  values (a.id, 1, p_answers, coalesce(p_documents, '[]'::jsonb), p_form_snapshot, p_user, p_key)
  returning * into s;

  update public.call_applications
     set status = 'submitted', current_submission_id = s.id, submitted_at = s.submitted_at, updated_at = now()
   where id = a.id;
  insert into public.call_events (call_id, application_id, event, actor_user_id, detail)
  values (a.call_id, a.id, 'application_submitted', p_user, jsonb_build_object('reference', a.reference, 'version', 1));

  if c.max_applications is not null and n + 1 >= c.max_applications then
    update public.calls set full_at = coalesce(full_at, now()) where id = a.call_id and full_at is null;
    became_full := found;
  end if;

  return jsonb_build_object('ok', true, 'already', false, 'submission_id', s.id, 'version', s.version, 'submitted_at', s.submitted_at, 'became_full', became_full);
end $$;

revoke execute on function public.call_open_application(uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.call_open_application(uuid, uuid, uuid, text, text, boolean) to service_role;
revoke execute on function public.call_submit_application(uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.call_submit_application(uuid, uuid, text, jsonb, jsonb, jsonb) to service_role;
