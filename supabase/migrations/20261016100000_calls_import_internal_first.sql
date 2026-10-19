-- Prompt 917 (I2 and Adenda 1, Part B, 16/10/2026) — the import reads a form with the platform's OWN reader first; the AI only for what that reader could not read.
--
-- What changes (additive; the old code never writes the new columns, so it keeps working until the deploy):
--   · call_import_runs says HOW the proposal was made: mode ('internal' = the platform alone, 'internal+ai' = the platform and the AI for the parts that failed, 'ai' = the AI for
--     everything), what the platform's reader measured (coverage, how many question types came from a clear rule, what it could not read), which parts of the form were sent to the
--     AI, and what else is worth keeping (why, what was merged, what the AI could not complete);
--   · call_import_corrections keeps what the person CHANGED in the review — a kind changed, a question deleted, a label, a required flag, the options — per run, so the platform can
--     learn which rules of the internal reader to improve. Written by the server only (service role); read by the back office.
-- APPLIED 16/10/2026 to wkjcaoqdvhykrfacsylr, after a dry run (everything in one do-block ending in an exception, nothing persisted).

alter table public.call_import_runs add column if not exists mode        text;
alter table public.call_import_runs add column if not exists quality     jsonb;
alter table public.call_import_runs add column if not exists ai_sections jsonb;
alter table public.call_import_runs add column if not exists import_meta jsonb;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'call_import_runs_mode_check') then
    alter table public.call_import_runs add constraint call_import_runs_mode_check check (mode is null or mode in ('internal', 'internal+ai', 'ai'));
  end if;
end $c$;

create table if not exists public.call_import_corrections (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid        not null references public.call_import_runs(id) on delete cascade,
  call_id    uuid        not null references public.calls(id) on delete cascade,
  kind       text        not null check (kind in ('field_deleted', 'kind_changed', 'label_changed', 'required_changed', 'options_changed')),
  -- The number the document gave the question ("2.10.1"), and who made the item the person changed: the platform's own reader or the AI.
  number     text,
  source     text        check (source is null or source in ('internal', 'ai')),
  -- What changed, and only that: {"from": "short_text", "to": "single_choice", "kind": "…"} — never the applicant-facing text of the form beyond the label.
  detail     jsonb       not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
alter table public.call_import_corrections enable row level security;
create index if not exists call_import_corrections_kind_idx on public.call_import_corrections (kind, created_at desc);
create index if not exists call_import_corrections_run_idx  on public.call_import_corrections (run_id);
revoke all on public.call_import_corrections from public, anon, authenticated;
