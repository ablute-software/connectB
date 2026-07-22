-- IRM_SPEC §9 — interaction history import. Generic version: the extraction
-- shape lives in a jsonb column (not rigid per-item tables) precisely
-- because the field mapping is explicitly not finalized yet ("afinado
-- quando chegarem os ficheiros exemplo") — easy to reshape later without
-- another migration. Reuses the existing 'data-room' Storage bucket
-- (org-scoped RLS already in place) under a new <org_id>/imports/ prefix.

create type import_status as enum ('uploaded', 'extracting', 'staged', 'committed', 'failed');

create table import_batches (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  file_name text not null,
  storage_path text not null,
  status import_status not null default 'uploaded',
  extraction jsonb,
  error text,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

alter table import_batches enable row level security;
create policy import_batches_all on import_batches for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));
create index on import_batches (org_id, status);

-- Provenance for imported interactions (§9d/§9f): which batch/file an
-- interaction came from, distinct from a manually-logged one.
alter table interactions add column if not exists source text not null default 'manual';
alter table interactions add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
create index on interactions (org_id, source);
