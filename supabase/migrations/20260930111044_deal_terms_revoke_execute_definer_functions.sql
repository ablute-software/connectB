-- Review follow-up (30/09/2026), found by this session's own post-apply
-- Supabase advisor check on the just-applied deal_terms migration (not in
-- Prompt 898's own list) — three SECURITY DEFINER functions were directly
-- RPC-callable by anon/authenticated via /rest/v1/rpc/<name>. None leaks
-- data (deal_terms_sync_interest/interactions_create_ask_term return void;
-- deal_terms_sync_interest_trigger is a trigger function with no meaningful
-- standalone call shape), but this is exactly the "armed but inert" grant
-- shape review fix B already eliminated on deal_terms itself, and Postgres
-- does not require EXECUTE for a trigger's own internal firing — the
-- trigger mechanism invokes the function with the definer's privileges
-- regardless of the firing role's own grants, so this revoke changes
-- nothing about normal app behavior. Confirmed empirically in production
-- (rolled-back transaction, 30/09/2026): a fixture deal_terms insert still
-- correctly derived entities.interest_eur via the trigger after this revoke.
revoke execute on function public.deal_terms_sync_interest(uuid) from public, anon, authenticated;
revoke execute on function public.deal_terms_sync_interest_trigger() from public, anon, authenticated;
revoke execute on function public.interactions_create_ask_term() from public, anon, authenticated;
