-- Prompt 671 §2 — "who moved this entity to what state, when" has nowhere to
-- live today. Confirmed independently (matching the verifier's own SQL):
-- interactions.previous_status/previous_stage/reverted_at/reverted_by are all
-- dead (0 of 524 rows populated), admin_audit_log has zero entity-status-
-- change entries, and app_events has none either.
--
-- admin_audit_log is the WRONG table for this: its RLS is is_platform_admin()
-- only — a founder's own session cannot write OR read it, so it can never
-- back a founder-visible history for the founder's own CRM action. The right
-- fix reuses interactions (already org-scoped, already renders in the
-- entity's History via ThreadDrawer's stage_change line) and adds the one
-- thing it's missing: who. Mirrors contributions.author_user_id exactly
-- (Prompt 572 §C.1's own precedent for "the founder's authenticated session
-- wrote this row but never said who").
--
-- Nullable, no backfill: the 524 existing rows correctly stay unattributed
-- (nobody recorded who logged them) rather than guessing.

alter table public.interactions
  add column if not exists author_user_id uuid references auth.users(id) on delete set null;
