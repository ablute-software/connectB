-- Prompt 906 §B — a round update can now be edited, so it has to say WHEN.
--
-- NOT YET APPLIED to production: waiting for Nuno's "sim". REHEARSED on 13/10/2026 against production inside a DO
-- block that always ends in RAISE EXCEPTION (so nothing, DDL included, can persist): the column did not exist; the 2
-- real rows keep updated_at NULL; an UPDATE that changes nothing does not stamp; changing the body stamps (after
-- created_at); changing only the title stamps; a new row is born NULL; exactly one trigger; the function is SECURITY
-- INVOKER with search_path = ''; RLS is on and both policies are intact. Afterwards: column, trigger and function
-- absent, the 2 real rows untouched, no rehearsal row left. The code that reads the column does not need it to be there
-- (src/app/api/portal/updates and /api/org/updates read `*` and pass `updated_at` along when it exists), so the
-- order of "apply" and "deploy" does not matter; applying first is just tidier.
--
-- What: one nullable column and one trigger on public.round_updates.
--   updated_at  NULL until the title or body is changed; the time of the LAST change after that. The investor
--               feed shows "edited <date>" exactly when it is set. Not backfilled and not defaulted on purpose:
--               the existing rows were never edited (they could not be), and a default of now() would make every
--               future insert look "edited at the moment it was created".
--   trigger     stamps updated_at only when title or body really differ (WHEN old IS DISTINCT FROM new): a PATCH
--               that sends the text back unchanged must not turn a clean update into an "edited" one. It stamps
--               for any writer — the route, the SQL editor, a backfill — which is the point of doing it in the
--               database and not in the route.
--
-- ADDITIVE only. The RLS policy (round_updates_org_members, FOR ALL for org members) is untouched, so an app
-- that does not know about the column keeps working exactly as before.
alter table public.round_updates
  add column if not exists updated_at timestamptz;

comment on column public.round_updates.updated_at is
  'Prompt 906 — when title/body last changed. NULL = never edited. The investor feed shows "edited <date>" only when set.';

create or replace function public.round_updates_stamp_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists round_updates_stamp_updated_at on public.round_updates;
create trigger round_updates_stamp_updated_at
  before update on public.round_updates
  for each row
  when (old.title is distinct from new.title or old.body is distinct from new.body)
  execute function public.round_updates_stamp_updated_at();
