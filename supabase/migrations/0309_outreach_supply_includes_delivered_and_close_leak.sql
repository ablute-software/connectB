-- Prompt 560 — two unrelated fixes that happen to share a migration number.
--
-- §A — the supply queue could not see the founders who are stuck TODAY.
--
-- catalog_outreach_supply was built on catalog_top_matches, which excludes
-- rows that have already been delivered. That exclusion is right for
-- discovery ("who should this founder see next") and exactly wrong for the
-- question Part E asked ("who is short of contactable investors right now").
-- A row already sitting in a founder's pipeline with readiness below 40 —
-- delivered, visible, and unusable because there is nobody to write to — was
-- invisible to both consumers: the back-office card and the enrichment
-- campaign's own queue order. The campaign was therefore optimising for
-- candidates nobody has been shown yet while the shown ones stayed broken.
--
-- Measured on 04/09, excluding is_test on both sides: ablute_ 663 of 757
-- delivered rows below the floor, Estojo 8 of 13, "New company (please
-- rename in Settings)" 5 of 10, Krohnsty 2 of 9. The Estojo and "New
-- company" rows persist after Part F cleaned up Sherlock Deal and Krohnsty,
-- so this is not a leftover of test data.
--
-- The function now returns BOTH sets with a `delivered` flag, delivered-and-
-- stuck first, worst readiness first within that tier. Callers that want one
-- or the other filter on the flag; nothing has to re-derive "is this row
-- already in someone's pipeline" for itself.
--
-- §C — matchdeal_profile_org_is_closed was executable by anon.
--
-- It kept Postgres's default PUBLIC EXECUTE and was never revoked, unlike
-- close_org and orgs_close_when_last_member_removed in the same area.
--
-- Its real signature is (p_membership_id uuid, p_kind text) — not an org id,
-- as the report that raised this assumed. So the leak is narrower than
-- "is this arbitrary org closed": a caller must already hold a matchdeal
-- membership id. It is still one bit about another tenant, answered by a
-- SECURITY DEFINER function to an unauthenticated caller, with no reason to
-- be reachable at all. Its only caller is matchdeal_eligible_deck, which
-- runs as postgres, so nothing legitimate loses access.

-- Adding a column to the result changes the return type, which create or
-- replace cannot do — hence drop + create. That resets the ACL to the
-- schema default, so the revoke/grant pair is re-declared below, in this
-- same migration, exactly as CLAUDE.md requires for views for the same
-- reason: a protection that is not restated at the point of definition is a
-- protection that silently reopens on the next replay.
drop function if exists public.catalog_outreach_supply(integer);

create function public.catalog_outreach_supply(p_top integer default 20)
returns table (
  org_id uuid,
  org_name text,
  catalog_id uuid,
  catalog_name text,
  fit integer,
  readiness integer,
  has_hook boolean,
  delivered boolean,
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
    -- Unchanged from 0303: a founder org someone actually uses. Ordering
    -- supply by an abandoned org's needs would starve the founders waiting.
    select o.id, o.name
      from public.orgs o
     where coalesce(o.is_test, false) = false
       and o.name not ilike 'zz-test-%'
       and exists (select 1 from public.org_members m where m.org_id = o.id)
  ), delivered_stuck as (
    -- The new half: already in the founder's pipeline, already visible, and
    -- below the floor. `fit` is null by construction — these rows are not
    -- candidates being scored, they are commitments already made.
    select a.id as org_id, a.name as org_name, c.id as catalog_id, c.name as catalog_name,
           null::integer as fit, coalesce(c.outreach_readiness, 0) as readiness,
           true as delivered, 0 as tier
      from active_orgs a
      join public.catalog_deliveries d on d.org_id = a.id
      join public.catalog_entities c on c.id = d.catalog_id
     where coalesce(c.is_test, false) = false
       and coalesce(c.outreach_readiness, 0) < 40
  ), undelivered as (
    -- The original half, unchanged. catalog_top_matches already excludes
    -- delivered rows, so the two halves cannot overlap.
    select a.id as org_id, a.name as org_name, t.catalog_id, c.name as catalog_name,
           t.score as fit, t.readiness, false as delivered, 1 as tier
      from active_orgs a
      cross join lateral public.catalog_top_matches(a.id, greatest(coalesce(p_top, 20), 1)) t
      join public.catalog_entities c on c.id = t.catalog_id
  ), unioned as (
    select * from delivered_stuck
    union all
    select * from undelivered
  )
  select u.org_id, u.org_name, u.catalog_id, u.catalog_name, u.fit, u.readiness,
         exists (
           select 1 from public.catalog_person_affiliations pa
             join public.catalog_people p on p.id = pa.person_id
             join public.catalog_people_research pr on pr.person_id = p.id
            where pa.entity_id = u.catalog_id and coalesce(pr.hook, '') <> ''
         ),
         u.delivered,
         row_number() over (
           partition by u.org_id
           order by u.tier,
                    -- within the delivered tier: most broken first, because
                    -- that is the row costing the founder the most today
                    case when u.tier = 0 then u.readiness end asc,
                    -- within the candidate tier: unchanged, best fit first
                    case when u.tier = 1 then u.fit end desc,
                    u.readiness desc, u.catalog_id
         )::int
    from unioned u
   order by u.org_name, 9;
end;
$function$;

revoke all on function public.catalog_outreach_supply(integer) from public, anon, authenticated;
grant execute on function public.catalog_outreach_supply(integer) to service_role;

-- §C — close the default PUBLIC grant. Stated as revoke-then-grant so the
-- end state is declared, not inferred from whatever the default happened to
-- be at replay time.
revoke all on function public.matchdeal_profile_org_is_closed(uuid, text) from public, anon, authenticated;
grant execute on function public.matchdeal_profile_org_is_closed(uuid, text) to service_role;
