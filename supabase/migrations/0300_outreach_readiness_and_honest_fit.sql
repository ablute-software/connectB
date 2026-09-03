-- Prompt 544 Parts A + B — the first pipeline a founder receives must be
-- contactable, and "High" must mean something.
--
-- WHAT WAS MEASURED, before writing this (production, 02-03/09/2026):
--   * Ten investors delivered to Sherlock Deal: all fit 'high', all wave 1,
--     three of them with nobody to write to.
--   * catalog_match_score rewarded ignorance and penalised home: unknown
--     sectors +35 (the SAME as a real match), unknown stage +25, unknown
--     ticket +20, same country as the startup +2 while GB/DE/FR/NL/CH/SE got
--     +10. An enriched London generalist with no ticket data scored
--     35+25+20+10+10 = 100 against any profile at all.
--   * 355 verified, active catalog entities: 67 with any affiliated person,
--     47 with a LinkedIn profile, 3 with a hook written, 324 with a general
--     email, 44 with a submission form.
--
-- So fit alone cannot decide delivery: the catalog is thin exactly where the
-- promise is. This adds a SECOND score for whether anyone can be reached at
-- all, and makes the first one honest.

-- ---------------------------------------------------------------------------
-- A. Readiness — can this firm be approached today?
-- ---------------------------------------------------------------------------

alter table public.catalog_entities
  add column if not exists outreach_readiness int not null default 0;

comment on column public.catalog_entities.outreach_readiness is
  'Prompt 544 — 0-100, how contactable this firm is (hook > people > channel). '
  'Materialised and kept current by trigger; never edited by hand.';

create or replace function public.catalog_outreach_readiness(p_catalog_id uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $function$
  with people as (
    select count(*) filter (where p.linkedin_url is not null) as linkedin_count,
           count(*) filter (where coalesce(r.hook, '') <> '') as hook_count
      from public.catalog_person_affiliations pa
      join public.catalog_people p on p.id = pa.person_id
      left join public.catalog_people_research r on r.person_id = p.id
     where pa.entity_id = p_catalog_id
  ), firm as (
    select submission_channel, email, key_people, enrichment_status
      from public.catalog_entities where id = p_catalog_id
  )
  select least(100,
      -- A named person WITH a researched hook is the only thing that lets
      -- preflight() pass, so it is worth more than everything else combined.
      (case when (select hook_count from people) > 0 then 40 else 0 end)
      -- People you can actually identify. Three is the point where a founder
      -- can choose the right partner rather than take the only one listed.
    + (case when (select linkedin_count from people) >= 3 then 30
            when (select linkedin_count from people) >= 1 then 25 else 0 end)
    + (case when (select submission_channel from firm) is not null then 15 else 0 end)
    + (case when (select email from firm) is not null then 10 else 0 end)
    + (case when coalesce((select key_people from firm), '') <> '' then 5 else 0 end)
      -- Moved here from catalog_match_score, where it was inflating FIT.
      -- Being enriched says the data is good, not that the firm is a match.
    + (case when (select enrichment_status from firm) = 'enriched' then 5 else 0 end)
  )::int;
$function$;

revoke all on function public.catalog_outreach_readiness(uuid) from public, anon;
grant execute on function public.catalog_outreach_readiness(uuid) to authenticated, service_role;

-- Kept current by trigger, not by a job: the enrichment pipeline writes these
-- tables constantly and the ranking has to see the result immediately. A
-- nightly recompute would rank today's deliveries on yesterday's supply.
create or replace function public.catalog_readiness_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ids uuid[];
begin
  v_ids := case tg_table_name
    when 'catalog_entities' then array[coalesce(new.id, old.id)]
    when 'catalog_person_affiliations' then array[coalesce(new.entity_id, old.entity_id)]
    when 'catalog_people' then array[coalesce(new.entity_id, old.entity_id)]
    -- research has no entity of its own; reach it through the affiliation.
    when 'catalog_people_research' then (
      select coalesce(array_agg(distinct pa.entity_id), '{}')
        from public.catalog_person_affiliations pa
       where pa.person_id = coalesce(new.person_id, old.person_id)
    )
    else '{}'
  end;

  update public.catalog_entities c
     set outreach_readiness = public.catalog_outreach_readiness(c.id)
   where c.id = any(v_ids)
     and c.outreach_readiness is distinct from public.catalog_outreach_readiness(c.id);

  return null;
end;
$function$;

-- AFTER, statement-agnostic, and never on the readiness column itself: the
-- UPDATE above would otherwise re-fire this trigger on catalog_entities
-- forever. `of` restricts it to the columns readiness actually reads.
drop trigger if exists catalog_readiness_on_entity on public.catalog_entities;
create trigger catalog_readiness_on_entity
  after insert or update of submission_channel, email, key_people, enrichment_status
  on public.catalog_entities
  for each row execute function public.catalog_readiness_refresh();

drop trigger if exists catalog_readiness_on_affiliation on public.catalog_person_affiliations;
create trigger catalog_readiness_on_affiliation
  after insert or update or delete on public.catalog_person_affiliations
  for each row execute function public.catalog_readiness_refresh();

drop trigger if exists catalog_readiness_on_person on public.catalog_people;
create trigger catalog_readiness_on_person
  after insert or update of linkedin_url, entity_id on public.catalog_people
  for each row execute function public.catalog_readiness_refresh();

drop trigger if exists catalog_readiness_on_research on public.catalog_people_research;
create trigger catalog_readiness_on_research
  after insert or update of hook or delete on public.catalog_people_research
  for each row execute function public.catalog_readiness_refresh();

update public.catalog_entities c set outreach_readiness = public.catalog_outreach_readiness(c.id);

create index if not exists catalog_entities_readiness_idx
  on public.catalog_entities (outreach_readiness desc)
  where verification_status = 'verified';

-- ---------------------------------------------------------------------------
-- B. Fit — honest numbers
-- ---------------------------------------------------------------------------
--
-- Unknown data no longer scores like a match; it scores like a guess. And
-- being in the founder's own country is now worth MORE than being in a hub,
-- not five times less: a Portuguese pre-seed startup was being steered away
-- from Portuguese investors by construction.
--
-- 'high' stays >= 75, which is now unreachable without a real sector overlap:
-- the maximum without one is 15+25+20+10 = 70.
create or replace function public.catalog_match_score(p_org_id uuid, p_catalog_id uuid)
returns integer
language plpgsql
stable security definer
set search_path = public
as $function$
declare
  v_org record; v_cat record; v_score int := 0;
  v_rank_org int; v_rank_min int; v_rank_max int; v_lo int; v_hi int; v_dist int;
  v_ticket numeric; v_org_country_code text;
begin
  if auth.role() is distinct from 'service_role' and not (is_org_member(p_org_id) or is_platform_admin()) then
    raise exception 'not authorized';
  end if;

  select sectors, stage, round_min_ticket_eur, round_target_eur, country
    into v_org from public.orgs where id = p_org_id;
  if not found then return null; end if;

  select sectors_normalized, stage_min, stage_max, check_min_eur, check_max_eur,
         hq_country, enrichment_status, verification_status
    into v_cat from public.catalog_entities where id = p_catalog_id;
  if not found or v_cat.verification_status <> 'verified' then return null; end if;

  -- Unknown sectors: 15, not 35. A firm nobody has classified is a guess,
  -- not a match, and it must not tie with a real overlap.
  if coalesce(array_length(v_cat.sectors_normalized, 1), 0) = 0 then
    v_score := v_score + 15;
  elsif v_cat.sectors_normalized && v_org.sectors then
    v_score := v_score + 35;
  end if;

  v_rank_org := case v_org.stage
    when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6 else null end;
  v_rank_min := case v_cat.stage_min
    when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6 else null end;
  v_rank_max := case v_cat.stage_max
    when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6 else null end;

  -- Unknown stage: 12, not 25.
  if v_cat.stage_min is null and v_cat.stage_max is null then
    v_score := v_score + 12;
  elsif v_org.stage = 'other' or v_cat.stage_min = 'other' or v_cat.stage_max = 'other' then
    v_score := v_score + 12;
  elsif v_rank_org is null then
    v_score := v_score + 12;
  else
    v_lo := coalesce(v_rank_min, 1);
    v_hi := coalesce(v_rank_max, 6);
    if v_rank_org between v_lo and v_hi then
      v_score := v_score + 25;
    else
      v_dist := least(abs(v_rank_org - v_lo), abs(v_rank_org - v_hi));
      if v_dist = 1 then v_score := v_score + 10; end if;
    end if;
  end if;

  -- Unknown ticket: 10, not 20.
  v_ticket := coalesce(v_org.round_min_ticket_eur, v_org.round_target_eur);
  if v_ticket is null or v_cat.check_min_eur is null or v_cat.check_max_eur is null then
    v_score := v_score + 10;
  elsif v_ticket between v_cat.check_min_eur and v_cat.check_max_eur then
    v_score := v_score + 20;
  elsif (v_ticket < v_cat.check_min_eur and v_ticket * 2 >= v_cat.check_min_eur)
     or (v_ticket > v_cat.check_max_eur and v_ticket <= v_cat.check_max_eur * 2) then
    v_score := v_score + 10;
  end if;

  v_org_country_code := case lower(btrim(coalesce(v_org.country, '')))
    when 'portugal' then 'PT' when 'spain' then 'ES' when 'united kingdom' then 'GB'
    when 'uk' then 'GB' when 'germany' then 'DE' when 'france' then 'FR'
    when 'netherlands' then 'NL' when 'switzerland' then 'CH' when 'sweden' then 'SE'
    when 'denmark' then 'DK' when 'finland' then 'FI' when 'norway' then 'NO'
    when 'ireland' then 'IE' when 'belgium' then 'BE' when 'italy' then 'IT'
    when 'austria' then 'AT' when 'luxembourg' then 'LU' when 'poland' then 'PL'
    when 'greece' then 'GR' when 'czech republic' then 'CZ' when 'czechia' then 'CZ'
    when 'hungary' then 'HU' when 'romania' then 'RO' when 'bulgaria' then 'BG'
    when 'croatia' then 'HR' when 'slovenia' then 'SI' when 'slovakia' then 'SK'
    when 'estonia' then 'EE' when 'latvia' then 'LV' when 'lithuania' then 'LT'
    when 'iceland' then 'IS' when 'malta' then 'MT' when 'cyprus' then 'CY'
    else null end;

  -- Home is worth the most now. An investor down the road is easier to reach,
  -- easier to meet, and more likely to know someone the founder knows.
  if v_cat.hq_country is not null and v_cat.hq_country = v_org_country_code then
    v_score := v_score + 10;
  elsif v_cat.hq_country in ('GB','DE','FR','NL','CH','SE') then
    v_score := v_score + 6;
  elsif v_cat.hq_country in ('DK','FI','NO','IE','BE','AT','IT','ES','PL','LU','GR','CZ','HU','RO','BG','HR','SI','SK','EE','LV','LT','IS','MT','CY') then
    v_score := v_score + 4;
  else
    v_score := v_score + 2;
  end if;

  -- The enrichment term is GONE. It is a data-quality signal, and it now
  -- lives in catalog_outreach_readiness where it belongs.
  return v_score;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The floor: never deliver a firm with nobody to contact
-- ---------------------------------------------------------------------------
--
-- Decided by measurement, not by the spec's literal wording. "Readiness 0"
-- selects nothing: key_people plus enrichment_status alone score 10, so no
-- verified catalog row ever reaches 0 and the floor would be dead letter.
-- What the three firms the founder could not act on actually shared was ZERO
-- AFFILIATED PEOPLE — Hoxton (readiness 20), Salica (10), Kindred (35). The
-- founder's own words were "não se sabe quem contactar": a general inbox is
-- not a person, and neither is a web form.
--
-- Ordering is fit first, then readiness — a contactable firm that does not
-- match is still the wrong firm.
-- DROP first, not CREATE OR REPLACE: the existing function returns
-- TABLE(catalog_id, score) and Postgres refuses to replace a function whose
-- return type changes. Dropping resets the ACL to the schema default, so the
-- revoke/grant below is not tidy-up — it is what keeps anon out.
drop function if exists public.catalog_top_matches(uuid, integer);
create function public.catalog_top_matches(p_org_id uuid, p_limit integer)
returns table (catalog_id uuid, score integer, readiness integer)
language sql
stable security definer
set search_path = public, pg_temp
as $function$
  select c.id, public.catalog_match_score(p_org_id, c.id), c.outreach_readiness
    from public.catalog_entities c
   where c.verification_status = 'verified'
     and coalesce(c.moderation_status, 'active') = 'active'
     and coalesce(c.is_test, false) = false
     and not exists (select 1 from public.catalog_deliveries d
                      where d.org_id = p_org_id and d.catalog_id = c.id)
     and exists (select 1 from public.catalog_person_affiliations pa where pa.entity_id = c.id)
     and public.catalog_match_score(p_org_id, c.id) >= 55
   order by public.catalog_match_score(p_org_id, c.id) desc, c.outreach_readiness desc, c.name
   limit greatest(coalesce(p_limit, 10), 0);
$function$;

revoke all on function public.catalog_top_matches(uuid, integer) from public, anon;
grant execute on function public.catalog_top_matches(uuid, integer) to authenticated, service_role;
