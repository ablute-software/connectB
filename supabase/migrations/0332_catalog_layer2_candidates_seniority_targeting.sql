-- Prompt 583 §C.2/§C.3 — the layer2-candidates RPCs (migration 0329) list
-- every to_research person regardless of seniority: an Office Manager and
-- a Founding Partner cost the same €0.30+ hook-research call and were
-- offered in the same list, ordered only by firm demand. This revises both
-- functions to only ever offer people worth the cost.
--
-- §C.2's own cascade, re-based on Nuno's recommendation (§C.2 decision:
-- "≤2 até a qualidade dos hooks estar provada", followed and disclosed,
-- same pattern as every other Nuno recommendation this session has
-- followed on request) — a firm's roster is looked at as a whole, not
-- filtered by hook_status first, so a firm whose only rank-1/2 person
-- already has a hook doesn't wrongly "fall back" to researching its
-- Analyst: the cascade checks the BEST rank anywhere on the firm's roster,
-- any hook_status.
--   - rank <= 2: always eligible.
--   - rank 3: eligible only if the firm has nobody ranked <= 2 anywhere.
--   - rank 4: eligible only if the firm has nobody ranked <= 3 anywhere.
--   - rank 9 or unmapped (null): never eligible.
--
-- §C.3 — firm ordering: pipeline demand from real (non-internal, non-test)
-- orgs first, then outreach_readiness, then name — "Priority: already
-- delivered…" in the panel is this same signal, now correctly excluding
-- internal/test orgs from what counts as "demand" (an internal QA org's
-- own pipeline entry was inflating a firm's apparent demand before this).
-- Within a firm: seniority_rank ascending (§C.2's own "Ordem dentro da
-- firma: rank, depois is_primary").
create or replace function public.catalog_layer2_candidate_counts()
returns table (to_research bigint, researched bigint, none_found bigint, to_research_with_demand bigint)
language sql
stable
set search_path = public
as $$
  with roster_min_rank as (
    select cpa.entity_id, min(cpa.seniority_rank) filter (where cpa.seniority_rank is not null and cpa.seniority_rank <> 9) as min_rank
    from catalog_person_affiliations cpa
    group by cpa.entity_id
  ),
  demand as (
    select cd.catalog_id, count(distinct cd.org_id) as n
    from catalog_deliveries cd
    join orgs o on o.id = cd.org_id
    where o.is_internal = false and o.is_test = false
    group by cd.catalog_id
  ),
  eligible as (
    select cp.hook_status, cp.entity_id, coalesce(d.n, 0) as demand_n
    from catalog_people cp
    join catalog_entities ce on ce.id = cp.entity_id
    join catalog_person_affiliations cpa on cpa.person_id = cp.id and cpa.is_primary = true
    left join roster_min_rank rmr on rmr.entity_id = cp.entity_id
    left join demand d on d.catalog_id = cp.entity_id
    where ce.is_test = false and ce.enrichment_status = 'enriched'
      and cpa.seniority_rank is not null and cpa.seniority_rank <> 9
      and cpa.seniority_rank <= (case
          when coalesce(rmr.min_rank, 999) <= 2 then 2
          when rmr.min_rank = 3 then 3
          else 4
        end)
  )
  select
    count(*) filter (where hook_status = 'to_research'),
    count(*) filter (where hook_status = 'researched'),
    count(*) filter (where hook_status = 'none_found'),
    count(*) filter (where hook_status = 'to_research' and demand_n > 0)
  from eligible;
$$;

-- Return shape gained a column (seniority_rank) — Postgres can't CREATE OR
-- REPLACE across a changed OUT-parameter row type, so the old signature is
-- dropped first.
drop function if exists public.catalog_layer2_candidates_page(text, int, int);

create function public.catalog_layer2_candidates_page(p_status text, p_limit int, p_offset int)
returns table (id uuid, full_name text, entity_name text, demand bigint, low_chance boolean, seniority_rank int)
language sql
stable
set search_path = public
as $$
  with roster_min_rank as (
    select cpa.entity_id, min(cpa.seniority_rank) filter (where cpa.seniority_rank is not null and cpa.seniority_rank <> 9) as min_rank
    from catalog_person_affiliations cpa
    group by cpa.entity_id
  ),
  demand as (
    select cd.catalog_id, count(distinct cd.org_id) as n
    from catalog_deliveries cd
    join orgs o on o.id = cd.org_id
    where o.is_internal = false and o.is_test = false
    group by cd.catalog_id
  ),
  eligible as (
    select cp.id, cp.full_name, cp.linkedin_url, cp.entity_id, ce.name as entity_name, ce.website,
      ce.outreach_readiness, cpa.seniority_rank, coalesce(d.n, 0) as demand_n
    from catalog_people cp
    join catalog_entities ce on ce.id = cp.entity_id
    join catalog_person_affiliations cpa on cpa.person_id = cp.id and cpa.is_primary = true
    left join roster_min_rank rmr on rmr.entity_id = cp.entity_id
    left join demand d on d.catalog_id = cp.entity_id
    where ce.is_test = false and ce.enrichment_status = 'enriched' and cp.hook_status::text = p_status
      and cpa.seniority_rank is not null and cpa.seniority_rank <> 9
      and cpa.seniority_rank <= (case
          when coalesce(rmr.min_rank, 999) <= 2 then 2
          when rmr.min_rank = 3 then 3
          else 4
        end)
  )
  select e.id, e.full_name, e.entity_name, e.demand_n, (e.linkedin_url is null and e.website is null) as low_chance, e.seniority_rank
  from eligible e
  order by e.demand_n desc, e.outreach_readiness desc, e.entity_name asc, e.seniority_rank asc, e.full_name asc
  limit p_limit offset p_offset;
$$;

revoke execute on function public.catalog_layer2_candidate_counts() from public, anon, authenticated;
revoke execute on function public.catalog_layer2_candidates_page(text, int, int) from public, anon, authenticated;
