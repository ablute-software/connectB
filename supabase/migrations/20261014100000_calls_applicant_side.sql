-- Prompt 907 — Calls, Stage 1B: the applicant side (docs/calls/SPEC_CALLS_V2.md §6.4, §6.6, §13, §14, §20, §23).
--
-- APPLIED to production on 14/10/2026 (pre-authorised: strictly additive), after a dry run inside a transaction that always rolls
-- back: per-unit limit, create-or-resume, idempotent submission (same key -> same submission, another key -> already submitted),
-- immutability of the submitted version, the server clock closing the call, and the privileges (anon cannot execute the
-- functions, authenticated cannot read the new tables) all behaved as specified and nothing persisted.
--
-- The Stage 1 data model (migration 20261009150000) already has the call, its fields, the applications (a draft that is edited and
-- a submitted version that is immutable) and the history. This migration only ADDS what the applicant side needs on top of it.
-- STRICTLY ADDITIVE: new columns (nullable or defaulted) on calls / call_applications / call_source_documents, new tables, new
-- functions; nothing existing is altered or dropped.
--
-- Same trust boundary as every Calls table: RLS on, NO policy and no grant for anon/authenticated on the new tables — they are
-- reached only by our routes with the service role, which re-check the caller (a member of the startup that owns the application).
--
-- 1. calls.contact_email            — "Contact email for applicants" (§23): when set, the Reply-To of the emails of THAT call.
-- 2. call_source_documents.public_to_applicants — the regulation PDF the link page offers (only a PDF the team marks public).
-- 3. call_applications              — reference (what the applicant sees), unit_key (the per-call limit), last_page (resume where
--                                     the applicant was), draft_revision (autosave concurrency), submitted_at.
-- 4. call_link_access               — an unlisted call ("closed — link only") the startup reached by its link, so it shows in the
--                                     startup's own list afterwards.
-- 5. call_application_files         — a file in an application, uploaded by the applicant or chosen from the Vault. For a Vault
--                                     file this row IS the authorisation "in the name of the call" (never of evaluators); it pins
--                                     the version. At submission the file is copied (frozen_path) so what was submitted can never
--                                     change, whatever happens to the Vault afterwards.
-- 6. call_notices                   — the in-app notice (same pattern as investor_seat_notices: shown until seen), one per event
--                                     and person (dedupe_key), which is also what stops a reminder going out twice.
-- 7. call_open_application()        — create-or-resume the applicant's draft, under a lock, honouring the per-unit limit.
--    call_submit_application()      — the submission itself: one transaction, idempotent, server clock, immutable version.

-- 1. -------------------------------------------------------------------------------------------------------------------
alter table public.calls add column if not exists contact_email text;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'calls_contact_email_shape') then
    alter table public.calls add constraint calls_contact_email_shape
      check (contact_email is null or contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$');
  end if;
end $c$;

-- 2. -------------------------------------------------------------------------------------------------------------------
alter table public.call_source_documents add column if not exists public_to_applicants boolean not null default false;

-- 3. -------------------------------------------------------------------------------------------------------------------
alter table public.call_applications add column if not exists reference       text;
alter table public.call_applications add column if not exists unit_key        text;
alter table public.call_applications add column if not exists last_page       integer check (last_page is null or last_page >= 1);
alter table public.call_applications add column if not exists draft_revision  integer not null default 0;
alter table public.call_applications add column if not exists submitted_at    timestamptz;
create unique index if not exists call_applications_reference_uidx on public.call_applications (reference) where reference is not null;
create index if not exists call_applications_unit_idx on public.call_applications (call_id, unit_key) where status <> 'withdrawn';

-- 4. -------------------------------------------------------------------------------------------------------------------
create table if not exists public.call_link_access (
  call_id         uuid        not null references public.calls(id) on delete cascade,
  org_id          uuid        not null references public.orgs(id) on delete cascade,
  user_id         uuid        not null,
  first_opened_at timestamptz not null default now(),
  primary key (call_id, org_id)
);
alter table public.call_link_access enable row level security;
create index if not exists call_link_access_org_idx on public.call_link_access (org_id);

-- 5. -------------------------------------------------------------------------------------------------------------------
create table if not exists public.call_application_files (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid        not null references public.call_applications(id) on delete cascade,
  call_id        uuid        not null references public.calls(id) on delete cascade,
  org_id         uuid        not null references public.orgs(id) on delete cascade,
  field_id       uuid        not null,
  source         text        not null check (source in ('upload', 'vault')),
  file_name      text        not null check (btrim(file_name) <> ''),
  size_bytes     bigint      not null check (size_bytes >= 0),
  sha256         text,
  -- Where the bytes are NOW (the applicant's own folder for an upload; the Vault version for a vault file).
  storage_path   text        not null,
  -- Vault files only: which document and which version was pinned.
  document_id    uuid        references public.documents(id) on delete set null,
  version_id     uuid,
  version_number integer,
  created_by     uuid        not null,
  created_at     timestamptz not null default now(),
  -- Vault files: the authorisation in the name of the call ends here (e.g. when the call is archived).
  revoked_at     timestamptz,
  -- Set at submission: the copy that belongs to the submitted version and never changes.
  frozen_path    text,
  frozen_at      timestamptz
);
alter table public.call_application_files enable row level security;
create index if not exists call_application_files_app_idx on public.call_application_files (application_id, field_id);
create index if not exists call_application_files_call_idx on public.call_application_files (call_id) where source = 'vault' and revoked_at is null;

-- 6. -------------------------------------------------------------------------------------------------------------------
create table if not exists public.call_notices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  call_id        uuid        not null references public.calls(id) on delete cascade,
  application_id uuid        references public.call_applications(id) on delete cascade,
  kind           text        not null check (kind in ('submission_received', 'draft_reminder', 'deadline_extended')),
  title          text        not null,
  body           text,
  link_path      text,
  -- One notice per event and person: "reminder_48h:<application>:<closes_at>", "submitted:<application>", "extended:<call>:<closes_at>".
  dedupe_key     text        not null,
  created_at     timestamptz not null default now(),
  seen_at        timestamptz,
  email_sent_at  timestamptz,
  email_error    text,
  unique (user_id, dedupe_key)
);
alter table public.call_notices enable row level security;
create index if not exists call_notices_unseen_idx on public.call_notices (user_id) where seen_at is null;

-- Every new table: closed to anon/authenticated (the service role bypasses RLS and keeps its grants).
revoke all on public.call_link_access, public.call_application_files, public.call_notices from public, anon, authenticated;

-- 7a. Does the call accept submissions RIGHT NOW? The server's clock decides (§14.4), never the browser's, and never a stale
-- `status`: a scheduled call whose time has come is open, an open one past its deadline is not.
create or replace function public.call_accepting(p_call uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.calls c
     where c.id = p_call
       and c.status in ('open', 'scheduled')
       and c.opens_at is not null and c.opens_at <= now()
       and (c.closes_at is null or c.closes_at > now()));
$$;

-- 7b. Create the applicant's draft, or resume it. Serialised per (call, unit) so two requests at once give ONE application, and the
-- per-unit limit (§5.1: one per project/startup or one per legal entity) is checked inside the same lock. With several allowed per
-- unit a new draft is only created when asked for (p_new), otherwise the latest draft of that startup is resumed.
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

  insert into public.call_applications (call_id, startup_org_id, applicant_user_id, status, unit_key, reference)
  values (p_call, p_org, p_user, 'draft', p_unit_key, p_reference)
  returning * into a;
  insert into public.call_events (call_id, application_id, event, actor_user_id, detail)
  values (p_call, a.id, 'application_started', p_user, jsonb_build_object('reference', p_reference));
  return jsonb_build_object('ok', true, 'application_id', a.id, 'created', true, 'status', 'draft');
end $$;

-- 7c. The submission: ONE transaction, under a lock on the application, so a double click or two parallel requests produce a single
-- submission (the second finds the first by its idempotency key and returns it). It re-checks on the server's clock that the call
-- still accepts submissions, the per-unit limit, and that the application is still a draft; it stores an immutable version (the
-- table has a trigger that forbids update and delete). The caller has already validated the answers and frozen the files.
create or replace function public.call_submit_application(
  p_application uuid, p_user uuid, p_key text, p_answers jsonb, p_documents jsonb, p_form_snapshot jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.call_applications%rowtype;
  c public.calls%rowtype;
  s public.call_application_submissions%rowtype;
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

  return jsonb_build_object('ok', true, 'already', false, 'submission_id', s.id, 'version', s.version, 'submitted_at', s.submitted_at);
end $$;

revoke execute on function public.call_accepting(uuid) from public, anon, authenticated;
revoke execute on function public.call_open_application(uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.call_submit_application(uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.call_accepting(uuid) to service_role;
grant execute on function public.call_open_application(uuid, uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.call_submit_application(uuid, uuid, text, jsonb, jsonb, jsonb) to service_role;
