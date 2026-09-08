-- Fix within Prompt 616 §B.4, found by RUNNING it rather than by reading it.
--
-- catalog_people.linkedin_url_normalized is a STORED GENERATED column
-- (catalog_normalize_linkedin_url(linkedin_url)), and Postgres computes those
-- AFTER a BEFORE-INSERT trigger runs. So `new.linkedin_url_normalized` is NULL
-- inside the trigger, and the LinkedIn branch — the main key, the one that
-- covers 1 883 of the 3 472 rows — could never match on an insert. Only the
-- name fallback would ever have fired.
--
-- The trigger normalises new.linkedin_url itself, through the very same
-- function the generated column uses, so the two cannot disagree.
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

  raise exception 'catalog person is suppressed and cannot be re-created (suppression %)', v_sup.id
    using errcode = 'restrict_violation';
end;
$function$;
