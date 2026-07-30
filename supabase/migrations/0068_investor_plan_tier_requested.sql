-- Prompt 74 Bloco 2 — Investor Workspace Plans & billing. Mirrors
-- orgs.plan_change_requested (migration 0028) exactly: a free-text request
-- column the platform team applies manually, not a live Stripe write. No
-- new pricing decision here — INVESTOR_PLANS (plans.ts) and the tier_a/b/c
-- <-> Boy Scout/Pro Spotter/Ace Sleuth mapping (migration 0053's own
-- comment on matchdeal_profiles.plan_tier) already existed; this just gives
-- an investor a place to record "I want tier_b" against their own row.
alter table matchdeal_profiles add column if not exists plan_tier_requested text
  check (plan_tier_requested is null or plan_tier_requested = any (array['tier_a','tier_b','tier_c']));
alter table matchdeal_profiles add column if not exists plan_tier_requested_at timestamptz;
