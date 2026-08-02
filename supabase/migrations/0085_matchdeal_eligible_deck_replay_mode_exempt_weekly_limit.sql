-- Mini-prompt 2026-08-02 §1: deck_replay_mode was designed so an account
-- never runs out of deck, but the weekly shown_count cap (matchdeal_tier_limits
-- .deck_size) was checked BEFORE the replay logic and applied unconditionally
-- — with a small demo pool (7 visible investors) and replay repeatedly
-- re-showing the same profiles, shown_count hits deck_size (20 for tier_c)
-- long before the 7 profiles are actually "exhausted", and the function
-- returned nothing. Confirmed live on Nuno's own account: shown_count=20,
-- week_start=2026-07-27. Fix: accounts with deck_replay_mode=true are fully
-- exempt from the weekly shown_count cap (out of scope: real, non-replay
-- tier deck_size/like_limit — untouched, still enforced exactly as before).
-- shown_count itself still increments for replay accounts (matchdeal_record_
-- exposure untouched) — only its enforcement here changes, so weekly
-- analytics stay meaningful.
CREATE OR REPLACE FUNCTION public.matchdeal_eligible_deck(p_viewer_profile_id uuid, p_limit integer DEFAULT 20)
 RETURNS SETOF matchdeal_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_viewer public.matchdeal_profiles;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
  v_remaining int;
  v_effective_limit int;
  v_liked_count int;
  v_pool_count int;
begin
  select * into v_viewer from public.matchdeal_profiles where id = p_viewer_profile_id;
  v_weekly := public.matchdeal_get_or_create_weekly_activity(p_viewer_profile_id);
  select * into v_limits from public.matchdeal_tier_limits(v_viewer.plan_tier);
  v_remaining := greatest(v_limits.deck_size - v_weekly.shown_count, 0);
  if not v_viewer.deck_replay_mode and v_remaining = 0 then return; end if;
  v_effective_limit := case when v_viewer.deck_replay_mode then p_limit else least(p_limit, v_remaining) end;

  if v_viewer.deck_replay_mode then
    select count(*) into v_pool_count
    from public.matchdeal_profiles p
    where p.is_visible = true
      and p.kind <> v_viewer.kind
      and (v_viewer.kind <> 'investor' or v_viewer.sectors = '{}' or p.sectors && v_viewer.sectors)
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.stages_invested,1) is null or p.investment_stage_sought = any(v_viewer.stages_invested))
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.geographies,1) is null or p.country = any(v_viewer.geographies))
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.phases_accepted,1) is null or p.company_phase = any(v_viewer.phases_accepted))
      and (v_viewer.kind <> 'startup' or array_length(p.stages_invested,1) is null or v_viewer.investment_stage_sought = any(p.stages_invested))
      and (v_viewer.kind <> 'startup' or array_length(p.geographies,1) is null or v_viewer.country = any(p.geographies))
      and (v_viewer.kind <> 'startup' or array_length(p.phases_accepted,1) is null or v_viewer.company_phase = any(p.phases_accepted));

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
    and (
      (not v_viewer.deck_replay_mode and p.id not in (
        select target_profile_id from public.matchdeal_swipes where actor_profile_id = p_viewer_profile_id
      ))
      or
      (v_viewer.deck_replay_mode and p.id not in (
        select target_profile_id from public.matchdeal_swipes where actor_profile_id = p_viewer_profile_id and direction = 'like'
      ))
    )
    and (v_viewer.kind <> 'investor' or v_viewer.sectors = '{}' or p.sectors && v_viewer.sectors)
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.stages_invested,1) is null or p.investment_stage_sought = any(v_viewer.stages_invested))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.geographies,1) is null or p.country = any(v_viewer.geographies))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.phases_accepted,1) is null or p.company_phase = any(v_viewer.phases_accepted))
    and (v_viewer.kind <> 'startup' or array_length(p.stages_invested,1) is null or v_viewer.investment_stage_sought = any(p.stages_invested))
    and (v_viewer.kind <> 'startup' or array_length(p.geographies,1) is null or v_viewer.country = any(p.geographies))
    and (v_viewer.kind <> 'startup' or array_length(p.phases_accepted,1) is null or v_viewer.company_phase = any(p.phases_accepted))
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
end; $function$
