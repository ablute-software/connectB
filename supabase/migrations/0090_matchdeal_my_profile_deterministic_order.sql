-- Prompt 100 Bloco 1 — matchdeal_current_profile_ids()/matchdeal_my_profile()
-- had no ORDER BY, so a dual-role account (founder AND active investor
-- member, e.g. nunomarujo@ablute.pt) could get either profile back
-- nondeterministically. Confirmed this pair is currently dead code (no
-- caller anywhere in src/, no other Postgres function or RLS policy
-- references it — the real path, resolveOwnMatchdealProfileId(), already
-- filters by kind explicitly) so this carries zero behavior-change risk
-- today; fixing it anyway closes the footgun for whenever it's next used.
create or replace function public.matchdeal_my_profile()
returns matchdeal_profiles
language sql
stable
security definer
as $function$
  select * from public.matchdeal_profiles
  where id in (select public.matchdeal_current_profile_ids())
  order by created_at asc
  limit 1;
$function$;
