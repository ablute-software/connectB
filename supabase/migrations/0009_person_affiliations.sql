-- IRM_SPEC §1c — people are first-class and multi-affiliation.
-- Additive only: people.entity_id stays as the person's primary/home
-- affiliation (contact order + seniority enforcement in rules.ts stays
-- keyed to it, untouched, per instruction). person_affiliations is a
-- parallel, informational layer for the *other* funds/angel activity a
-- person has — surfaced on their profile and in the consistency-across-
-- contacts check, not part of outreach-discipline enforcement.

create type affiliation_kind as enum
  ('partner','principal','associate','operator','angel','advisor','board_member','other');

create table person_affiliations (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  entity_id uuid references entities(id) on delete cascade, -- null + kind='angel' = independent angel activity
  title text,
  kind affiliation_kind not null default 'other',
  current boolean not null default true,
  started_at date,
  ended_at date,
  created_at timestamptz not null default now()
);

alter table person_affiliations enable row level security;
create policy person_affiliations_all on person_affiliations for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create index on person_affiliations (org_id, person_id);
create index on person_affiliations (org_id, entity_id);
