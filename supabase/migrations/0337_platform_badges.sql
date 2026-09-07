-- Prompt 601 — platform badges, Phase 1 (tech master, pioneer).
--
-- A NEW table, on purpose (§A): `company_badges` is the company's own
-- verifiable awards (evidence document, verification state) and is what
-- investors are shown. These rows are platform statuses tied to commercial
-- rights; mixing them into that list would dilute the one section of the
-- about page with probative value for a VC.
--
-- Additive and reversible: new table, new log table, two new functions, one
-- replaced function (matchdeal_eligible_deck — its filters are byte-for-byte
-- the 0300-series body; only the final ordering gained the §G boost and its
-- log). Dropping the four objects and re-applying the previous deck body
-- restores everything.

create table if not exists public.platform_badges (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  badge text not null check (badge in ('tech_master', 'pioneer', 'sedulous', 'dyed_in_the_wool', 'toughness')),
  granted_at timestamptz not null default now(),
  -- null = the system (e.g. the pioneer promo sweep), same convention as
  -- admin_audit_log.admin_user_id.
  granted_by uuid,
  justification text not null,
  -- Tier held for free while the free period applies; null = no free period.
  free_tier text check (free_tier in ('idea', 'garage', 'motherfunding')),
  -- End of the free period; null with a free_tier means forever (tech master).
  free_until timestamptz,
  discount_pct integer check (discount_pct between 0 and 100),
  -- The Stripe coupon last applied to the org's subscription for this badge,
  -- so the daily sweep can move a pioneer from the free coupon to the 25% one
  -- exactly once when the free period ends.
  stripe_coupon_applied text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  -- §F — the 2-month window passed with no use. NOT a revocation: rights
  -- continue until a person decides. Cleared automatically on the next use.
  lapsed_at timestamptz,
  lapse_reviewed_at timestamptz,
  lapse_reviewed_by uuid,
  last_warning_pct integer not null default 0,
  last_warning_at timestamptz,
  -- Phase 2 (Sedulous): one unit per week the outreach goal was met. Never decreases.
  sedulous_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One ACTIVE row per (org, badge); revoked rows stay as history.
create unique index if not exists platform_badges_active_uniq
  on public.platform_badges (org_id, badge) where revoked_at is null;
create index if not exists platform_badges_org_idx on public.platform_badges (org_id);

drop trigger if exists platform_badges_touch on public.platform_badges;
create trigger platform_badges_touch before update on public.platform_badges
  for each row execute function public.touch_updated_at();

alter table public.platform_badges enable row level security;

-- Founders read their own org's statuses (Plans & Billing, the about page);
-- platform admins read all. No insert/update/delete policy at all: every
-- write goes through the service role behind requirePlatformAdmin() and
-- lands in admin_audit_log (§C — "isto dá direitos que valem dinheiro").
drop policy if exists platform_badges_read on public.platform_badges;
create policy platform_badges_read on public.platform_badges
  for select using (public.is_platform_admin() or public.is_org_member(org_id));

-- §G — every time the boost changes an order, a line. Admin-only read.
create table if not exists public.matchdeal_rank_boost_log (
  id bigserial primary key,
  viewer_profile_id uuid not null,
  startup_profile_id uuid not null,
  org_id uuid,
  badge text not null,
  position_without integer not null,
  position_with integer not null,
  deck_size integer not null,
  created_at timestamptz not null default now()
);
create index if not exists matchdeal_rank_boost_log_created_idx on public.matchdeal_rank_boost_log (created_at desc);
alter table public.matchdeal_rank_boost_log enable row level security;
drop policy if exists matchdeal_rank_boost_log_admin_read on public.matchdeal_rank_boost_log;
create policy matchdeal_rank_boost_log_admin_read on public.matchdeal_rank_boost_log
  for select using (public.is_platform_admin());

-- §G — "definam o limite como parâmetro": the boost's reach lives here, not
-- as a number spread through the deck function. boost_max_per_deck = how
-- many badge holders may be lifted to the front of their band in one deck;
-- boost_badges = which statuses carry the boost.
create or replace function public.platform_badge_rank_params()
returns table (boost_max_per_deck integer, boost_badges text[])
language sql immutable
as $$
  select 2, array['tech_master', 'pioneer']::text[];
$$;

-- Which boost badge an org holds (tech master first), or null. SECURITY
-- DEFINER so the deck function can read platform_badges, and EXECUTE revoked
-- from every client role: §B.2 says the investor never sees a mark, and an
-- RPC that answers "does this org have a boost?" would be one.
create or replace function public.org_rank_boost_badge(p_org_id uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select b.badge from public.platform_badges b, public.platform_badge_rank_params() pr
      where b.org_id = p_org_id and b.revoked_at is null and b.badge = any(pr.boost_badges)
      order by case b.badge when 'tech_master' then 0 else 1 end
      limit 1),
    -- Prompt 161's flag, still the truth for orgs badged before this table existed.
    (select 'pioneer'::text from public.orgs o where o.id = p_org_id and o.pioneer_badge)
  );
$$;
revoke execute on function public.org_rank_boost_badge(uuid) from public, anon, authenticated;

-- The last real use of the app by an org, for the tech master window —
-- one aggregate in SQL rather than paging usage_sessions through PostgREST.
-- Service-role only (the founder-facing route resolves the org itself).
create or replace function public.platform_badge_usage_summary(p_org_id uuid, p_min_active_seconds integer default 60)
returns table (last_use timestamptz, sessions_60d bigint, active_days_60d bigint)
language sql stable security definer
set search_path = public
as $$
  select
    max(coalesce(s.last_flush_at, s.started_at)) filter (where s.active_seconds >= p_min_active_seconds) as last_use,
    count(*) filter (where s.started_at > now() - interval '60 days') as sessions_60d,
    count(distinct (s.started_at at time zone 'Europe/Lisbon')::date)
      filter (where s.started_at > now() - interval '60 days' and s.active_seconds >= p_min_active_seconds) as active_days_60d
  from public.usage_sessions s
  where s.org_id = p_org_id;
$$;
revoke execute on function public.platform_badge_usage_summary(uuid, integer) from public, anon, authenticated;

-- §G — the deck, with the boost. Everything above `return query` and every
-- filter inside it is the previous body unchanged. What changed:
--   * the pool is materialised once with its random key, so the order
--     "without" and "with" the boost are computed over the SAME draw;
--   * within a freshness band (never across it — a recently shown card
--     never jumps a fresh one), at most boost_max_per_deck badge holders
--     move to the front. Every card in the pool already passed the
--     investor's own fit filters, so the boost only ever reorders among
--     comparable fit (§G "limitado");
--   * each boosted card whose position changed is logged (§G "registado").
create or replace function public.matchdeal_eligible_deck(p_viewer_profile_id uuid, p_limit integer default 20)
returns setof public.matchdeal_profiles
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
  v_boost_max int;
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
  select pr.boost_max_per_deck into v_boost_max from public.platform_badge_rank_params() pr;

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
  with pool as materialized (
    select p.id, p.membership_id,
      (not exists (
        select 1 from public.matchdeal_exposures e
        where e.viewer_profile_id = p_viewer_profile_id
          and e.shown_profile_id = p.id
          and e.shown_at > now() - interval '7 days'
      )) as fresh,
      random() as rnd,
      (case when v_viewer.kind = 'investor' and p.kind = 'startup' then public.org_rank_boost_badge(p.membership_id) end) as boost_badge
    from public.matchdeal_profiles p
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
  ),
  seq as materialized (
    select pool.*,
      row_number() over (partition by pool.fresh, (pool.boost_badge is not null) order by pool.rnd) as boost_seq
    from pool
  ),
  ranked as materialized (
    select seq.id, seq.membership_id, seq.boost_badge,
      row_number() over (order by seq.fresh desc, seq.rnd) as pos_without,
      row_number() over (order by seq.fresh desc,
        (case when seq.boost_badge is not null and seq.boost_seq <= v_boost_max then 0 else 1 end),
        seq.rnd) as pos_with
    from seq
  ),
  logged as (
    insert into public.matchdeal_rank_boost_log
      (viewer_profile_id, startup_profile_id, org_id, badge, position_without, position_with, deck_size)
    select p_viewer_profile_id, r.id, r.membership_id, r.boost_badge, r.pos_without, r.pos_with, v_effective_limit
    from ranked r
    where r.boost_badge is not null
      and r.pos_with <> r.pos_without
      and least(r.pos_with, r.pos_without) <= v_effective_limit
    returning 1
  )
  select p.*
  from public.matchdeal_profiles p
  join ranked r on r.id = p.id
  order by r.pos_with
  limit v_effective_limit;
end;
$function$;
