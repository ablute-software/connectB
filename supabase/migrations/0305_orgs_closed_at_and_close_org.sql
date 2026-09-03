-- Prompt 556 §A — an org can be CLOSED.
--
-- Numbered 0305, not 0303. This file WAS 0303 when it was written and
-- applied: a sweep of every remote branch at the time showed 0302 as the
-- highest number taken. Two other workstreams then landed numbers of their
-- own between that sweep and this push — `claude/prompt-544-outreach-ready`
-- committed its own 0302 and 0303 (18:17 and 18:51 UTC, before this file's
-- 19:11), and `claude/prompt-556-matchdeal-is-test` took 0304. Renumbering
-- THIS file rather than theirs leaves them exactly one rename to do (their
-- 0302, which collides with the 0302 already merged to main) instead of two.
-- The rename is safe on its own terms: the SQL is already applied to
-- production under the Supabase migration name `orgs_closed_at_and_close_org`
-- (version 20260903172538), and the repo file is the record, not the trigger.
--
-- Note on the name collision too: the OTHER branch's "Prompt 556" is a
-- different brief with the same number (a test investor never reaching a real
-- organisation). This one is the deleted-startup/closed-org brief. Same
-- number, two unrelated changes — read the section headers, not the number.
--
-- Two facts, both confirmed in production on 03/09/2026:
--
--   1. `orgs` had no notion of an account ending. Deleting the auth user
--      cascades `org_members` (org_members_user_id_fkey ON DELETE CASCADE)
--      and stops there: the `orgs` row, its `matchdeal_profiles` row, its
--      entities, its documents all survive, owned by nobody. Krohnsty
--      54f1bf67 has been in exactly that state since 02/09 — zero members,
--      all nine profile-gate fields still filled in.
--   2. Because investor discovery keyed off that gate (see this migration's companion
--      change in src/lib/portal-access.ts), the orphan was still being
--      served to every investor as a discovery card. Nuno saw it in his own
--      investor Pipeline, with all its data, after deleting the account.
--
-- So: one column, one function, one trigger, one backfill. NOTHING is
-- hard-deleted here — a closed org keeps every row it had. Closing is a
-- state, and the retention policy (a separate decision, not this migration)
-- is what may later remove data.
--
-- `deal_threads` is deliberately untouched: the prompt asks to close open
-- threads "if that table has a status", and it has none — its columns are
-- id, startup_org_id, investor_catalog_entity_id, created_at,
-- last_message_at, investor_last_read_at, founder_last_read_at. There is no
-- open/closed state to set, so nothing is invented here; the investor-facing
-- thread is handled in the app (composer disabled, header note) instead.

alter table public.orgs add column if not exists closed_at timestamptz;

comment on column public.orgs.closed_at is
  'When this organisation stopped existing as an account (Prompt 556). Set by close_org(), '
  'automatically when the last org_members row is deleted. Never hard-deletes anything: a closed '
  'org keeps its rows, disappears from investor discovery, and shows to investors who already had '
  'history with it as "This startup is no longer available".';

create index if not exists orgs_closed_at_idx on public.orgs (closed_at) where closed_at is not null;

-- close_org — idempotent. Everything it touches is a HIDE or a REVOKE,
-- never a delete.
--
--   * orgs.closed_at            — the new state itself.
--   * orgs.platform_suspended_at — the pre-existing "hide from the Pipeline"
--     flag eligiblePipelineOrgIds already reads (Prompt 184 §2, migration
--     0168). Set here on purpose so the SQL alone removes a closed org from
--     investor discovery the moment this migration is applied, WITHOUT
--     waiting for the app deploy that adds the closed_at filter.
--   * matchdeal_profiles.platform_suspended_at — the same flag on the
--     startup's MatchDeal profile. Note that is_visible is NOT set directly:
--     trg_matchdeal_profile_completeness recomputes it on every write as
--     `is_complete and owner_suspended_at is null and platform_suspended_at
--     is null`, so setting platform_suspended_at IS how is_visible becomes
--     false, and writing is_visible ourselves would just be overwritten by
--     the trigger in the same statement.
--   * access_grants.revoked_at — same shape decide_investor_relationship
--     uses for 'passed'. A revoked grant already drops out of
--     activeGrantOrgIds, so the closed org disappears from Access granted.
--
-- coalesce(..., now()) everywhere so re-running never moves a timestamp that
-- some other action (an owner hiding themselves, a back-office suspension)
-- had already set for its own reasons.
create or replace function public.close_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_closed_at timestamptz;
  v_exists boolean;
begin
  select (o.id is not null), o.closed_at into v_exists, v_closed_at
  from public.orgs o where o.id = p_org_id;

  -- Not an error: the parent row is already gone when ON DELETE CASCADE
  -- runs org_members' own delete triggers, so the trigger below reaches
  -- this branch on every `delete from orgs`.
  if not coalesce(v_exists, false) then return; end if;
  if v_closed_at is not null then return; end if;

  update public.orgs
     set closed_at = now(),
         platform_suspended_at = coalesce(platform_suspended_at, now())
   where id = p_org_id;

  update public.matchdeal_profiles
     set platform_suspended_at = coalesce(platform_suspended_at, now())
   where membership_id = p_org_id and kind = 'startup';

  update public.access_grants
     set revoked_at = now()
   where org_id = p_org_id and revoked_at is null;
end;
$function$;

revoke all on function public.close_org(uuid) from public;
revoke all on function public.close_org(uuid) from anon;
revoke all on function public.close_org(uuid) from authenticated;

-- The only "delete account" path that exists today is deleting the auth
-- user (Supabase dashboard), which cascades to org_members. This trigger is
-- what turns that into a closed org, in the same transaction.
create or replace function public.orgs_close_when_last_member_removed()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not exists (select 1 from public.org_members m where m.org_id = old.org_id) then
    perform public.close_org(old.org_id);
  end if;
  return old;
end;
$function$;

revoke all on function public.orgs_close_when_last_member_removed() from public;
revoke all on function public.orgs_close_when_last_member_removed() from anon;
revoke all on function public.orgs_close_when_last_member_removed() from authenticated;

drop trigger if exists trg_orgs_close_when_last_member_removed on public.org_members;
create trigger trg_orgs_close_when_last_member_removed
after delete on public.org_members
for each row execute function public.orgs_close_when_last_member_removed();

-- Prompt 556 §B (SQL half) — the swipe deck must never show a closed org
-- either. A closed org's profile already has platform_suspended_at set, so
-- is_visible is false and the existing `p.is_visible = true` predicate
-- excludes it; this is the belt, so a profile row resurrected by any other
-- write path can't put a closed org back in the deck.
--
-- Mirrors matchdeal_profile_is_test's shape deliberately: one stable
-- function, applied as ONE predicate in BOTH places the pool is evaluated
-- (the deck_replay_mode count and the main query). 0172's own header
-- explains why both matter — a pool count larger than the query's own
-- result set means replay never fires and the deck stays empty forever.
create or replace function public.matchdeal_profile_org_is_closed(p_membership_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_kind = 'startup'
     and exists (select 1 from public.orgs o where o.id = p_membership_id and o.closed_at is not null);
$function$;

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

-- Backfill. Read out and reported BEFORE running (Prompt 556's own
-- instruction): exactly one org matches in production — Krohnsty
-- 54f1bf67-66a3-4c60-8e1b-9ec39ea2c0dd, the account deleted on 03/09. The
-- five other member-less orgs are all `e1000000-…` demo seeds and are
-- excluded twice over (name suffix AND id prefix), per the prompt's "do
-- not touch the demo orgs".
do $backfill$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select o.id, o.name from public.orgs o
    where not exists (select 1 from public.org_members m where m.org_id = o.id)
      and o.closed_at is null
      and o.name not like '%(demo)'
      and o.id::text not like 'e1000000-%'
  loop
    perform public.close_org(r.id);
    v_count := v_count + 1;
    raise notice 'close_org backfill: closed % (%)', r.name, r.id;
  end loop;
  raise notice 'close_org backfill: % org(s) closed', v_count;
end;
$backfill$;
