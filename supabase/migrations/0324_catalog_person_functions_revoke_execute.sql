-- Prompt 581 §D fix — migration 0320's 4 new SECURITY DEFINER functions
-- were exposed as public RPC endpoints by default (Supabase advisors
-- 0028/0029, confirmed live immediately after applying 0320: anon AND
-- authenticated could both call
-- POST /rest/v1/rpc/catalog_person_apply_field with an arbitrary
-- person_id/field/value/level and have it execute with full RLS-bypassing
-- privileges — an unauthenticated write into any catalog person, or
-- (via the reverse-sync inside it) into any founder's private `people`
-- row). These four are internal helpers, only ever meant to be called
-- from the triggers/functions that chain to them, never as a directly
-- callable client RPC — same class of gap, same fix, as migrations 0078/
-- 0108/0124/0133 already applied to other DEFINER functions in this
-- codebase.
revoke execute on function public.catalog_person_apply_field(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.catalog_person_check_consensus() from public, anon, authenticated;
revoke execute on function public.catalog_person_contribute(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.people_contribute_to_catalog() from public, anon, authenticated;
