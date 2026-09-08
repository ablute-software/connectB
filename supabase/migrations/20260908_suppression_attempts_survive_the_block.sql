-- Second fix within Prompt 616 §B.4, and again found by running it.
--
-- The previous version RAISED, and the attempt row it wrote in the same
-- statement was rolled back with the exception — so the "e a tentativa fica
-- registada" half of §B.4 recorded exactly nothing. Measured on the fixture:
-- suppressed_row_created 0 (right), attempts_logged 0 (silently wrong). The
-- block worked and its own proof did not exist.
--
-- Postgres has no autonomous transaction, so the only way the log survives is
-- for the block not to be an exception at all. A BEFORE INSERT trigger
-- returning NULL cancels the row without aborting the transaction: the person
-- still does not appear, and the attempt commits.
--
-- Nothing downstream is worse for it. The enrichment worker's insert already
-- reads a missing row as "skip this person, continue the batch" (its own
-- comment says so), which is exactly the behaviour a suppressed person should
-- get; and the NOTICE keeps it visible to a human running SQL by hand, where
-- the exception had been the only signal.
create or replace function public.catalog_people_block_suppressed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_sup public.catalog_person_suppressions%rowtype;
  v_norm text;
begin
  v_norm := public.catalog_normalize_linkedin_url(new.linkedin_url);

  if v_norm is not null then
    select s.* into v_sup from public.catalog_person_suppressions s
    where s.linkedin_url_normalized = v_norm
    limit 1;
  end if;

  if v_sup.id is null then
    select s.* into v_sup from public.catalog_person_suppressions s
    where s.linkedin_url_normalized is null
      and s.name_key = public.catalog_person_name_key(new.full_name)
      and (s.entity_id is null or s.entity_id is not distinct from new.entity_id)
    limit 1;
  end if;

  if v_sup.id is null then
    return new;
  end if;

  insert into public.catalog_person_suppression_attempts (suppression_id, linkedin_url_normalized, full_name, entity_id)
  values (v_sup.id, v_norm, new.full_name, new.entity_id);

  raise notice 'catalog person is suppressed and was not re-created (suppression %)', v_sup.id;
  return null;
end;
$function$;
