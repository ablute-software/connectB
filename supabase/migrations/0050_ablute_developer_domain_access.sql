-- @ablute.pt domain access (prompt 43), part 1: backoffice.
-- FOR REVIEW ONLY, not applied.
--
-- Important context discovered before writing this: requirement #1
-- ("qualquer @ablute.pt tem sempre acesso ao backoffice") is ALREADY
-- WORKING today, confirmed live — src/app/api/provision-org/route.ts
-- already auto-upserts a platform_admins row for any confirmed @ablute.pt
-- signup (isAbluteTeam = emailConfirmed && isAbluteTeamEmail(email)), and
-- resolveRole() (src/lib/supabase-server.ts) already has an app-layer
-- fallback to 'developer' for the same condition. Both existing
-- platform_admins rows today are @ablute.pt accounts
-- (nunomarujo@ablute.pt as owner, alexandrameira@ablute.pt as admin) — the
-- second teammate's account proves the mechanism already works, it's not
-- untested code. So this migration is NOT "build backoffice access from
-- scratch" — it's defense-in-depth for two real, narrower gaps:
--
--   1. provision-org's upsert to platform_admins is wrapped in a silent
--      try/catch that swallows any failure (`catch { /* ignore */ }`,
--      deliberately never blocks signup) — but that also means a failed
--      upsert is invisible. If it ever fails, a confirmed @ablute.pt
--      teammate would silently NOT get backoffice access and nobody would
--      know. This migration doesn't fix the app code (that's a separate,
--      small change — log the failure instead of swallowing it silently);
--      it fixes the RLS layer so this failure mode doesn't matter anymore.
--   2. is_platform_admin() is purely table-based today. It works for
--      anyone who went through provision-org, but has no fallback for a
--      confirmed @ablute.pt user whose auth.users row exists through some
--      other path (e.g. a magic-link-only sign-in that never called
--      provision-org) and who has no platform_admins row for any reason.
--
-- Trust boundary, matching resolveRole()/provision-org exactly (not
-- auth.jwt()->>'email', which the prompt's own example suggested): reads
-- auth.users LIVE via SECURITY DEFINER, checking email_confirmed_at
-- explicitly every call. This is deliberately stronger than trusting a JWT
-- claim — it doesn't depend on whatever this Supabase project's global
-- "Confirm email" toggle happens to be set to (that setting lives outside
-- what a migration or this session's tooling can read or change; Nuno
-- should still verify it's ON in the Supabase Auth dashboard as an
-- additional layer, but this function does its own live check regardless).
create or replace function public.is_ablute_developer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) like '%@ablute.pt'
  );
$$;

-- Redefine is_platform_admin() itself (rather than editing ~16 tables'
-- worth of policies individually, per the "forma mais limpa" discretion
-- the prompt gave for point 2 — applying the same reasoning here since the
-- risk/benefit is identical): every existing policy that already calls
-- is_platform_admin() picks up the domain fallback automatically, with zero
-- chance of missing one. The platform_admins TABLE is untouched and still
-- the first check — this only adds an alternative path, exactly as asked
-- ("não substituir a tabela platform_admins... só adicionar a regra de
-- domínio como via alternativa").
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
    or is_ablute_developer();
$$;
