-- Prompt 855 §A — the investor branch of matchdeal_profile_discovery_excluded
-- excludes a profile whose owning member no longer exists (migration 0314), but
-- the startup branch never gained the symmetric rule. A startup profile whose
-- org has been deleted stays served to investors. No longer hypothetical: 4
-- orphan startup profiles exist today (membership_id with no org), none visible
-- yet. Add the orphan clause to the startup branch, same words as 0314: a
-- startup with no org is nobody an investor can be introduced to. The 857 §A
-- suspension-clock logic is preserved verbatim; CREATE OR REPLACE keeps the
-- SECURITY DEFINER, search_path and grants. Verified 2026-09-11: the 4 orphans
-- are now excluded, a real active org (ablute_) is not.

create or replace function public.matchdeal_profile_discovery_excluded(p_membership_id uuid, p_kind text)
 returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select case
    when p_kind = 'startup' then (
      exists (
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
      or not exists (
        select 1 from public.orgs o where o.id = p_membership_id
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
