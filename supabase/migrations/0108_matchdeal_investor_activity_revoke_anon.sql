-- Verification pass on Prompt 110 Block C found matchdeal_investor_activity
-- executable by anon/PUBLIC — Postgres grants EXECUTE to PUBLIC by default on
-- a new function, and migration 0106 never revoked it before granting to
-- authenticated. Severity was assessed as low (UUIDs aren't guessable, and
-- the function only ever returns buckets, never exact data) but it's
-- inconsistent with the rest of MatchDeal's access model, where only a
-- caller with an actual exposure/match to the profile can see anything
-- about it. This closes the gap without touching the function body.
revoke execute on function public.matchdeal_investor_activity(uuid) from anon, public;
