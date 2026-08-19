-- Prompt 273 §3 — "Blocked — not a fit" is a near-terminal, reversible
-- action (HardFilterBanner's "Blocked" button on an open hard_filter):
-- unlike resolveHardFilter('resolved_ok'), which just clears the banner
-- and moves on, this decision also pulls the entity out of both the
-- Frozen and Stand by pipeline views into its own "Blocked" view, and the
-- reason stays permanently visible in the dossier (a fixed neutral block,
-- never disappearing) instead of the red warning banner. That permanence
-- needs a real who/when to be auditable, not just a status flip.
--
-- edited_by is nullable + on delete set null (matches interaction_edits.
-- edited_by, migration 0185): in demo mode there is no auth.users row at
-- all, so the app writes the literal string 'demo' there client-side only
-- — demo mode has no real Postgres connection to violate this column's
-- FK. Real (Supabase-backed) writes always carry the actual resolver's
-- auth.users id. Both columns are cleared back to null whenever
-- hard_filter_status moves away from 'resolved_blocked' (resolved_ok, or
-- Unblock back to 'open') — a stale who/when for a status that no longer
-- applies would be worse than no audit trail at all.
alter table entities
  add column hard_filter_resolved_at timestamptz,
  add column hard_filter_resolved_by uuid references auth.users(id) on delete set null;
