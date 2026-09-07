-- Prompt 599 §4 (Prompt 597's condition — "temos que a fazer"). A consensus
-- that reaches 3 real startups but is BLOCKED because a developer or the
-- person already verified that field used to `return new` silently: nobody
-- could tell that three startups disagree with the admin's value. The
-- blocked branch now writes one admin_audit_log row — admin_user_id null,
-- the "the system did this" convention catalog_person_consensus_auto_verify
-- already uses — carrying the field, the catalog's current value, the
-- proposed value, how many real orgs agree, and which level blocked it.
--
-- One row per distinct (person, field, normalized proposed value): the
-- trigger fires on every contributions insert/update, so without that guard
-- a fourth and fifth agreeing startup would each add a duplicate line.
--
-- Additive and reversible: only the function body changes (the trigger,
-- tables and grants are untouched); re-applying 0328's body restores the
-- silent behaviour. Everything outside the marked block is 0328's text,
-- unchanged.
create or replace function public.catalog_person_check_consensus()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_count int;
  v_norm_value text;
  v_current_level text;
  v_catalog_value jsonb;
  v_admin_only constant text[] := array['linkedin_url', 'email_guess'];
begin
  if new.subject_type <> 'catalog_person' or new.status <> 'submitted' then return new; end if;
  if new.field = any(v_admin_only) then return new; end if;

  v_norm_value := public.catalog_person_normalize_value(new.value);
  if coalesce(v_norm_value, '') = '' then return new; end if;

  select count(distinct c.org_id) into v_org_count
  from contributions c
  join orgs o on o.id = c.org_id
  where c.subject_type = 'catalog_person' and c.subject_id = new.subject_id and c.field = new.field
    and c.status in ('submitted', 'verified')
    and public.catalog_person_normalize_value(c.value) = v_norm_value
    and o.is_test = false and o.is_internal = false;

  if v_org_count < 3 then return new; end if;

  select verified_fields ->> new.field into v_current_level
  from catalog_people_research where person_id = new.subject_id;

  if v_current_level in ('verified_by_admin', 'verified_by_person') then
    -- Prompt 599 §4: audit the block instead of swallowing it. The catalog's
    -- current value lives in three places depending on the field, the same
    -- split catalog_person_apply_field writes through.
    if new.field = 'role' then
      select to_jsonb(a.title) into v_catalog_value
      from catalog_person_affiliations a
      where a.person_id = new.subject_id and a.is_primary
      limit 1;
    elsif new.field = 'based_in' then
      select to_jsonb(p.based_in) into v_catalog_value
      from catalog_people p where p.id = new.subject_id;
    else
      select to_jsonb(r.*) -> new.field into v_catalog_value
      from catalog_people_research r where r.person_id = new.subject_id;
    end if;

    if not exists (
      select 1 from admin_audit_log l
      where l.action = 'catalog_person_consensus_blocked'
        and l.subject_id = new.subject_id
        and l.detail ->> 'field' = new.field
        and l.detail ->> 'proposed_norm' = v_norm_value
    ) then
      insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
      values (
        null, 'catalog_person_consensus_blocked', 'catalog_person', new.subject_id,
        jsonb_build_object(
          'field', new.field,
          'catalog_value', v_catalog_value,
          'proposed_value', new.value,
          'proposed_norm', v_norm_value,
          'org_count', v_org_count,
          'blocking_level', v_current_level
        )
      );
    end if;
    return new;
  end if;

  update contributions
    set status = 'verified', reviewed_at = now(),
      reviewer_notes = trim(both ' · ' from coalesce(reviewer_notes || ' · ', '')
        || 'Auto-verified: ' || v_org_count || ' startups agree.')
    where subject_type = 'catalog_person' and subject_id = new.subject_id and field = new.field
      and status = 'submitted' and public.catalog_person_normalize_value(value) = v_norm_value;

  perform public.catalog_person_apply_field(new.subject_id, new.field, new.value, 'verified_by_startups');

  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (
    null, 'catalog_person_consensus_auto_verify', 'catalog_person', new.subject_id,
    jsonb_build_object('field', new.field, 'value', new.value, 'org_count', v_org_count)
  );

  return new;
end;
$function$;
