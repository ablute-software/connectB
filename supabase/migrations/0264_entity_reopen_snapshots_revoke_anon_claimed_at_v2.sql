-- Prompt 416 follow-up v2 — the previous migration's `revoke ... from
-- public` didn't actually remove anon's EXECUTE: this project's default
-- privileges auto-grant EXECUTE on new public-schema functions directly to
-- anon/authenticated/service_role (not via PUBLIC membership), confirmed
-- via information_schema.routine_privileges showing anon still listed
-- afterward. Revoking from anon explicitly, same as this codebase's other
-- definer-function cleanups (0136/0137/0138) actually do. Verified after
-- this ran: only postgres/authenticated/service_role remain.
revoke execute on function public.catalog_entity_claimed_at(uuid) from anon;
