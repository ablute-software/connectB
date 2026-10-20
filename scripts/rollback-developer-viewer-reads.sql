-- Rollback of 20261020110000_developer_viewer_reads_more_tables.sql. Rehearsed on top of the migration, in the same never-committing transaction, by
-- scripts/verify-developer-viewer-reads.sql, which embeds THIS file verbatim.
--
-- WHAT IT COSTS: the Developer Viewer goes back to showing a blank Cap table, Previous funding, Roadmap, Facts & Clarifications… for an org the developer
-- is not a member of. Nothing else changes: a founder's own access never depended on these policies.
drop policy if exists investor_deal_signals_ablute_qa_read on public.investor_deal_signals;
drop policy if exists review_clarifications_ablute_qa_read on public.review_clarifications;
drop policy if exists sherlock_next_snoozes_ablute_qa_read on public.sherlock_next_snoozes;
drop policy if exists entity_reopen_snapshots_ablute_qa_read on public.entity_reopen_snapshots;
drop policy if exists interaction_edits_ablute_qa_read on public.interaction_edits;
drop policy if exists interaction_documents_ablute_qa_read on public.interaction_documents;
drop policy if exists rejection_codes_ablute_qa_read on public.rejection_codes;
drop policy if exists org_axis_classifications_ablute_qa_read on public.org_axis_classifications;
drop policy if exists company_roadmap_milestones_ablute_qa_read on public.company_roadmap_milestones;
drop policy if exists roadmap_categories_ablute_qa_read on public.roadmap_categories;
drop policy if exists roadmap_events_ablute_qa_read on public.roadmap_events;
drop policy if exists funding_rounds_ablute_qa_read on public.funding_rounds;
drop policy if exists cap_table_entries_ablute_qa_read on public.cap_table_entries;
