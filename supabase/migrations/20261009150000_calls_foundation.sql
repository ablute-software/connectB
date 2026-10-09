-- Prompt 905 — Calls, Stage 1 data model (docs/calls/SPEC_CALLS_V2.md §5, §6, §8, §14, §22).
--
-- ONE migration for the whole of Stage 1 — the entity side (905) and the applicant side (906) — so 906
-- does not have to redo it. STRICTLY ADDITIVE: new tables, new functions, new triggers on the NEW tables
-- only; no existing object is altered. (Stage 3 adds team/evaluation tables of its own.)
--
-- APPLIED to production on 09/10/2026 at 15:24:44Z (pre-authorised by Nuno because it is strictly additive), after a
-- dry run inside a transaction that always rolls back: constraints, immutability, cross-entity isolation and privileges
-- all behaved as specified and nothing persisted.
--
-- Isolation: RLS is on everywhere and the only grant to `authenticated` is SELECT, through two functions
-- that look at the caller's membership of the promoting entity. Every write goes through our routes with
-- the service role, which re-check the caller (owner/admin of the promoter) — belt and braces, as the
-- back-office routes do. Nothing here is reachable by anon.
--
-- Event types are free text on purpose (a CHECK list would need altering in each later stage).

-- 1. Who may see / manage a call ---------------------------------------------------------------
-- A promoter is an investor firm (catalog entity; members in matchdeal_investor_members) or an ecosystem
-- organisation (incubators; members in incubator_members). Seeing = any active member of the promoter.
-- Managing in Stage 1 = owner/admin of an investor firm, owner/manager of an ecosystem organisation (the
-- highest roles each side has; finer permission categories arrive in Stage 3).
create table if not exists public.calls (
  id                 uuid primary key default gen_random_uuid(),
  promoter_kind      text        not null check (promoter_kind in ('catalog_entity', 'incubator')),
  catalog_entity_id  uuid        references public.catalog_entities(id) on delete cascade,
  incubator_id       uuid        references public.incubators(id) on delete cascade,
  name               text        not null check (btrim(name) <> ''),
  description        text,
  opens_at           timestamptz,
  closes_at          timestamptz,
  timezone           text        not null default 'Europe/Lisbon',
  visibility         text        not null default 'listed' check (visibility in ('listed', 'unlisted')),
  limit_unit         text        not null default 'project' check (limit_unit in ('project', 'legal_entity')),
  allow_multiple     boolean     not null default false,
  content_language   text        not null default 'en',
  currency           text        not null default 'EUR',
  status             text        not null default 'draft' check (status in (
    'draft', 'validated', 'scheduled', 'open', 'closed', 'evaluating', 'results_published', 'archived')),
  -- Generated when the call is published (§13.1); unique when present.
  link_token         text        unique,
  -- Bumped on every configuration change: optimistic concurrency for the editor's autosave, and the
  -- version a confirmation refers to.
  config_version     integer     not null default 1,
  validated_at       timestamptz,
  validated_by       uuid,
  published_at       timestamptz,
  closed_at          timestamptz,
  duplicated_from    uuid        references public.calls(id) on delete set null,
  created_by         uuid        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint calls_one_promoter check (
    (promoter_kind = 'catalog_entity' and catalog_entity_id is not null and incubator_id is null)
    or (promoter_kind = 'incubator' and incubator_id is not null and catalog_entity_id is null)),
  constraint calls_dates_ordered check (opens_at is null or closes_at is null or closes_at > opens_at)
);
alter table public.calls enable row level security;
create index if not exists calls_catalog_entity_idx on public.calls (catalog_entity_id) where catalog_entity_id is not null;
create index if not exists calls_incubator_idx on public.calls (incubator_id) where incubator_id is not null;
create index if not exists calls_status_idx on public.calls (status);

create or replace function public.calls_is_member(p_call_id uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.calls c
     where c.id = p_call_id
       and (
         (c.promoter_kind = 'catalog_entity' and exists (
            select 1 from public.matchdeal_investor_members m
             where m.catalog_entity_id = c.catalog_entity_id and m.user_id = p_user and m.status = 'active'))
         or (c.promoter_kind = 'incubator' and exists (
            select 1 from public.incubator_members i
             where i.incubator_id = c.incubator_id and i.user_id = p_user and i.status = 'active'))
       ));
$$;

create or replace function public.calls_can_manage(p_call_id uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.calls c
     where c.id = p_call_id
       and (
         (c.promoter_kind = 'catalog_entity' and exists (
            select 1 from public.matchdeal_investor_members m
             where m.catalog_entity_id = c.catalog_entity_id and m.user_id = p_user and m.status = 'active'
               and m.role in ('owner', 'admin')))
         or (c.promoter_kind = 'incubator' and exists (
            select 1 from public.incubator_members i
             where i.incubator_id = c.incubator_id and i.user_id = p_user and i.status = 'active'
               and i.role in ('owner', 'manager')))
       ));
$$;

-- 2. Phases (§5.2) — ordered; only the structure in Stage 1 ----------------------------------------
create table if not exists public.call_phases (
  id         uuid primary key default gen_random_uuid(),
  call_id    uuid        not null references public.calls(id) on delete cascade,
  position   integer     not null check (position >= 0),
  name       text        not null check (btrim(name) <> ''),
  starts_on  date,
  ends_on    date,
  created_at timestamptz not null default now(),
  constraint call_phases_dates_ordered check (starts_on is null or ends_on is null or ends_on >= starts_on)
);
alter table public.call_phases enable row level security;
create index if not exists call_phases_call_idx on public.call_phases (call_id, position);

-- 3. Form fields (§6.1–6.6) -----------------------------------------------------------------------
-- A row per field, with a STABLE id (the editor may supply it): eligibility, filters, distribution and
-- quotas will refer to fields and to option ids, never to labels or positions. Options live in jsonb as
-- [{"id": "...", "label": "..."}] with ids that survive renaming.
create table if not exists public.call_form_fields (
  id               uuid primary key default gen_random_uuid(),
  call_id          uuid        not null references public.calls(id) on delete cascade,
  page             integer     not null default 1 check (page >= 1),
  position         integer     not null default 0 check (position >= 0),
  kind             text        not null check (kind in (
    'short_text', 'long_text', 'number', 'date', 'yes_no', 'single_choice', 'multiple_choice', 'file')),
  label            text        not null check (btrim(label) <> ''),
  instruction      text,
  required         boolean     not null default false,
  options          jsonb       not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  validations      jsonb       not null default '{}'::jsonb check (jsonb_typeof(validations) = 'object'),
  -- {"fieldId": "...", "operator": "equals|not_equals|is_answered|is_empty", "value": ...} or null.
  condition        jsonb       check (condition is null or jsonb_typeof(condition) = 'object'),
  -- Explicit link to a platform datum (§6.4): company_name, country, person_name, person_role, sector,
  -- stage, website. Null = not linked.
  platform_mapping text,
  -- Documents only (§6.6): what is expected and how old it may be.
  expected_type    text,
  max_age_months   integer     check (max_age_months is null or max_age_months > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.call_form_fields enable row level security;
create index if not exists call_form_fields_call_idx on public.call_form_fields (call_id, page, position);

-- 4. Confirmed configurations (§22: "configurações confirmadas") — append-only --------------------------
create table if not exists public.call_config_snapshots (
  id           uuid primary key default gen_random_uuid(),
  call_id      uuid        not null references public.calls(id) on delete cascade,
  version      integer     not null,
  snapshot     jsonb       not null,
  confirmed_by uuid        not null,
  confirmed_at timestamptz not null default now()
);
alter table public.call_config_snapshots enable row level security;
create index if not exists call_config_snapshots_call_idx on public.call_config_snapshots (call_id, version);

-- 5. Applications (used by Prompt 906) --------------------------------------------------------------
create table if not exists public.call_applications (
  id                    uuid primary key default gen_random_uuid(),
  call_id               uuid        not null references public.calls(id) on delete cascade,
  startup_org_id        uuid        references public.orgs(id) on delete set null,
  applicant_user_id     uuid        not null,
  status                text        not null default 'draft' check (status in ('draft', 'submitted', 'withdrawn')),
  -- The working copy: {fieldId: value}. Only the submitted version below is immutable.
  draft_answers         jsonb       not null default '{}'::jsonb check (jsonb_typeof(draft_answers) = 'object'),
  current_submission_id uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.call_applications enable row level security;
create index if not exists call_applications_call_idx on public.call_applications (call_id, status);
create index if not exists call_applications_user_idx on public.call_applications (applicant_user_id);
create index if not exists call_applications_org_idx on public.call_applications (startup_org_id) where startup_org_id is not null;

-- The submitted version: answers and document references FIXED at submission, never updated or deleted.
create table if not exists public.call_application_submissions (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid        not null references public.call_applications(id) on delete cascade,
  version         integer     not null check (version >= 1),
  answers         jsonb       not null check (jsonb_typeof(answers) = 'object'),
  documents       jsonb       not null default '[]'::jsonb check (jsonb_typeof(documents) = 'array'),
  form_snapshot   jsonb       not null,
  submitted_by    uuid        not null,
  submitted_at    timestamptz not null default now(),
  -- A retry of the same submit (double click, flaky network) must not create a second version.
  idempotency_key text        not null check (btrim(idempotency_key) <> ''),
  unique (application_id, version),
  unique (application_id, idempotency_key)
);
alter table public.call_application_submissions enable row level security;

-- 6. History of the call and of its applications (§22) — append-only --------------------------------
create table if not exists public.call_events (
  id             bigserial primary key,
  call_id        uuid        not null references public.calls(id) on delete cascade,
  application_id uuid        references public.call_applications(id),
  event          text        not null check (btrim(event) <> ''),
  actor_user_id  uuid,
  detail         jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
alter table public.call_events enable row level security;
create index if not exists call_events_call_idx on public.call_events (call_id, id desc);

-- Immutability of what must never change after the fact (new tables only).
create or replace function public.call_forbid_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: rows are never updated or deleted.', tg_table_name
    using errcode = 'check_violation';
end $$;

drop trigger if exists trg_call_submissions_immutable on public.call_application_submissions;
create trigger trg_call_submissions_immutable
  before update or delete on public.call_application_submissions
  for each row execute function public.call_forbid_change();

drop trigger if exists trg_call_snapshots_immutable on public.call_config_snapshots;
create trigger trg_call_snapshots_immutable
  before update on public.call_config_snapshots
  for each row execute function public.call_forbid_change();

drop trigger if exists trg_call_events_immutable on public.call_events;
create trigger trg_call_events_immutable
  before update on public.call_events
  for each row execute function public.call_forbid_change();

-- 7. Grants and policies: read-only for authenticated, through membership ------------------------------
revoke all on public.calls, public.call_phases, public.call_form_fields, public.call_config_snapshots,
  public.call_applications, public.call_application_submissions, public.call_events
  from public, anon, authenticated;
grant select on public.calls, public.call_phases, public.call_form_fields, public.call_config_snapshots,
  public.call_applications, public.call_application_submissions, public.call_events to authenticated;

create policy calls_member_read on public.calls for select using (public.calls_is_member(id));
create policy call_phases_member_read on public.call_phases for select using (public.calls_is_member(call_id));
create policy call_form_fields_member_read on public.call_form_fields for select using (public.calls_is_member(call_id));
create policy call_config_snapshots_manager_read on public.call_config_snapshots for select using (public.calls_can_manage(call_id));
create policy call_events_manager_read on public.call_events for select using (public.calls_can_manage(call_id));
-- An applicant sees only their own application; a manager of the promoter sees the call's applications.
create policy call_applications_read on public.call_applications for select
  using (applicant_user_id = auth.uid() or public.calls_can_manage(call_id));
create policy call_submissions_read on public.call_application_submissions for select
  using (exists (select 1 from public.call_applications a
                  where a.id = application_id and (a.applicant_user_id = auth.uid() or public.calls_can_manage(a.call_id))));

revoke execute on function public.calls_is_member(uuid, uuid) from public, anon;
revoke execute on function public.calls_can_manage(uuid, uuid) from public, anon;
revoke execute on function public.call_forbid_change() from public, anon, authenticated;
grant execute on function public.calls_is_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.calls_can_manage(uuid, uuid) to authenticated, service_role;
