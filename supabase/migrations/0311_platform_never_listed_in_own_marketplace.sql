-- Prompt 563 — the platform must never be listed inside its own marketplace.
--
-- The org "Sherlock Deal" (48a7c481-…) carries a startup matchdeal_profiles
-- row. It is invisible today only by accident: the profile is incomplete —
-- no description, no photo, no deck — so is_visible is false. Complete it,
-- or click "Publish to MatchDeal" once, and Sherlock Deal starts appearing to
-- investors as a startup to invest in, inside the product it IS. That must be
-- impossible by construction, not by omission.
--
-- WHY NOT orgs.is_test, which was the first proposal: measured, its blast
-- radius is much wider than investor discovery, and all of the extra is
-- founder-facing.
--   * the monthly investor delivery stops entirely — /api/automations filters
--     !is_test and deliverMonthlyForOrg carries the authoritative guard, with
--     a test pinning it ("is_test: salta por completo, zero writes e zero rpc")
--   * automation rules stop running (automation-rules-tick-server.ts)
--   * the org drops out of catalog_outreach_supply, losing enrichment priority
--   * it stops contributing to pipeline tracking counts
-- is_test says "this account is not real". Sherlock Deal is real — CLAUDE.md
-- calls it "its own first real customer". Marking it would silently switch off
-- paid features to solve a listing problem. Two different statements deserve
-- two different columns.
--
-- WHY NOT matchdeal_profiles.is_visible = false, its current state: that is
-- the founder's own publish switch. One click undoes it. Being invisible by
-- accident is exactly what this replaces.
--
-- The column lives on orgs, not on the profile, because what may never be
-- listed is the ORGANISATION — whatever profile it has now, and whatever
-- profile row someone creates for it later. The reason is stored as text
-- rather than a boolean so the data documents itself: reading the row tells
-- you why, without going to find a migration.
--
-- Scope, deliberately: two investor-discovery call sites and nothing else.
-- Founder-facing behaviour (dashboard, automations, monthly delivery,
-- enrichment priority, RLS) is untouched — no RLS policy in this database
-- references any of this, and every read policy on orgs/org_members/entities/
-- documents/interactions goes through is_org_member() or is_ablute_developer().
alter table public.orgs add column if not exists discovery_excluded_reason text;

comment on column public.orgs.discovery_excluded_reason is
  'Non-null: never list this org in investor-facing discovery, whatever its matchdeal profile says. Distinct from is_test (which means "not a real account" and also disables founder features). The text is the documentation — say why.';

-- Mirrors matchdeal_profile_org_is_closed's shape exactly: same arguments,
-- same startup-only semantics, same place in the deck's WHERE clause. Only
-- 'startup' resolves — for an investor profile membership_id points at
-- matchdeal_investor_members, a different id space, and an investor is not an
-- org anyway.
create or replace function public.matchdeal_profile_discovery_excluded(
  p_membership_id uuid, p_kind text
) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select p_kind = 'startup'
     and exists (
       select 1 from public.orgs o
        where o.id = p_membership_id
          -- Non-empty, not merely non-null: the TypeScript mirror in
          -- pipeline-eligibility.ts tests truthiness, so '' must mean "not
          -- excluded" on both sides or the deck and the pipeline filter would
          -- disagree for exactly one value. An empty reason documents nothing,
          -- which is the whole point of storing text.
          and coalesce(o.discovery_excluded_reason, '') <> ''
     );
$fn$;

revoke all on function public.matchdeal_profile_discovery_excluded(uuid, text) from public, anon, authenticated;
grant execute on function public.matchdeal_profile_discovery_excluded(uuid, text) to service_role;

-- The deck, unchanged except for the two lines added beside the existing
-- closed-org check. Generated from 0305's definition by script rather than
-- retyped, and the result is verified against production afterwards by
-- removing the two new lines and comparing the digest of the rest.
create or replace function public.matchdeal_eligible_deck(p_viewer_profile_id uuid, p_limit integer default 20)
returns setof matchdeal_profiles
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_viewer public.matchdeal_profiles;
  v_viewer_is_test boolean;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
  v_remaining int;
  v_effective_limit int;
  v_liked_count int;
  v_pool_count int;
  v_exempt boolean;
begin
  if auth.role() is distinct from 'service_role'
     and not exists (
       select 1 from public.matchdeal_current_profile_ids() as f(id)
       where f.id = p_viewer_profile_id
     ) then
    raise exception 'MATCHDEAL_NOT_YOUR_PROFILE';
  end if;

  select * into v_viewer from public.matchdeal_profiles where id = p_viewer_profile_id;
  v_viewer_is_test := public.matchdeal_profile_is_test(p_viewer_profile_id);
  v_weekly := public.matchdeal_get_or_create_weekly_activity(p_viewer_profile_id);
  select * into v_limits from public.matchdeal_tier_limits(v_viewer.plan_tier);
  v_remaining := greatest(v_limits.deck_size - v_weekly.shown_count, 0);
  v_exempt := public.is_ablute_developer();
  if not v_exempt and v_remaining = 0 then return; end if;
  v_effective_limit := case when v_exempt then p_limit else least(p_limit, v_remaining) end;

  if v_viewer.deck_replay_mode then
    select count(*) into v_pool_count
    from public.matchdeal_profiles p
    where p.is_visible = true
      and p.kind <> v_viewer.kind
      and not public.matchdeal_profile_org_is_closed(p.membership_id, p.kind)
      and not public.matchdeal_profile_discovery_excluded(p.membership_id, p.kind)
      and (v_exempt or v_viewer_is_test or not public.matchdeal_profile_is_test(p.id))
      and (v_viewer.kind <> 'investor' or v_viewer.sectors = '{}' or p.sectors && v_viewer.sectors)
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.stages_invested,1) is null or p.investment_stage_sought = any(v_viewer.stages_invested))
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.geographies,1) is null or p.country = any(v_viewer.geographies))
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.phases_accepted,1) is null or p.company_phase = any(v_viewer.phases_accepted))
      and (v_viewer.kind <> 'investor' or not public.sector_excluded(p.sectors, v_viewer.exclusions_sectors, v_viewer.exclusions_notes))
      and (v_viewer.kind <> 'startup' or array_length(p.stages_invested,1) is null or v_viewer.investment_stage_sought = any(p.stages_invested))
      and (v_viewer.kind <> 'startup' or array_length(p.geographies,1) is null or v_viewer.country = any(p.geographies))
      and (v_viewer.kind <> 'startup' or array_length(p.phases_accepted,1) is null or v_viewer.company_phase = any(p.phases_accepted))
      and (v_viewer.kind <> 'startup' or not public.sector_excluded(v_viewer.sectors, p.exclusions_sectors, p.exclusions_notes));

    select count(distinct target_profile_id) into v_liked_count
    from public.matchdeal_swipes
    where actor_profile_id = p_viewer_profile_id and direction = 'like';

    if v_pool_count > 0 and v_liked_count >= v_pool_count then
      delete from public.matchdeal_swipes where actor_profile_id = p_viewer_profile_id;
    end if;
  end if;

  return query
  select p.* from public.matchdeal_profiles p
  where p.is_visible = true
    and p.kind <> v_viewer.kind
    and not public.matchdeal_profile_org_is_closed(p.membership_id, p.kind)
    and not public.matchdeal_profile_discovery_excluded(p.membership_id, p.kind)
    and (
      (not v_viewer.deck_replay_mode and p.id not in (
        select target_profile_id from public.matchdeal_swipes where actor_profile_id = p_viewer_profile_id
      ))
      or
      (v_viewer.deck_replay_mode and p.id not in (
        select target_profile_id from public.matchdeal_swipes where actor_profile_id = p_viewer_profile_id and direction = 'like'
      ))
    )
    and (v_exempt or v_viewer_is_test or not public.matchdeal_profile_is_test(p.id))
    and (v_viewer.kind <> 'investor' or v_viewer.sectors = '{}' or p.sectors && v_viewer.sectors)
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.stages_invested,1) is null or p.investment_stage_sought = any(v_viewer.stages_invested))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.geographies,1) is null or p.country = any(v_viewer.geographies))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.phases_accepted,1) is null or p.company_phase = any(v_viewer.phases_accepted))
    and (v_viewer.kind <> 'investor' or not public.sector_excluded(p.sectors, v_viewer.exclusions_sectors, v_viewer.exclusions_notes))
    and (v_viewer.kind <> 'startup' or array_length(p.stages_invested,1) is null or v_viewer.investment_stage_sought = any(p.stages_invested))
    and (v_viewer.kind <> 'startup' or array_length(p.geographies,1) is null or v_viewer.country = any(p.geographies))
    and (v_viewer.kind <> 'startup' or array_length(p.phases_accepted,1) is null or v_viewer.company_phase = any(p.phases_accepted))
    and (v_viewer.kind <> 'startup' or not public.sector_excluded(v_viewer.sectors, p.exclusions_sectors, p.exclusions_notes))
    and not exists (
      select 1 from public.matchdeal_entity_blocks bl
      where (v_viewer.kind = 'startup'
             and bl.startup_profile_id = p_viewer_profile_id
             and bl.catalog_entity_id = (
               select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = p.membership_id))
         or (v_viewer.kind = 'investor'
             and bl.startup_profile_id = p.id
             and bl.catalog_entity_id = (
               select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = v_viewer.membership_id))
    )
    and not exists (
      select 1 from public.matchdeal_matches m
      where m.cooldown_until is not null and m.cooldown_until > now()
        and (
          (v_viewer.kind = 'startup' and m.startup_profile_id = p_viewer_profile_id
            and m.investor_catalog_entity_id = (
              select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = p.membership_id))
          or
          (v_viewer.kind = 'investor' and p.id = m.startup_profile_id
            and m.investor_catalog_entity_id = (
              select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = v_viewer.membership_id))
        )
    )
  order by
    (not exists (
      select 1 from public.matchdeal_exposures e
      where e.viewer_profile_id = p_viewer_profile_id
        and e.shown_profile_id = p.id
        and e.shown_at > now() - interval '7 days'
    )) desc,
    random()
  limit v_effective_limit;
end; $function$;

-- The exclusion itself, stated here so the repository carries the intent and
-- not only the mechanism. Idempotent, and a no-op on any environment where
-- this org does not exist (a fresh replay, a branch database).
update public.orgs
   set discovery_excluded_reason =
       'Sherlock Deal is the platform itself; it must never appear as a startup inside its own marketplace.'
 where id = '48a7c481-3946-4a06-a86f-6169bd382c76'
   and discovery_excluded_reason is null;
