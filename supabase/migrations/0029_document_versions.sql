-- E7 — Google-Drive-style file versioning for the Data Room. The documents row
-- keeps pointing (storage_path) at the CURRENT version, so portal/signed URLs
-- serve current automatically; this table is the immutable history. A "Nova
-- versão" upload appends a row and repoints the document; the previous Storage
-- object is KEPT (never removed — that's the whole point). "Restore" appends
-- another row pointing at an older object, never a deletion.
--
-- Additive, capability-gated (src/lib/document-versions-capability.ts) — the
-- versioning UI stays inert (Replace keeps its legacy behaviour) until applied.
-- Client-written on upload, so the full-access is_org_member policy.
create table document_versions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  version int not null,
  storage_path text not null,
  size bigint,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references auth.users(id) on delete set null
);

alter table document_versions enable row level security;
create policy document_versions_all on document_versions for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create index on document_versions (document_id, version desc);
