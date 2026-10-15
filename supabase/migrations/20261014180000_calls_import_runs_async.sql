-- Prompt 909, Adenda 2 (14/10/2026) — the import from documents stops depending on one open HTTP request.
--
-- Why: reading a 6-page form with 52 questions took the model ~60 s; the route's limit is 60 s, so the answer reached the
-- browser as a non-JSON gateway timeout ("We could not read the documents.") even though the server had finished and the
-- proposal was saved. The work now runs after the response: the route answers at once with a run in state "reading" and the
-- screen polls it until it becomes "proposed" (or "failed", with a sentence a person can act on).
--
-- What changes (additive; the old code never writes the new values, so it keeps working until the deploy):
--   · call_import_runs.status also accepts 'reading' and 'failed';
--   · the proposal of a run that is still reading, or failed, is an empty object ('{}' — the column stays NOT NULL);
--   · why a run failed, how long it took and how big the files were are kept on the run itself, so the back office can see
--     them (the call's history carries the same facts as an event).
-- APPLIED 14/10/2026 to wkjcaoqdvhykrfacsylr, after a dry run (everything in one do-block ending in an exception, nothing persisted).

alter table public.call_import_runs drop constraint if exists call_import_runs_status_check;
alter table public.call_import_runs
  add constraint call_import_runs_status_check check (status in ('reading', 'proposed', 'applied', 'discarded', 'failed'));

alter table public.call_import_runs add column if not exists error_code    text;
alter table public.call_import_runs add column if not exists error_message text;
alter table public.call_import_runs add column if not exists duration_ms   integer;
alter table public.call_import_runs add column if not exists source_bytes  integer;
alter table public.call_import_runs add column if not exists finished_at   timestamptz;

-- The screen asks "is there a run still reading, or one waiting for review?" for one call, newest first.
create index if not exists call_import_runs_call_status_idx on public.call_import_runs (call_id, status, created_at desc);
