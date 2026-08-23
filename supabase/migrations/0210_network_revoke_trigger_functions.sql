-- Prompt 316 follow-up — Supabase advisor flagged three of 0209's new
-- functions as directly callable via PostgREST RPC by anon/authenticated
-- (0028/0029_security_definer_function_executable). Unlike
-- is_my_network_actor (an RLS-helper function in the same spirit as
-- is_org_member, which triggers the identical WARN and is left as-is
-- everywhere in this codebase, since RLS policies need authenticated to be
-- able to invoke it), these three are trigger functions — never meant to be
-- called directly at all, only ever fired by the trigger itself. Revoked,
-- same pattern as verification_insert_* (migration 0183).
revoke all on function public.network_actor_for_new_org() from public, anon, authenticated;
revoke all on function public.network_actor_for_new_investor_profile() from public, anon, authenticated;
revoke all on function public.enforce_network_invite_pending_cap() from public, anon, authenticated;
