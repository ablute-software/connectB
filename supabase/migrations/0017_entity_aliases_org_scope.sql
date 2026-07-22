-- IRM_SPEC §9b history import — entity_aliases (0014) was scoped only to
-- catalog_entities (the shared public catalog). The real history import
-- needs the SAME alias mechanism for org-private `entities` too (e.g.
-- "MSM VC / Mustard Seed MAZE" == "MAZE", "Busy Angels" == "Bynd" — real
-- former/alternate names found in the founder's own historical records,
-- not yet promoted to any shared catalog). Extends the table to point at
-- either target, exactly one of the two.

alter table entity_aliases alter column catalog_id drop not null;
alter table entity_aliases add column if not exists entity_id uuid references entities(id) on delete cascade;
alter table entity_aliases add constraint entity_aliases_one_target check (
  (catalog_id is not null and entity_id is null) or (catalog_id is null and entity_id is not null)
);
create index on entity_aliases (entity_id);
-- catalog_id can now be null, and Postgres treats null != null in a unique
-- constraint (the existing `unique (catalog_id, alias)` wouldn't stop
-- duplicate org-scoped aliases) — a matching constraint for the entity_id side.
alter table entity_aliases add constraint entity_aliases_entity_alias_unique unique (entity_id, alias);

-- Org members manage aliases for their OWN org's entities; the existing
-- entity_aliases_admin policy (is_platform_admin) still covers catalog-
-- scoped rows. entity_aliases_read (using true) already covers select.
create policy entity_aliases_org_write on entity_aliases for all
  using (entity_id is not null and exists (select 1 from entities e where e.id = entity_aliases.entity_id and is_org_member(e.org_id)))
  with check (entity_id is not null and exists (select 1 from entities e where e.id = entity_aliases.entity_id and is_org_member(e.org_id)));
