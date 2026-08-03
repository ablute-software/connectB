-- Prompt 101 §4 — cold-start multiplier anchor, schema only. Anchored to
-- orgs (not matchdeal_profiles) so deleting/recreating a MatchDeal profile
-- can't reset the clock. No population trigger or exposure-multiplier
-- logic yet — explicitly not to be built without further confirmation.
alter table public.orgs add column first_visible_at timestamptz;
