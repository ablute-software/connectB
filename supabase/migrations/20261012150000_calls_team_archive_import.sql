-- Prompt 909 — Calls: delete / archive a call, the team (categories, members, conflicts) and AI import from
-- documents. ONE additive migration for all four increments (docs/calls/SPEC_CALLS_V2.md §5.3, §9, §2.3).
-- APPLIED to production on 12/10/2026 (pre-authorised, additive), after a dry run inside a transaction that always
-- rolls back: 7 checks passed (delete + record survives, an application blocks, open/unknown refused, the record is
-- immutable, category names and permissions shape, a category in use is protected, cascade cleanup works).
--
-- Strictly ADDITIVE: new columns on `calls` (nullable), new tables, new functions. Nothing existing is changed.
--
-- What each part is for:
--   1. calls.archived_at / archived_by      — "Archive call": the status 'archived' already exists; who and when are new.
--   2. call_deletions + delete_call_if_empty — "Delete call". call_events (and phases, fields, snapshots) disappear in
--      cascade with the call, so the record of WHO deleted WHAT and WHEN has to live in a table that survives it.
--      Done in one function, in one transaction, under a row lock on the call: the refusal rules (no applications of
--      any kind; only draft/confirmed/scheduled) and the deletion cannot be separated by a concurrent application.
--   3. call_team_categories / call_team_members / call_declared_conflicts — §9: categories belong to the ORGANISATION
--      (polymorphic like calls: an investor firm xor an incubator) and are reused in every call; a call's team is a
--      list of (person, category, per-person overrides); conflicts of interest can be declared up front.
--   4. call_source_documents / call_import_runs — §5.3: the promoter's own regulation / form / grid uploaded to propose
--      a configuration; what the engine proposed, what it cost, and who imported. Never applicants' documents (§2.3).
--
-- Same trust boundary as the Stage 1 tables: RLS on, read-only policies for authenticated through membership; every
-- write goes through our routes with the service role.

-- 1. Archive ------------------------------------------------------------------------------------------------------
alter table public.calls add column if not exists archived_at timestamptz;
alter table public.calls add column if not exists archived_by uuid;

-- 2. Delete, with a record that survives -------------------------------------------------------------------------
create table if not exists public.call_deletions (
  id                uuid primary key default gen_random_uuid(),
  call_id           uuid        not null,                       -- NOT a foreign key: the call is gone
  call_name         text        not null,
  promoter_kind     text        not null check (promoter_kind in ('catalog_entity', 'incubator')),
  promoter_id       uuid        not null,
  promoter_name     text,
  status_at_deletion text       not null,
  deleted_by        uuid        not null,
  deleted_at        timestamptz not null default now()
);
alter table public.call_deletions enable row level security;
create index if not exists call_deletions_promoter_idx on public.call_deletions (promoter_id, deleted_at desc);

drop trigger if exists trg_call_deletions_immutable on public.call_deletions;
create trigger trg_call_deletions_immutable
  before update or delete on public.call_deletions
  for each row execute function public.call_forbid_change();

create or replace function public.delete_call_if_empty(p_call uuid, p_actor uuid, p_promoter_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.calls;
begin
  select * into c from public.calls where id = p_call for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Only before it opens: after that there may be applicants' data (and an open call must be closed and archived).
  if c.status not in ('draft', 'validated', 'scheduled') then
    return jsonb_build_object('ok', false, 'reason', 'status', 'status', c.status);
  end if;
  -- No application of any kind: not submitted, not in progress, not withdrawn.
  if exists (select 1 from public.call_applications a where a.call_id = p_call) then
    return jsonb_build_object('ok', false, 'reason', 'has_applications');
  end if;

  insert into public.call_deletions
    (call_id, call_name, promoter_kind, promoter_id, promoter_name, status_at_deletion, deleted_by)
  values
    (c.id, c.name, c.promoter_kind, coalesce(c.catalog_entity_id, c.incubator_id), p_promoter_name, c.status, p_actor);

  delete from public.calls where id = p_call;   -- phases, fields, snapshots, events, team, documents: in cascade
  return jsonb_build_object('ok', true, 'call_name', c.name);
end;
$$;
revoke all on function public.delete_call_if_empty(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_call_if_empty(uuid, uuid, text) to service_role;

-- 3. Team (§9) ------------------------------------------------------------------------------------------------------
create table if not exists public.call_team_categories (
  id                uuid primary key default gen_random_uuid(),
  promoter_kind     text        not null check (promoter_kind in ('catalog_entity', 'incubator')),
  catalog_entity_id uuid        references public.catalog_entities(id) on delete cascade,
  incubator_id      uuid        references public.incubators(id) on delete cascade,
  name              text        not null check (btrim(name) <> ''),
  -- {configure_call: true, manage_team: false, ...}: the permission keys are validated by the app
  -- (src/lib/calls/permissions.ts); a key that is missing means "off".
  permissions       jsonb       not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint call_team_categories_one_promoter check (
    (promoter_kind = 'catalog_entity' and catalog_entity_id is not null and incubator_id is null)
    or (promoter_kind = 'incubator' and incubator_id is not null and catalog_entity_id is null))
);
alter table public.call_team_categories enable row level security;
-- One name once per organisation, whatever the case.
create unique index if not exists call_team_categories_name_uq
  on public.call_team_categories ((coalesce(catalog_entity_id, incubator_id)), (lower(btrim(name))));

create table if not exists public.call_team_members (
  id                   uuid primary key default gen_random_uuid(),
  call_id              uuid        not null references public.calls(id) on delete cascade,
  user_id              uuid        not null,
  -- No ON DELETE action on purpose: deleting a category that still has people is refused (they must be reassigned
  -- first), yet deleting a whole call/organisation in cascade still works (checked at the end of the statement).
  category_id          uuid        not null references public.call_team_categories(id),
  -- Per-person adjustments over the category: {evaluate_assigned: false}. Hidden in the UI until opened.
  permission_overrides jsonb       not null default '{}'::jsonb check (jsonb_typeof(permission_overrides) = 'object'),
  added_by             uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (call_id, user_id)
);
alter table public.call_team_members enable row level security;
create index if not exists call_team_members_call_idx on public.call_team_members (call_id);
create index if not exists call_team_members_category_idx on public.call_team_members (category_id);

create table if not exists public.call_declared_conflicts (
  id            uuid primary key default gen_random_uuid(),
  call_id       uuid        not null references public.calls(id) on delete cascade,
  user_id       uuid        not null,                -- the team member the conflict is about
  company_name  text        not null check (btrim(company_name) <> ''),
  note          text,
  declared_by   uuid,
  created_at    timestamptz not null default now()
);
alter table public.call_declared_conflicts enable row level security;
create index if not exists call_declared_conflicts_call_idx on public.call_declared_conflicts (call_id);

-- 4. Documents of the promoter and AI import (§5.3, §2.3) -----------------------------------------------------------
create table if not exists public.call_source_documents (
  id            uuid primary key default gen_random_uuid(),
  call_id       uuid        not null references public.calls(id) on delete cascade,
  kind          text        not null default 'other' check (kind in ('regulation', 'form', 'grid', 'other')),
  file_name     text        not null check (btrim(file_name) <> ''),
  mime_type     text        not null,
  size_bytes    bigint      not null check (size_bytes >= 0),
  pages         integer,
  storage_path  text        not null,
  uploaded_by   uuid        not null,
  created_at    timestamptz not null default now()
);
alter table public.call_source_documents enable row level security;
create index if not exists call_source_documents_call_idx on public.call_source_documents (call_id);

create table if not exists public.call_import_runs (
  id                  uuid primary key default gen_random_uuid(),
  call_id             uuid        not null references public.calls(id) on delete cascade,
  source_document_ids uuid[]      not null default '{}',
  status              text        not null default 'proposed' check (status in ('proposed', 'applied', 'discarded')),
  -- What the engine proposed (general, phases, form, what is out of date, what the pieces cannot express) and, in
  -- text only, what it found for later stages (eligibility rules, evaluation grid).
  proposal            jsonb       not null,
  found_later         jsonb       not null default '{}'::jsonb,
  model               text,
  tokens_in           integer,
  tokens_out          integer,
  cost_eur            numeric(10, 4),
  created_by          uuid        not null,
  created_at          timestamptz not null default now(),
  applied_at          timestamptz,
  applied_by          uuid
);
alter table public.call_import_runs enable row level security;
create index if not exists call_import_runs_call_idx on public.call_import_runs (call_id, created_at desc);

-- 5. Grants and policies: read-only for authenticated, through membership of the promoter -------------------------
revoke all on public.call_deletions, public.call_team_categories, public.call_team_members, public.call_declared_conflicts,
  public.call_source_documents, public.call_import_runs from public, anon, authenticated;
grant select on public.call_team_categories, public.call_team_members, public.call_declared_conflicts,
  public.call_source_documents, public.call_import_runs to authenticated;

create policy call_team_members_member_read on public.call_team_members for select using (public.calls_is_member(call_id));
create policy call_declared_conflicts_member_read on public.call_declared_conflicts for select using (public.calls_is_member(call_id));
create policy call_source_documents_member_read on public.call_source_documents for select using (public.calls_is_member(call_id));
create policy call_import_runs_member_read on public.call_import_runs for select using (public.calls_is_member(call_id));
create policy call_team_categories_member_read on public.call_team_categories for select using (
  (promoter_kind = 'catalog_entity' and exists (
     select 1 from public.matchdeal_investor_members m
      where m.catalog_entity_id = call_team_categories.catalog_entity_id and m.user_id = auth.uid() and m.status = 'active'))
  or (promoter_kind = 'incubator' and exists (
     select 1 from public.incubator_members i
      where i.incubator_id = call_team_categories.incubator_id and i.user_id = auth.uid() and i.status = 'active')));
