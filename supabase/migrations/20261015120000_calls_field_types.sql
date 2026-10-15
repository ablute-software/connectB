-- Prompt 917 (I1, 15/10/2026) — the new kinds of question: link (url), email, and the repeatable group; and files that belong to one entry of a group.
--
-- What changes (additive; the old code never writes the new values, so it keeps working until the deploy; existing calls and applications are untouched):
--   · call_form_fields.kind also accepts 'url', 'email' and 'group';
--   · everything else a new kind needs (the formats and number of files of a File question, the hint of a link, the questions of a group, its minimum and
--     maximum, its table presentation and pre-defined rows) lives in call_form_fields.validations, which is already jsonb — so the configuration of a call
--     that is duplicated, imported from another call, or captured in a submission's form snapshot carries it without a column of its own;
--   · call_application_files.entry_id says which entry of a group a file belongs to (null for a File question of the form): "one file per question" is then
--     "one file per question per entry", and removing an entry can remove exactly its files.
-- Answers live in call_applications.answers / call_application_submissions.answers, which are jsonb: a group's answer is a list of entries, a question that
-- takes several files holds a list. Nothing to migrate: applications already submitted keep their shape.
-- APPLIED 15/10/2026 to wkjcaoqdvhykrfacsylr, after a dry run (everything in one do-block ending in an exception, nothing persisted).

alter table public.call_form_fields drop constraint if exists call_form_fields_kind_check;
alter table public.call_form_fields
  add constraint call_form_fields_kind_check check (kind in (
    'short_text', 'long_text', 'number', 'date', 'yes_no', 'single_choice', 'multiple_choice', 'file', 'url', 'email', 'group'));

alter table public.call_application_files add column if not exists entry_id text;
create index if not exists call_application_files_entry_idx on public.call_application_files (application_id, field_id, entry_id);
