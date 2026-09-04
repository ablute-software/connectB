-- Prompt 552 — the delivery floor was not doing what the decision said.
--
-- The decision recorded for Prompt 544 Part A was "floor = no contactable
-- person". What 0300 shipped was:
--
--   and exists (select 1 from catalog_person_affiliations pa where pa.entity_id = c.id)
--
-- which only asks whether ANY affiliation row exists — not whether that person
-- can actually be reached. Measured in production before writing this:
--
--   firm                affiliations  with linkedin  with hook  old floor  new floor
--   Hoxton Ventures            0             0           0        out        out
--   Kindred Capital            0             0           0        out        out
--   Salica Investments         0             0           0        out        out
--   Seedcamp                  16             0           0        IN         out
--   SFC Capital               18             0           0        IN         out
--   Mercia Ventures           32             5           0        in         in
--
-- SFC and Seedcamp carry 16 and 18 scraped names with no LinkedIn URL and no
-- researched hook between them. That is the same "não se sabe quem contactar"
-- the founder reported for Hoxton/Salica/Kindred — a list of names nobody can
-- write to — and the old floor waved it through because the rows existed.
--
-- Mercia stays in on 5 LinkedIn profiles out of 32 people, which is the point:
-- this excludes firms with nobody reachable, not firms that are merely
-- incompletely enriched.
--
-- Everything else about catalog_top_matches is unchanged from 0300: same fit
-- threshold (55), same ordering (fit desc, readiness desc, name), same
-- exclusion of already-delivered rows, same signature.
create or replace function public.catalog_top_matches(p_org_id uuid, p_limit integer)
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
     -- The floor, as decided: at least one affiliated person who can actually
     -- be reached — a LinkedIn profile to approach, or a researched hook.
     -- A name alone is not a contact.
     and exists (
       select 1 from public.catalog_person_affiliations pa
         join public.catalog_people p on p.id = pa.person_id
         left join public.catalog_people_research r on r.person_id = p.id
        where pa.entity_id = c.id
          and (p.linkedin_url is not null or coalesce(r.hook, '') <> '')
     )
     and public.catalog_match_score(p_org_id, c.id) >= 55
   order by public.catalog_match_score(p_org_id, c.id) desc, c.outreach_readiness desc, c.name
   limit greatest(coalesce(p_limit, 10), 0);
$function$;

revoke all on function public.catalog_top_matches(uuid, integer) from public, anon;
grant execute on function public.catalog_top_matches(uuid, integer) to authenticated, service_role;

-- The same predicate, exposed so nothing has to re-type it.
--
-- Prompt 552 is explicit that Part F must select the rows it revokes with the
-- SAME rule the floor uses, not a hand-written copy that can drift. This is
-- that rule, callable on its own — the revoke query asks this function, and
-- catalog_top_matches asks the identical condition inline for the planner's
-- sake. If the rule ever changes, both change here.
create or replace function public.catalog_has_reachable_person(p_catalog_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select exists (
    select 1 from public.catalog_person_affiliations pa
      join public.catalog_people p on p.id = pa.person_id
      left join public.catalog_people_research r on r.person_id = p.id
     where pa.entity_id = p_catalog_id
       and (p.linkedin_url is not null or coalesce(r.hook, '') <> '')
  );
$function$;

revoke all on function public.catalog_has_reachable_person(uuid) from public, anon;
grant execute on function public.catalog_has_reachable_person(uuid) to authenticated, service_role;
