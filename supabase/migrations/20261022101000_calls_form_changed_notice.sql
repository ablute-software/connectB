-- Prompt 917 (Adenda 2, B4, 22/10/2026) — an applicant is told when a question of their draft changed under them: "Convert to Table" turns a repeatable group into a table in a call that is already
-- open, and a draft answer that cannot be carried over to the new shape must not just vanish — the person is told, in the app and by email, which question changed.
-- Additive: call_notices.kind also accepts 'form_changed'. APPLIED 22/10/2026 to wkjcaoqdvhykrfacsylr after a dry run (a transaction that was rolled back).
alter table public.call_notices drop constraint if exists call_notices_kind_check;
alter table public.call_notices add constraint call_notices_kind_check
  check (kind in ('submission_received', 'draft_reminder', 'deadline_extended', 'import_ready', 'import_failed', 'call_cancelled', 'form_changed'));
