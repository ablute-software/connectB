-- Prompt 416 follow-up — catalog_entity_claimed_at() (0262) was granted to
-- `authenticated` but its default PUBLIC execute grant was never revoked
-- first, so `anon` could still call it (Supabase advisor lints 0028/0029
-- confirmed this). Revoking from public — turned out NOT sufficient on its
-- own (see 0264, applied moments later once information_schema.routine_
-- privileges showed anon still had EXECUTE afterward) but kept here as the
-- first, correct-as-far-as-it-goes step, matching exactly what was applied
-- to production.
revoke execute on function public.catalog_entity_claimed_at(uuid) from public;
grant execute on function public.catalog_entity_claimed_at(uuid) to authenticated;
