-- Prompt 123 Block A — Developer Viewer. PROPOSED, NOT APPLIED.
--
-- Inventory method: queried production directly (not guessed from
-- migration files) for every table with an org_id column, then checked
-- which already have a developer-read policy — either the
-- '%_ablute_qa_read%' naming convention from migration 0051, or a broader
-- is_platform_admin() policy that already covers developers too (several
-- tables already had this and are correctly NOT touched here:
-- entity_enrichment_sources, investor_relationship_decisions,
-- promo_redemptions, support_tickets).
--
-- Eight tables are genuine gaps with no sensitive content (counts,
-- timestamps, structured signals — no credentials, no raw contact
-- content beyond what other already-covered tables like `people`/
-- `interactions` already expose to developers). Read-only, same pattern
-- as 0051.
create policy entity_outreach_assessments_ablute_qa_read on public.entity_outreach_assessments for select using (public.is_ablute_developer());
create policy entity_outreach_signals_ablute_qa_read on public.entity_outreach_signals for select using (public.is_ablute_developer());
create policy investor_soft_commits_ablute_qa_read on public.investor_soft_commits for select using (public.is_ablute_developer());
create policy investor_ticket_signals_ablute_qa_read on public.investor_ticket_signals for select using (public.is_ablute_developer());
create policy org_traction_metrics_ablute_qa_read on public.org_traction_metrics for select using (public.is_ablute_developer());
create policy portal_questions_ablute_qa_read on public.portal_questions for select using (public.is_ablute_developer());
create policy round_updates_ablute_qa_read on public.round_updates for select using (public.is_ablute_developer());
create policy matchdeal_pairings_ablute_qa_read on public.matchdeal_pairings for select using (public.is_ablute_developer());

-- Three tables DELIBERATELY EXCLUDED from this migration — flagging rather
-- than blindly extending the same pattern to everything with a gap:
--
--   email_connections — holds the founder's connected-mailbox credentials
--   (OAuth tokens). A developer-read RLS policy here would let any
--   platform developer read a founder's real email account credentials,
--   which is a materially different risk than reading CRM content and
--   needs its own explicit decision, not a side effect of this migration.
--
--   matchdeal_pairing_tokens — the raw/hashed opaque token backing the
--   5-minute QR/device pairing flow (matchdeal-pairing.ts). Exposing it
--   read-only would let a developer hijack an active pairing within its
--   TTL window. Low blast radius (5 min, single-use) but still a
--   deliberate exclusion, not an oversight.
--
--   vault_data_room_pins — the founder's actual Vault PIN value. Developer
--   Viewer should see Vault CONTENTS without needing the PIN at all (the
--   app-layer VaultPinGate should bypass itself for an active viewer
--   session, the same way it already has an is_ablute_developer()-aware
--   path elsewhere) — reading the raw PIN via RLS is the wrong mechanism
--   for that and isn't proposed here.
--
-- Five tables queried but requiring NO policy at all: investor_archive_
-- entries, investor_diligence_checklist, investor_followups,
-- startup_now_summaries, startup_profile_snapshots — RLS is enabled with
-- ZERO policies on all five (default-deny for every role including the
-- founder's own session), meaning they are only ever read through
-- service-role API routes already, never direct client table access.
-- Developer Viewer reaches them through those same routes/pages exactly
-- like a founder does — nothing to add here.
