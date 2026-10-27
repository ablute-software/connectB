-- Prompt 918 (Adenda 3, 22/10/2026) — the applicants who were told that a call was cancelled (deleted) are told when it is restored: "«Entity» restored the call «Title». Your application is available again."
-- Additive: call_notices.kind also accepts 'call_restored'. APPLIED 22/10/2026 to wkjcaoqdvhykrfacsylr after a dry run (a transaction that was rolled back).
alter table public.call_notices drop constraint if exists call_notices_kind_check;
alter table public.call_notices add constraint call_notices_kind_check
  check (kind in ('submission_received', 'draft_reminder', 'deadline_extended', 'import_ready', 'import_failed', 'call_cancelled', 'form_changed', 'call_restored'));
