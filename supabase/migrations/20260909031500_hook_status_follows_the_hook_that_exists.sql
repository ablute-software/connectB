-- Prompt 627 §6.2 — five people have a hook and are filed as un-researched.
--
-- Measured 2026-09-09: 13 rows in catalog_people_research have a non-empty
-- `hook`; only 8 people carry hook_status = 'researched'. The other five are
-- 'to_research', so every query that filters by status treats work that is
-- already done and already paid for as work still to do — and the next
-- Camada 2 run would pay for it a second time.
--
-- THE ONE-OFF UPDATE IS THE SMALLER HALF OF THIS FILE. The invariant "a
-- person with a hook is researched" was being maintained by two separate
-- statements in the worker (upsert the research row, then update the person),
-- with nothing holding them together: any failure between them, and any older
-- code path that wrote only the first, leaves exactly this drift. Two
-- statements are not an invariant, they are a habit. So the trigger below
-- makes the database keep it.
--
-- It also closes a live downgrade that nobody would have noticed. The worker
-- writes `hook` only when it has a READ SOURCE (Nuno's rule — an invented
-- hook burns the contact), but it writes hook_status unconditionally. So
-- re-running Camada 2 on someone who already HAS a good hook, where the new
-- run happens to find nothing, sets hook_status = 'none_found' while leaving
-- the perfectly valid hook in place. The trigger makes the status follow the
-- data rather than the last run's luck.

update public.catalog_people p
   set hook_status = 'researched'
  from public.catalog_people_research r
 where r.person_id = p.id
   and coalesce(btrim(r.hook), '') <> ''
   and p.hook_status <> 'researched';

create or replace function public.catalog_person_hook_status_follows_hook()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  -- Only ever promotes. Demotion is a decision (the hook was withdrawn, the
  -- source turned out to be unreadable) and belongs to the code that made it,
  -- not to a trigger reacting to a row it did not write.
  if coalesce(btrim(new.hook), '') <> '' then
    update public.catalog_people
       set hook_status = 'researched'
     where id = new.person_id
       and hook_status is distinct from 'researched';
  end if;
  return null;
end $fn$;

drop trigger if exists catalog_person_hook_status_follows_hook on public.catalog_people_research;
create trigger catalog_person_hook_status_follows_hook
  after insert or update of hook on public.catalog_people_research
  for each row execute function public.catalog_person_hook_status_follows_hook();

comment on function public.catalog_person_hook_status_follows_hook() is
  'Prompt 627 §6.2 — a person with a non-empty research hook is researched, whatever the last enrichment run said. Promotes only; never demotes.';
