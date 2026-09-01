-- Prompt 524 — RECONSTRUCTED, not newly authored. This migration was applied
-- to production on 2026-09-01 as supabase_migrations version 20260901001551
-- (`founder_person_contributions`), but its file never reached any branch:
-- the session that ran it was lost before committing. Same failure mode as
-- Prompt 507, and the third time it has happened on this project.
--
-- Everything below the header is byte-for-byte what production actually ran.
-- Recovered by reading supabase_migrations.schema_migrations.statements, NOT
-- rewritten from memory, and proved verbatim rather than asserted: the body
-- is 5706 bytes with md5 939ca83f81ec1fe0eea7eed819c25121, identical to the
-- stored statement. Re-check with:
--   select length(statements[1]), md5(statements[1])
--     from supabase_migrations.schema_migrations where version='20260901001551';
--
-- WHY 0289 AND NOT THE ORIGINAL TIMESTAMP. Supabase applies local files in
-- lexicographic filename order. "0289_..." < "20260901..." as strings, so a
-- file keeping the raw timestamp would sort AFTER every sequentially-numbered
-- migration — including ones that depend on what this creates — and a fresh
-- `db reset` would break while production, where the objects already exist,
-- looked perfectly fine.
--
-- ORDERING DEBT, DO NOT GET THIS BACKWARDS. Branch
-- claude/prompt-512-contribute-people carries its own
-- supabase/migrations/0289_contribute_catalog_person.sql, which only USES
-- what this file CREATES (inserts into contribution_points, calls
-- contribution_points_balance()). At merge time that file must be renumbered
-- to 0291 so it replays AFTER this one. Reversing the two breaks only a fresh
-- replay, never production — so it would pass every check anyone is likely to
-- run and fail much later.
--
-- NOTE ON contribute_catalog_person: the function defined below takes
-- (…, p_points int, p_validated_fields jsonb, p_detected_language, p_original_title).
-- The 512 branch defines a DIFFERENT overload of the same name
-- (…, p_kind affiliation_kind, p_linkedin_url, p_award_name, p_award_title).
-- Merging 512 therefore leaves two live overloads. Dropping the orphan is a
-- decision already recorded separately (Prompt 522) and is deliberately NOT
-- done here.

alter table public.catalog_entity_enrichment_sources
  add column if not exists contributed_by_org_id uuid references public.orgs(id) on delete set null,
  add column if not exists contributed_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists catalog_entity_enrichment_sources_contrib_org_idx
  on public.catalog_entity_enrichment_sources (contributed_by_org_id)
  where contributed_by_org_id is not null;

create table if not exists public.contribution_points (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  awarded_to_user_id uuid references auth.users(id) on delete set null,
  points int not null check (points > 0),
  reason text not null,
  catalog_entity_id uuid references public.catalog_entities(id) on delete set null,
  catalog_person_id uuid references public.catalog_people(id) on delete set null,
  source_url text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists contribution_points_org_idx on public.contribution_points (org_id);
create index if not exists contribution_points_created_idx on public.contribution_points (created_at desc);

alter table public.contribution_points enable row level security;

drop policy if exists contribution_points_read on public.contribution_points;
create policy contribution_points_read on public.contribution_points for select
  using (is_platform_admin() or is_org_member(org_id));

create or replace function public.contribute_catalog_person(
  p_org_id uuid,
  p_user_id uuid,
  p_catalog_entity_id uuid,
  p_full_name text,
  p_source_url text,
  p_title text default null,
  p_points int default 0,
  p_validated_fields jsonb default '[]'::jsonb,
  p_detected_language text default null,
  p_original_title text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_person_id uuid;
  v_name text := btrim(p_full_name);
  v_batch text := 'founder_contribution:' || gen_random_uuid()::text;
  v_notes text;
begin
  if v_name is null or v_name = '' then
    raise exception 'contribute_catalog_person: full_name is required';
  end if;
  if p_source_url is null or btrim(p_source_url) = '' then
    raise exception 'contribute_catalog_person: source_url is required';
  end if;

  if not exists (
    select 1 from public.catalog_deliveries cd
     where cd.catalog_id = p_catalog_entity_id and cd.org_id = p_org_id
  ) then
    raise exception 'contribute_catalog_person: org % does not have catalog entity % in its pipeline',
      p_org_id, p_catalog_entity_id
      using errcode = 'insufficient_privilege';
  end if;

  select cp.id into v_person_id
    from public.catalog_people cp
    join public.catalog_person_affiliations cpa on cpa.person_id = cp.id
   where cpa.entity_id = p_catalog_entity_id
     and lower(btrim(cp.full_name)) = lower(v_name)
   order by cp.created_at
   limit 1;

  if v_person_id is null then
    insert into public.catalog_people (full_name, entity_id, hook_status, enrichment_status)
      values (v_name, p_catalog_entity_id, 'to_research', 'pending')
      returning id into v_person_id;
  end if;

  insert into public.catalog_person_affiliations (person_id, entity_id, title, kind, current)
    values (v_person_id, p_catalog_entity_id, p_title, 'other', true)
  on conflict (person_id, entity_id, kind) do update
    set title = coalesce(excluded.title, public.catalog_person_affiliations.title),
        current = true;

  v_notes := 'Founder contribution, AI-validated (Prompt 507). Validated fields: '
    || coalesce(p_validated_fields::text, '[]')
    || case when p_detected_language is not null then '. Source language: ' || p_detected_language else '' end
    || case when p_original_title is not null then '. Original title: ' || p_original_title else '' end;

  insert into public.catalog_entity_enrichment_sources (
    entity_id, person_id, source_url, source_type, verified_at, supports, quality, notes,
    batch_id, contributed_by_org_id, contributed_by_user_id
  ) values (
    p_catalog_entity_id, v_person_id, btrim(p_source_url), 'founder_contribution', current_date,
    'person_affiliation', 'ai_validated', v_notes,
    v_batch, p_org_id, p_user_id
  );

  if p_points > 0 then
    insert into public.contribution_points (
      org_id, awarded_to_user_id, points, reason, catalog_entity_id, catalog_person_id, source_url, detail
    ) values (
      p_org_id, p_user_id, p_points, 'catalog_person_contribution',
      p_catalog_entity_id, v_person_id, btrim(p_source_url),
      jsonb_build_object('validated_fields', p_validated_fields, 'detected_language', p_detected_language)
    );
  end if;

  return jsonb_build_object(
    'person_id', v_person_id,
    'points_awarded', p_points,
    'balance', (select coalesce(sum(points), 0) from public.contribution_points where org_id = p_org_id)
  );
end;
$function$;

revoke all on function public.contribute_catalog_person(uuid, uuid, uuid, text, text, text, int, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.contribute_catalog_person(uuid, uuid, uuid, text, text, text, int, jsonb, text, text)
  to service_role;

create or replace function public.contribution_points_balance(p_org_id uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $function$
  select coalesce(sum(points), 0)::int from public.contribution_points where org_id = p_org_id;
$function$;

revoke all on function public.contribution_points_balance(uuid) from public, anon;
grant execute on function public.contribution_points_balance(uuid) to authenticated, service_role;
