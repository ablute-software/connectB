-- Prompt 568 — the team's own investor accounts stop appearing to startups.
--
-- All seven investor profiles in production belong to the team. Two of them
-- are is_visible = true today — "ablute_ — Internal QA" and
-- "nunomarujo@gmail.com — Individual investor" — so a new startup's deck can
-- already show them. The other four are invisible only because their profiles
-- are incomplete, which is the same accident 563 refused to rely on.
--
-- What must NOT change: these accounts keep working as investors. They swipe,
-- match, open Data Rooms, and see startups exactly as before. This is only
-- about what a STARTUP sees when matchdeal_eligible_deck runs with it as the
-- viewer.
--
-- CHOICE OF PLACE — (b), on matchdeal_investor_members, not on
-- matchdeal_profiles.
--
-- 563 put the startup-side flag on `orgs` and said why: what may never be
-- listed is the ORGANISATION, whatever profile row it has now and whatever
-- row someone creates for it later. The investor-side equivalent of an org is
-- the membership, not the profile — a profile is the thing that gets recreated.
-- Putting it on matchdeal_profiles (option (a) in the prompt) would serve both
-- kinds from one column, but it would also be forgotten the first time a
-- profile is rebuilt, which is exactly the failure 563 was written to avoid.
--
-- THE ORPHAN, which decided the second half of this.
--
-- matchdeal_profiles 5b070ff4-… (kind investor) points at membership
-- a34c8c80-…, which does not exist. It is is_visible = false with zero swipes,
-- so it is harmless today — but "harmless because a flag happens to be false"
-- is the accident again, and option (b) alone cannot mark it: there is no
-- membership row to mark. So the function below also excludes an investor
-- profile whose membership does not resolve at all. An investor profile with
-- no owning member is not an investor anyone can be introduced to, and the
-- deck should never offer one. That makes the orphan safe by rule rather than
-- by luck, and covers any future row that loses its member.
--
-- No change to matchdeal_eligible_deck: 563 already calls
-- matchdeal_profile_discovery_excluded(p.membership_id, p.kind) unconditionally
-- in both of its branches. Only the function's investor half is new.
alter table public.matchdeal_investor_members
  add column if not exists discovery_excluded_reason text;

comment on column public.matchdeal_investor_members.discovery_excluded_reason is
  'Non-null: never show this investor in a startup''s discovery deck, whatever the profile says. The account keeps full investor access — it can still swipe, match and be paired. Mirrors orgs.discovery_excluded_reason on the startup side (Prompt 563). The text is the documentation — say why.';

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
         and coalesce(o.discovery_excluded_reason, '') <> ''
    )
    when p_kind = 'investor' then (
      -- Marked internal, OR orphaned: a profile whose membership row is gone
      -- has no owner, so nobody can be introduced to it. Both are "do not
      -- list", and the second cannot be expressed as a flag on a row that
      -- does not exist.
      exists (
        select 1 from public.matchdeal_investor_members im
         where im.id = p_membership_id
           and coalesce(im.discovery_excluded_reason, '') <> ''
      )
      or not exists (
        select 1 from public.matchdeal_investor_members im where im.id = p_membership_id
      )
    )
    else false
  end;
$fn$;

revoke all on function public.matchdeal_profile_discovery_excluded(uuid, text) from public, anon, authenticated;
grant execute on function public.matchdeal_profile_discovery_excluded(uuid, text) to service_role;

-- The six real memberships behind the seven profiles. Idempotent, and a no-op
-- on any environment where these ids do not exist.
update public.matchdeal_investor_members
   set discovery_excluded_reason =
       'Internal team account — used for pre-launch QA, not a real investor. Keeps full investor access; only hidden from startups'' discovery decks.'
 where id in (
   '17aabd81-9f2f-480c-8d75-90727ffceb72',  -- ablute_ — Internal QA (member)
   'c639efff-035d-4c1b-b60f-9b4ea66528ff',  -- ablute_ — Internal QA (owner)
   'f70778e2-10ac-47c4-a70e-1ee1bb8dcbc4',  -- Invest green
   'e846f4ba-7811-4cb2-a735-f7abe7330e3c',  -- nunomarujo@gmail.com — Individual investor
   'f499da61-2454-447a-9b19-a4ad7d10e99c',  -- Test idividual
   '260c7989-3f0e-468a-a48c-bf37dd96f511'   -- Test investor
 )
   and coalesce(discovery_excluded_reason, '') = '';
