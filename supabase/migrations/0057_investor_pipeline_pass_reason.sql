-- Investor Workspace Pipeline (prompt 58) — extends matchdeal_swipes rather
-- than a new table, per the prompt's own instruction: MatchDeal (swipes)
-- and the Investor Workspace Pipeline (curation) are two views of the same
-- investor<->startup graph, not two engines. Pipeline writes rows into this
-- same table (actor = the investor's matchdeal_profiles row, target = the
-- startup's), but goes through a plain upsert from the API route rather
-- than matchdeal_record_swipe(): that RPC's weekly like-limit and mutual-
-- match/consent/dataroom-grant machinery is specific to the swipe-deck
-- product and wrong for a curated, already-access-granted Pipeline (data
-- room access here comes from access_grants, set up independently of
-- MatchDeal matching).
alter table matchdeal_swipes
  add column if not exists pass_reason text
  check (pass_reason is null or pass_reason = any (array['ticket_too_small','outside_thesis','too_early','other']));
