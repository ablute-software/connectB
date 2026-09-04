-- Prompt 558 §1/§2 — the repository catches up with a hotfix that only ever
-- existed in production.
--
-- On 03/09 this function, as written in 0300, broke EVERY write to the four
-- catalog tables it is attached to: `record "new" has no field "entity_id"`.
-- The catalog was read-only in practice for hours — investor self-declare,
-- back-office inserts, reviewSubmission, the enrichment worker's writes.
--
-- The cause is a PL/pgSQL rule worth stating in full, because the broken
-- version reads as obviously correct:
--
--     v_ids := case tg_table_name
--       when 'catalog_entities'            then array[coalesce(new.id, old.id)]
--       when 'catalog_person_affiliations' then array[coalesce(new.entity_id, ...)]
--       when 'catalog_people_research'     then (select ... new.person_id ...)
--     end;
--
-- That CASE is ONE SQL expression. Field references on the NEW/OLD records
-- are resolved when the expression is PREPARED — for every branch, not only
-- the branch that will run. A trigger on catalog_entities (which has `id`
-- but no `entity_id` and no `person_id`) therefore fails before any branch
-- is chosen. No table has all three fields, so all four triggers failed.
--
-- IF branches are separate statements, each prepared only when reached. That
-- is the standard pattern for a trigger function shared across tables, and
-- it is why this is not a stylistic rewrite of the CASE.
--
-- This was applied directly to production at 19:09 UTC on 03/09 and is in
-- the migration ledger as
-- `20260903190915 hotfix_catalog_readiness_refresh_per_table_branches`, but
-- no file was ever committed. So the ledger said "fixed" while a fresh
-- replay of the repository still built the broken version and reproduced the
-- outage. 0300 is corrected in the same commit, which makes this file a
-- no-op on a clean replay — it is kept, and kept idempotent, for any
-- database that already took 0300's broken body.
create or replace function public.catalog_readiness_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ids uuid[];
begin
  if tg_table_name = 'catalog_entities' then
    v_ids := array[coalesce(new.id, old.id)];
  elsif tg_table_name in ('catalog_person_affiliations', 'catalog_people') then
    v_ids := array[coalesce(new.entity_id, old.entity_id)];
  elsif tg_table_name = 'catalog_people_research' then
    select coalesce(array_agg(distinct pa.entity_id), '{}') into v_ids
      from public.catalog_person_affiliations pa
     where pa.person_id = coalesce(new.person_id, old.person_id);
  else
    v_ids := '{}';
  end if;

  update public.catalog_entities c
     set outreach_readiness = public.catalog_outreach_readiness(c.id)
   where c.id = any(v_ids)
     and c.outreach_readiness is distinct from public.catalog_outreach_readiness(c.id);

  return null;
end;
$function$;
