-- Prompt 544 Part E — grow the supply in the order founders need it.
--
-- The catalog is thin exactly where the promise is: 355 verified active rows,
-- 67 with any affiliated person, 47 with a LinkedIn profile, THREE with a hook
-- written. The enrichment campaign has been picking its next target by
-- sector fit and delivery count, which is a reasonable platform-wide rule and
-- says nothing about whether a real founder is stuck on that row today.
--
-- This returns, per active founder org, the rows at the top of their match
-- list and how reachable each one is — so the back-office can show "who is
-- short of contactable investors" and the campaign can enrich SFC, Seedcamp,
-- Entrée and DOMiNO before anyone else. Nuno's "aos poucos no backoffice vamos
-- aumentando essa lista" becomes a queue with an order.
--
-- Platform-admin only. It spans every org by construction, which is exactly
-- what makes it a back-office tool and not something a founder may call.
create or replace function public.catalog_outreach_supply(p_top integer default 20)
returns table (
  org_id uuid,
  org_name text,
  catalog_id uuid,
  catalog_name text,
  fit integer,
  readiness integer,
  has_hook boolean,
  rank integer
)
language plpgsql
stable security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_platform_admin() and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  return query
  with active_orgs as (
    -- A founder org that someone actually uses: it has members and is not a
    -- test fixture. Ordering supply by an abandoned org's needs would starve
    -- the founders who are waiting.
    select o.id, o.name
      from public.orgs o
     where coalesce(o.is_test, false) = false
       and o.name not ilike 'zz-test-%'
       and exists (select 1 from public.org_members m where m.org_id = o.id)
  ), ranked as (
    select a.id as org_id, a.name as org_name, t.catalog_id, t.score, t.readiness,
           row_number() over (partition by a.id order by t.score desc, t.readiness desc) as rn
      from active_orgs a
      cross join lateral public.catalog_top_matches(a.id, greatest(coalesce(p_top, 20), 1)) t
  )
  select r.org_id, r.org_name, r.catalog_id, c.name, r.score, r.readiness,
         exists (
           select 1 from public.catalog_person_affiliations pa
             join public.catalog_people p on p.id = pa.person_id
             join public.catalog_people_research pr on pr.person_id = p.id
            where pa.entity_id = r.catalog_id and coalesce(pr.hook, '') <> ''
         ),
         r.rn::int
    from ranked r
    join public.catalog_entities c on c.id = r.catalog_id
   order by r.org_name, r.rn;
end;
$function$;

revoke all on function public.catalog_outreach_supply(integer) from public, anon, authenticated;
grant execute on function public.catalog_outreach_supply(integer) to service_role;
