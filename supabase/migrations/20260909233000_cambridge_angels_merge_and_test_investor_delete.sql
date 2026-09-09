-- Prompt 636 §2.4 — three people the 8 Aug pilot modelled as ENTITIES are
-- moved under the real Cambridge Angels entity, and only then are the
-- artefact rows deleted. Order is the whole point: catalog_people.entity_id
-- is ON DELETE SET NULL and catalog_person_affiliations.entity_id is ON
-- DELETE CASCADE, so deleting first would orphan three people and drop their
-- affiliations — and three of the catalogue's thirteen hooks with them
-- (Weatherup's 120+ i-Teams spinouts, Swann's sales to Apple, Google and
-- Meta, Phillipps' Booking.com).
--
-- Measured before running: a `Cambridge Angels` entity already exists
-- (86e4d35a-…, verified, 0 people); the three artefacts carry 3 people, 3
-- affiliations and 53 enrichment-source rows, and nothing else points at
-- them (no deliveries, no pipeline rows, no consensus).
--
-- `Test investor` is NOT deleted here, contrary to §2.4's "sem cerimónia".
-- The first version of this file tried and the database refused:
-- matchdeal_investor_members.catalog_entity_id still references it (FK, no
-- action). That row is an investor ACCOUNT's link to its catalogue entity —
-- somebody's registration, not catalogue junk — and 636's "0 dependents"
-- counted people, deliveries and pipeline rows, not investor accounts.
-- Deleting the entity means deleting a member row first, which is a decision
-- about an account, not about the catalogue. Reported, left alone.

do $$
declare
  v_target constant uuid := '86e4d35a-1672-4f77-9d03-1e4223db875d';
  v_ids uuid[];
  v_hooks_before int;
  v_hooks_after int;
begin
  if not exists (select 1 from public.catalog_entities where id = v_target and name = 'Cambridge Angels') then
    raise exception 'Cambridge Angels target entity not found';
  end if;
  select array_agg(id) into v_ids
    from public.catalog_entities
   where name ilike '%Cambridge Angels member%' and id <> v_target;
  if coalesce(cardinality(v_ids), 0) <> 3 then
    raise exception 'expected 3 artefact entities, found %', coalesce(cardinality(v_ids), 0);
  end if;

  select count(*) into v_hooks_before
    from public.catalog_people p join public.catalog_people_research r on r.person_id = p.id
   where p.entity_id = any(v_ids) and coalesce(btrim(r.hook), '') <> '';

  -- Move first.
  update public.catalog_people set entity_id = v_target, updated_at = now() where entity_id = any(v_ids);
  update public.catalog_person_affiliations set entity_id = v_target where entity_id = any(v_ids);
  update public.catalog_entity_enrichment_sources set entity_id = v_target where entity_id = any(v_ids);

  select count(*) into v_hooks_after
    from public.catalog_people p join public.catalog_people_research r on r.person_id = p.id
   where p.entity_id = v_target and coalesce(btrim(r.hook), '') <> '';
  if v_hooks_after <> v_hooks_before or v_hooks_after <> 3 then
    raise exception 'hooks did not survive the move: before %, after %', v_hooks_before, v_hooks_after;
  end if;

  insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  select null, 'catalog_entity_merged_into', 'catalog_entity', x, jsonb_build_object('prompt', 636, 'into', v_target, 'reason', 'person modelled as entity by the 2026-08-08 pilot')
    from unnest(v_ids) x;

  -- Then delete.
  delete from public.catalog_entities where id = any(v_ids);
end $$;
