-- Prompt 654 §1 — interactions has no change column and interaction_edits is
-- empty, so a direct SQL write to interactions was indistinguishable from a
-- never-touched row (exactly the gap that made last night's date question
-- unprovable). Approved by Nuno. The backfill sets updated_at = created_at (a
-- never-edited row must read as "last change = its creation", not "touched
-- today"); the trigger stamps every UPDATE, including direct SQL, which is the
-- point. This does not replace interaction_edits (that keeps field-level
-- before/after) — it is the minimum safety net.
-- Verified 2026-09-11: column present, 0 nulls, all rows updated_at=created_at,
-- and a rolled-back UPDATE moves updated_at.

alter table public.interactions
  add column if not exists updated_at timestamptz;

update public.interactions
   set updated_at = created_at
 where updated_at is null;

alter table public.interactions
  alter column updated_at set default now();

create or replace function public.interactions_touch_updated_at()
returns trigger language plpgsql
set search_path = public, pg_temp as $fn$
begin
  new.updated_at := now();
  return new;
end; $fn$;

drop trigger if exists interactions_touch_updated_at on public.interactions;
create trigger interactions_touch_updated_at
  before update on public.interactions
  for each row execute function public.interactions_touch_updated_at();
