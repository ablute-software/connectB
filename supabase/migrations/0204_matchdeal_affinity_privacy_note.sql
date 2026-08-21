-- Prompt 297 §4 — documentation-only migration, no schema change.
--
-- matchdeal_exposures and matchdeal_swipes now also back a NEW backoffice
-- analysis (GET /api/backoffice/metrics/matchdeal/affinity): per-viewer
-- decision-time and like-rate correlated against the swiped-on profile's
-- own attributes (sectors, stage, entity type). This is real behavioral
-- profiling of identifiable people, not an anonymous aggregate — it says
-- things like "this specific investor spends longer on healthtech/seed
-- profiles and likes them more often."
--
-- No new table was created for this (Prompt 297 §2's own instruction — the
-- existing exposures/swipes rows are sufficient), so there is no new RLS
-- policy to add either. The enforcement point is instead where it has
-- always been for every /api/backoffice/* route in this codebase:
-- requirePlatformAdmin() at the top of the route handler, reading through
-- the service-role client (which bypasses RLS by role, not by policy — see
-- CLAUDE.md's security_invoker note on why that distinction matters). The
-- existing matchdeal_swipes_own / matchdeal_exposures_own RLS policies
-- already restrict a PARTICIPANT to their own rows; that was true before
-- this prompt and is unrelated to the new admin-only aggregate route, which
-- reads across ALL participants' rows via the service role.
--
-- Same restricted-access decision this codebase already made for
-- catalog_people_research (migration 0146): admin-only read, never exposed
-- to any investor/startup-facing surface. Recorded here, not just in the
-- route's own header comment, per this codebase's habit of putting a
-- privacy/access decision in a migration comment even when there's no new
-- column to hang it on.
comment on table public.matchdeal_exposures is
  'Also backs GET /api/backoffice/metrics/matchdeal/affinity (Prompt 297 §2) — per-viewer behavioral profiling, admin-only via requirePlatformAdmin(), never surfaced on any investor/startup-facing page. See migration 0204.';
comment on table public.matchdeal_swipes is
  'Also backs GET /api/backoffice/metrics/matchdeal/affinity (Prompt 297 §2) — per-viewer behavioral profiling, admin-only via requirePlatformAdmin(), never surfaced on any investor/startup-facing page. See migration 0204.';
