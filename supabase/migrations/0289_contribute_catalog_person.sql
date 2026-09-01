-- Prompt 512 — the one privileged write path for a founder-contributed,
-- AI-validated person on an investor firm's team.
--
-- WHY A FUNCTION AND NOT JUST THE SERVICE-ROLE CLIENT. The route that calls
-- this already holds a service-role key, which bypasses RLS on its own — so
-- strictly, this function is not needed to make the write succeed. It exists
-- to make the write NARROW. A bare service-role insert can put any number of
-- points on any org for any reason; this function can only ever award 1 point
-- per validated field, only alongside a real catalog write, and only with the
-- source_url that justified it. The privilege is scoped to a shape, not
-- granted to a caller. Same spirit as the verification_insert_* functions in
-- migration 0183, and the same lockdown: revoked from public/anon/
-- authenticated, so the founder's own session still cannot reach it.
--
-- contribution_points keeps its zero write policies (migration
-- 20260901001551). That is deliberate and stays true after this migration:
-- INSERT/UPDATE/DELETE remain blocked for anon/authenticated, and the only
-- way a row is ever created is through this SECURITY DEFINER body.
--
-- WHY NO HUMAN REVIEW STEP. Every other founder-proposed write in this
-- codebase (contributions / ContributionBox) requires an explicit Accept
-- click even for AI-generated rows. This one deliberately does not — it is
-- Nuno's instruction verbatim: "se validado pela AI estes contacto não
-- precisam de mais qualquer validação humana, passam a constar nos dossier
-- do investidor, disponível para todos." Recorded here as the conscious
-- departure from the established norm that it is, not an oversight. The
-- compensating controls are that the AI must cite the founder-supplied
-- source_url, an unvalidated field never reaches the catalog at all, and
-- the source row records which org and user contributed it.
--
-- PII NOTE: migration 0147 removed public read from catalog_people after a
-- real leak. Nothing here re-opens it — this only adds a write path.

create or replace function public.contribute_catalog_person(
  p_org_id uuid,
  p_user_id uuid,
  p_catalog_entity_id uuid,
  p_full_name text,
  p_source_url text,
  p_title text default null,
  p_kind affiliation_kind default 'other',
  p_linkedin_url text default null,
  p_award_name boolean default false,
  p_award_title boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_person_id uuid;
  v_points integer := 0;
  v_balance integer;
begin
  -- Callable only server-side. A signed-in user reaching this directly
  -- would be a privilege escalation, so refuse before touching anything.
  if auth.role() = 'authenticated' and not public.is_platform_admin() then
    raise exception 'NOT_AUTHORISED';
  end if;

  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'contribute_catalog_person: full_name is required';
  end if;

  -- The evidence link is the whole point of the contribution: no source,
  -- no write, no points. Mirrors catalog_entity_enrichment_sources.source_url
  -- being NOT NULL, enforced here too so the failure is a clear message
  -- rather than a constraint violation three statements later.
  if p_source_url is null or p_source_url !~* '^https://' then
    raise exception 'contribute_catalog_person: an https source_url is required';
  end if;

  if not exists (select 1 from public.catalog_entities where id = p_catalog_entity_id) then
    raise exception 'contribute_catalog_person: catalog entity % not found', p_catalog_entity_id;
  end if;

  -- Idempotent on the person: match an existing row for this firm by
  -- normalised LinkedIn URL first (the strongest identifier this table
  -- has), then by case-insensitive name within the SAME firm. Never
  -- globally by name — two different people at two different firms
  -- routinely share a name, and merging them would corrupt both dossiers.
  select id into v_person_id
  from public.catalog_people
  where entity_id = p_catalog_entity_id
    and (
      (p_linkedin_url is not null and linkedin_url_normalized is not null
        and linkedin_url_normalized = lower(btrim(p_linkedin_url)))
      or lower(btrim(full_name)) = lower(btrim(p_full_name))
    )
  order by (linkedin_url_normalized is not null) desc
  limit 1;

  if v_person_id is null then
    insert into public.catalog_people (full_name, entity_id, linkedin_url, enrichment_status)
    values (btrim(p_full_name), p_catalog_entity_id, p_linkedin_url, 'pending')
    returning id into v_person_id;
  elsif p_linkedin_url is not null then
    update public.catalog_people
      set linkedin_url = coalesce(linkedin_url, p_linkedin_url), updated_at = now()
      where id = v_person_id;
  end if;

  -- Only when the AI actually validated the title. An unvalidated title is
  -- feedback to the founder, never a row in the shared catalog.
  if p_award_title and p_title is not null and btrim(p_title) <> '' then
    insert into public.catalog_person_affiliations (person_id, entity_id, title, kind, current)
    values (v_person_id, p_catalog_entity_id, btrim(p_title), p_kind, true)
    on conflict (person_id, entity_id, kind)
      do update set title = excluded.title, current = true;
  end if;

  insert into public.catalog_entity_enrichment_sources (
    entity_id, person_id, source_url, source_type, supports, quality, verified_at,
    contributed_by_org_id, contributed_by_user_id
  ) values (
    p_catalog_entity_id, v_person_id, p_source_url, 'founder_contribution',
    'person_role', 'ai_validated', current_date, p_org_id, p_user_id
  );

  -- One point per validated FIELD, never one per submission — the prompt is
  -- explicit about that, and the CHECK (points > 0) on the table means a
  -- zero-point row is impossible by construction rather than by convention.
  if p_award_name then
    insert into public.contribution_points (
      org_id, awarded_to_user_id, points, reason, catalog_entity_id, catalog_person_id, source_url, detail
    ) values (
      p_org_id, p_user_id, 1, 'person_name_validated', p_catalog_entity_id, v_person_id, p_source_url,
      jsonb_build_object('field', 'full_name', 'value', btrim(p_full_name))
    );
    v_points := v_points + 1;
  end if;

  if p_award_title then
    insert into public.contribution_points (
      org_id, awarded_to_user_id, points, reason, catalog_entity_id, catalog_person_id, source_url, detail
    ) values (
      p_org_id, p_user_id, 1, 'person_title_validated', p_catalog_entity_id, v_person_id, p_source_url,
      jsonb_build_object('field', 'title', 'value', btrim(coalesce(p_title, '')))
    );
    v_points := v_points + 1;
  end if;

  select public.contribution_points_balance(p_org_id) into v_balance;

  return jsonb_build_object(
    'person_id', v_person_id,
    'points_awarded', v_points,
    'balance', coalesce(v_balance, 0)
  );
end;
$function$;

revoke all on function public.contribute_catalog_person(
  uuid, uuid, uuid, text, text, text, affiliation_kind, text, boolean, boolean
) from public, anon, authenticated;
