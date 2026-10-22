-- Prompt 917 (Adenda 2, B, 22/10/2026) — the new kind of question: Table (a grid with headers: the criteria down the first column, the things compared along the first row; the applicant fills the cells
-- and may add columns or rows when the entity allows it).
--
-- What changes (additive; the old code never writes the new value, so it keeps working until the deploy; existing calls and applications are untouched):
--   · call_form_fields.kind also accepts 'table';
--   · everything else a Table needs lives where it already can: its configuration (headers, cell types, what the applicant may add, what is required) in call_form_fields.validations (jsonb),
--     and an answer in call_applications.draft_answers / call_application_submissions.answers (jsonb), by stable row and column ids. The form snapshot of a submission carries the configuration it
--     was submitted with, so changing a table later never changes a submitted application.
-- APPLIED 22/10/2026 to wkjcaoqdvhykrfacsylr, after a dry run (inside a transaction that was rolled back).

alter table public.call_form_fields drop constraint if exists call_form_fields_kind_check;
alter table public.call_form_fields
  add constraint call_form_fields_kind_check check (kind in (
    'short_text', 'long_text', 'number', 'date', 'yes_no', 'single_choice', 'multiple_choice', 'file', 'url', 'email', 'group', 'table'));
