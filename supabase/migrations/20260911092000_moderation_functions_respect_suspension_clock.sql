-- Prompt 857 §A — a timed suspension never expires in the market. The founder's
-- login gate (isLoginBlocked) and visibility (isVisibleToOthers,
-- account-moderation.ts) both respect moderation_suspended_until on the
-- TypeScript side, but these two SECURITY DEFINER functions only looked at
-- moderation_status. So a startup suspended for 48h logs back in at 49h yet
-- stays out of the deck and pipelines indefinitely, with no signal to anyone.
--
-- Both functions now mirror isVisibleToOthers exactly: a `suspended` account
-- whose moderation_suspended_until has passed is visible again; an indefinite
-- (NULL) or still-running suspension, or any other non-active status, stays
-- excluded. Verified against the four cases (active, suspended-indefinite,
-- suspended-future, suspended-expired). CREATE OR REPLACE preserves the
-- existing SECURITY DEFINER, search_path and grants.

create or replace function public.matchdeal_profile_discovery_excluded(p_membership_id uuid, p_kind text)
 returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select case
    when p_kind = 'startup' then exists (
      select 1 from public.orgs o
       where o.id = p_membership_id
         and (
           coalesce(o.discovery_excluded_reason, '') <> ''
           or (
             coalesce(o.moderation_status::text, 'active') <> 'active'
             and not (o.moderation_status::text = 'suspended'
                      and o.moderation_suspended_until is not null
                      and o.moderation_suspended_until <= now())
           )
         )
    )
    when p_kind = 'investor' then (
      exists (
        select 1 from public.matchdeal_investor_members im
         where im.id = p_membership_id
           and coalesce(im.discovery_excluded_reason, '') <> ''
      )
      or exists (
        select 1 from public.matchdeal_investor_members im
          join public.catalog_entities ce on ce.id = im.catalog_entity_id
         where im.id = p_membership_id
           and coalesce(ce.moderation_status::text, 'active') <> 'active'
           and not (ce.moderation_status::text = 'suspended'
                    and ce.moderation_suspended_until is not null
                    and ce.moderation_suspended_until <= now())
      )
      or not exists (
        select 1 from public.matchdeal_investor_members im where im.id = p_membership_id
      )
    )
    else false
  end;
$function$;

create or replace function public.catalog_top_matches(p_org_id uuid, p_limit integer)
 returns table(catalog_id uuid, score integer, readiness integer)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select c.id, public.catalog_match_score(p_org_id, c.id), c.outreach_readiness
    from public.catalog_entities c
   where c.verification_status = 'verified'
     and (
       coalesce(c.moderation_status::text, 'active') = 'active'
       or (c.moderation_status::text = 'suspended'
           and c.moderation_suspended_until is not null
           and c.moderation_suspended_until <= now())
     )
     and coalesce(c.is_test, false) = false
     and not exists (select 1 from public.catalog_deliveries d
                      where d.org_id = p_org_id and d.catalog_id = c.id)
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
