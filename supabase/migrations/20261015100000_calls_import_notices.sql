-- Prompt 909, Adenda 2b (15/10/2026) — the person who started an import is told, inside the platform, when the reading ends.
--
-- Reading the documents runs in the background (Adenda 2), so the person is free to leave the screen. When the run becomes "proposed" or "failed" a notice
-- is created for them in call_notices — the same in-app notice table the applicant side already uses (shown until seen, one per event and person) — with
-- two new kinds. Additive: the old code never writes them, and the applicant's notices route only ever reads its own three kinds.
-- APPLIED 15/10/2026 to wkjcaoqdvhykrfacsylr, after a dry run (everything in one do-block ending in an exception, nothing persisted).

alter table public.call_notices drop constraint if exists call_notices_kind_check;
alter table public.call_notices
  add constraint call_notices_kind_check check (kind in ('submission_received', 'draft_reminder', 'deadline_extended', 'import_ready', 'import_failed'));
