-- Prompt 871 §B — layer2-candidates/route.ts was built (Prompt 581 §B) to
-- fix the hook-research panel showing "(1000)" instead of the real 3,136,
-- and its own comment names the cause: PostgREST's silent row cap. But its
-- fix queried `catalog_people` with no .limit()/.range() either — the same
-- cap truncates it too, just now behind a plausible-looking number instead
-- of an obviously-wrong one. Confirmed live before writing this: 3,142
-- eligible rows today (hook_status in the 3 states, entity enriched and
-- not test) — well past the 1000 default.
--
-- Two RPCs so the page's own zero-row case (e.g. a page past the end)
-- never loses the counts: a single combined query with `count(*) over ()`
-- would return zero rows — and zero counts with it — the moment the
-- requested page is empty, which is exactly the failure mode this
-- migration exists to remove.
create or replace function public.catalog_layer2_candidate_counts()
returns table (to_research bigint, researched bigint, none_found bigint, to_research_with_demand bigint)
language sql
stable
set search_path = public
as $$
  with eligible as (
    select cp.hook_status, cp.entity_id
    from catalog_people cp
    join catalog_entities ce on ce.id = cp.entity_id
    where ce.is_test = false and ce.enrichment_status = 'enriched'
  ),
  demand as (
    select catalog_id, count(distinct org_id) as n from catalog_deliveries group by catalog_id
  )
  select
    count(*) filter (where e.hook_status = 'to_research'),
    count(*) filter (where e.hook_status = 'researched'),
    count(*) filter (where e.hook_status = 'none_found'),
    count(*) filter (where e.hook_status = 'to_research' and coalesce(d.n, 0) > 0)
  from eligible e
  left join demand d on d.catalog_id = e.entity_id;
$$;

-- The demand-sort needs a join to catalog_deliveries grouped by org — done
-- here in SQL, not in memory over an already-capped array, per the
-- prompt's own prescribed fix.
create or replace function public.catalog_layer2_candidates_page(p_status text, p_limit int, p_offset int)
returns table (id uuid, full_name text, entity_name text, demand bigint, low_chance boolean)
language sql
stable
set search_path = public
as $$
  with eligible as (
    select cp.id, cp.full_name, cp.linkedin_url, cp.entity_id, ce.name as entity_name, ce.website
    from catalog_people cp
    join catalog_entities ce on ce.id = cp.entity_id
    where ce.is_test = false and ce.enrichment_status = 'enriched' and cp.hook_status::text = p_status
  ),
  demand as (
    select catalog_id, count(distinct org_id) as n from catalog_deliveries group by catalog_id
  )
  select e.id, e.full_name, e.entity_name, coalesce(d.n, 0) as demand,
    (e.linkedin_url is null and e.website is null) as low_chance
  from eligible e
  left join demand d on d.catalog_id = e.entity_id
  order by coalesce(d.n, 0) desc, e.full_name asc
  limit p_limit offset p_offset;
$$;

-- Backoffice enrichment-campaign tooling only — same default-deny as every
-- other admin-only function in this codebase (0078/0108/0124/0133/0324).
revoke execute on function public.catalog_layer2_candidate_counts() from public, anon, authenticated;
revoke execute on function public.catalog_layer2_candidates_page(text, int, int) from public, anon, authenticated;
