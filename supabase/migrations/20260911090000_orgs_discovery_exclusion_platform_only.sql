-- Prompt 852 §A — discovery_excluded_reason must be platform-imposed, and an
-- exclusion the excluded org can lift is not imposed. The org_update RLS policy
-- has no column restriction and no restrictive WITH CHECK, and `authenticated`
-- holds UPDATE on every column of orgs, so an excluded org's OWNER could
-- PATCH /rest/v1/orgs {discovery_excluded_reason: null} and walk back into the
-- market. A BEFORE UPDATE trigger is surgical: it changes no existing write
-- path (no product code writes this column — only migration 0311 and
-- pipeline-eligibility.ts read it) and leaves service_role able to manage it.
--
-- Verified 2026-09-11: with request.jwt.claim.role='authenticated', auth.role()
-- is distinct from 'service_role', so the guard raises; the app's admin client
-- (service_role key) is unaffected.

create or replace function public.orgs_protect_discovery_excluded()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if new.discovery_excluded_reason is distinct from old.discovery_excluded_reason
     and auth.role() is distinct from 'service_role' then
    raise exception 'DISCOVERY_EXCLUSION_PLATFORM_ONLY';
  end if;
  return new;
end; $fn$;

drop trigger if exists orgs_protect_discovery_excluded on public.orgs;
create trigger orgs_protect_discovery_excluded
  before update on public.orgs
  for each row execute function public.orgs_protect_discovery_excluded();
