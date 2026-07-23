-- Data Room V2 (founder feedback, 23 Jul) F5 — NDA handling. Replaces the
-- old self-serve "I accept the NDA terms" click (which never attached a
-- real document) with a real signed file the founder uploads, cross-checked
-- by AI against the investor's name/entity and the org, and kept as an
-- attachment on the investor's own record. access_grants.nda_accepted_at
-- stays the field the portal checks (unchanged meaning: unlocked or not) —
-- it's now set by this upload instead of an investor's own click.
create type nda_match_status as enum ('pending', 'match', 'mismatch', 'uncertain');

create table ndas (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  person_id uuid references people(id) on delete set null,
  entity_id uuid references entities(id) on delete set null,
  grantee_email text,
  storage_path text not null,
  file_name text,
  uploaded_at timestamptz not null default now(),
  uploaded_by text,
  -- "flag, never a block" — a mismatch/uncertain verdict is still stored
  -- and still unlocks the grantee's access; the founder decides from here.
  match_status nda_match_status not null default 'pending',
  match_notes text,
  constraint nda_has_subject check (person_id is not null or entity_id is not null or grantee_email is not null)
);

alter table ndas enable row level security;
create policy ndas_all on ndas for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create index on ndas (org_id, person_id);
create index on ndas (org_id, entity_id);
