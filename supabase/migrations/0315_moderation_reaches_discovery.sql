-- Prompt 571 — suspending or deleting an account now removes it from the
-- market, not only from the login.
--
-- Two systems built at different times, neither listening to the other:
-- moderation (a session gate plus a ledger) and discovery exclusion (556/563/
-- 568: is_visible, closed_at, discovery_excluded_reason). Verified before
-- writing this, not taken on report:
--
--   * applyModerationAction (moderation-actions.ts:82) writes exactly three
--     columns — moderation_status, moderation_quarantine_until,
--     moderation_suspended_until. Never closed_at, never
--     platform_suspended_at, never discovery_excluded_reason.
--   * Of the four functions that decide what a viewer sees, only
--     catalog_top_matches mentions moderation at all. matchdeal_eligible_deck,
--     matchdeal_profile_discovery_excluded and matchdeal_profile_org_is_closed
--     do not.
--
-- So a startup could be suspended with a justification and keep sitting in
-- every investor's deck for the 30-day quarantine and beyond: an investor
-- could like an account whose founder can no longer log in.
--
-- Latent today — the one suspended org (Estojo) happens to have is_visible =
-- false, so it is out by coincidence rather than by rule, and no account has
-- ever been deleted. But 569 §0 just made the delete path visible on screen,
-- and the first real use is what produces the ghost.
--
-- WHY READ, NOT DUAL-WRITE. Having applyModerationAction also set
-- discovery_excluded_reason would make undo responsible for unsetting it, and
-- would make one column answer two different questions — it means "this
-- account must never be listed" (563/568), a permanent property, not "this
-- account is suspended right now". Reading moderation_status where the
-- decision is made leaves nothing to undo: undo returns the row to 'active'
-- and the profile reappears by itself.
--
-- Absent-means-active on both sides, matching how every other field in this
-- family degrades.
create or replace function public.matchdeal_profile_discovery_excluded(
  p_membership_id uuid, p_kind text
) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select case
    when p_kind = 'startup' then exists (
      select 1 from public.orgs o
       where o.id = p_membership_id
         and (
           coalesce(o.discovery_excluded_reason, '') <> ''
           -- Prompt 571 — suspended or deleted leaves the deck for as long as
           -- it lasts, and comes back on undo with no further action.
           or coalesce(o.moderation_status::text, 'active') <> 'active'
         )
    )
    when p_kind = 'investor' then (
      exists (
        select 1 from public.matchdeal_investor_members im
         where im.id = p_membership_id
           and coalesce(im.discovery_excluded_reason, '') <> ''
      )
      -- Prompt 571 — the mirror case: a moderated investor FIRM would
      -- otherwise keep serving its members' profiles to startups, because the
      -- membership still resolves and 0314's orphan rule never fires.
      or exists (
        select 1 from public.matchdeal_investor_members im
          join public.catalog_entities ce on ce.id = im.catalog_entity_id
         where im.id = p_membership_id
           and coalesce(ce.moderation_status::text, 'active') <> 'active'
      )
      -- 0314: a profile whose membership does not resolve has no owner, so
      -- nobody can be introduced to it.
      or not exists (
        select 1 from public.matchdeal_investor_members im where im.id = p_membership_id
      )
    )
    else false
  end;
$fn$;

-- Re-declared because create or replace does not preserve them on its own,
-- and because a protection restated at the point of definition is one that
-- cannot silently reopen on a replay.
revoke all on function public.matchdeal_profile_discovery_excluded(uuid, text) from public, anon, authenticated;
grant execute on function public.matchdeal_profile_discovery_excluded(uuid, text) to service_role;
