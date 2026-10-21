-- Developer Viewer (20/10/2026, Nuno): "Cap table shows no data in ablute_ — I know it has data and it was not displayed. The same with Photos & media and
-- MatchDeal." In a Developer Viewer session the signed-in person is a developer (a platform admin) who is NOT a member of the org on screen, and the
-- founder workspace reads many tables DIRECTLY from the browser (store-supabase.tsx's loadAll, and a few cards), so Row Level Security decides what comes
-- back. A table whose only policy is `is_org_member(org_id)` answers ZERO rows to the developer — no error, just a blank card.
--
-- Migration 0051 gave developers a read-only policy (`<table>_ablute_qa_read … for select using (is_ablute_developer())`) for the tables that existed then,
-- and 0119 closed eight more by querying production. This closes the thirteen that were added after them and that the browser reads — found twice, by two
-- independent routes that agree: by querying pg_policy on production for every table the store loads (20/10/2026), and by walking the source for every
-- `.from('<table>')` in a client file (src/lib/developer-viewer-rls.test.ts, which now fails when a table is added without this policy).
--
--   cap_table_entries · funding_rounds (Previous funding) · roadmap_events · roadmap_categories · company_roadmap_milestones (Roadmap) ·
--   org_axis_classifications · rejection_codes · interaction_documents · interaction_edits · entity_reopen_snapshots · sherlock_next_snoozes ·
--   review_clarifications (Facts & Clarifications) · investor_deal_signals (the ticket-signal card)
--
-- READ-ONLY, ADDITIVE, and nothing existing is touched: one brand-new `for select` policy per table, exactly the 0051 shape (policies of a table are OR-ed, so
-- a member's access is unchanged and a developer gains only SELECT). Nothing here lets a developer insert, update or delete a founder's row; the Developer
-- Viewer's own write block (viewer-write-gate, assertNotViewer, the frame) stays what stops a click.
--
-- WHAT IT EXPOSES, said plainly: a platform admin can now read any org's cap table, previous funding, roadmap and the few small tables above through the
-- browser — the same reach they already have over its documents, interactions, people and team (0051). The admins ARE the support team (platform_admins);
-- the Viewer exists so they can see what a founder sees. No credentials or tokens live in any of these tables (the ones 0119 deliberately kept out —
-- email_connections, matchdeal_pairing_tokens, vault_data_room_pins — are not touched).
--
-- Applied to production only after Nuno's explicit "sim" (DECISIONS.md, 20/10/2026). Rehearsed beforehand against production data in one DO statement that
-- always ends in RAISE EXCEPTION (scripts/verify-developer-viewer-reads.sql, which embeds THIS file verbatim); rollback in scripts/rollback-developer-viewer-reads.sql.
drop policy if exists cap_table_entries_ablute_qa_read on public.cap_table_entries;
create policy cap_table_entries_ablute_qa_read on public.cap_table_entries for select using (public.is_ablute_developer());

drop policy if exists funding_rounds_ablute_qa_read on public.funding_rounds;
create policy funding_rounds_ablute_qa_read on public.funding_rounds for select using (public.is_ablute_developer());

drop policy if exists roadmap_events_ablute_qa_read on public.roadmap_events;
create policy roadmap_events_ablute_qa_read on public.roadmap_events for select using (public.is_ablute_developer());

drop policy if exists roadmap_categories_ablute_qa_read on public.roadmap_categories;
create policy roadmap_categories_ablute_qa_read on public.roadmap_categories for select using (public.is_ablute_developer());

drop policy if exists company_roadmap_milestones_ablute_qa_read on public.company_roadmap_milestones;
create policy company_roadmap_milestones_ablute_qa_read on public.company_roadmap_milestones for select using (public.is_ablute_developer());

drop policy if exists org_axis_classifications_ablute_qa_read on public.org_axis_classifications;
create policy org_axis_classifications_ablute_qa_read on public.org_axis_classifications for select using (public.is_ablute_developer());

drop policy if exists rejection_codes_ablute_qa_read on public.rejection_codes;
create policy rejection_codes_ablute_qa_read on public.rejection_codes for select using (public.is_ablute_developer());

drop policy if exists interaction_documents_ablute_qa_read on public.interaction_documents;
create policy interaction_documents_ablute_qa_read on public.interaction_documents for select using (public.is_ablute_developer());

drop policy if exists interaction_edits_ablute_qa_read on public.interaction_edits;
create policy interaction_edits_ablute_qa_read on public.interaction_edits for select using (public.is_ablute_developer());

drop policy if exists entity_reopen_snapshots_ablute_qa_read on public.entity_reopen_snapshots;
create policy entity_reopen_snapshots_ablute_qa_read on public.entity_reopen_snapshots for select using (public.is_ablute_developer());

drop policy if exists sherlock_next_snoozes_ablute_qa_read on public.sherlock_next_snoozes;
create policy sherlock_next_snoozes_ablute_qa_read on public.sherlock_next_snoozes for select using (public.is_ablute_developer());

drop policy if exists review_clarifications_ablute_qa_read on public.review_clarifications;
create policy review_clarifications_ablute_qa_read on public.review_clarifications for select using (public.is_ablute_developer());

drop policy if exists investor_deal_signals_ablute_qa_read on public.investor_deal_signals;
create policy investor_deal_signals_ablute_qa_read on public.investor_deal_signals for select using (public.is_ablute_developer());
