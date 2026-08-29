-- Prompt 462 Part B - Fase 1a: a fetched and verified snapshot of a document
-- link (documents.external_url), stored once under
-- link-snapshots/<orgId>/<documentId>.pdf so the extraction pipeline reads
-- it exactly like an uploaded file. unique(document_id): one current
-- snapshot per document, upserted on re-fetch, no history kept.
--
-- The failed row is kept on purpose, not discarded: it is what lets a
-- later phase say honestly "this link never returned a readable file"
-- (the Demonstrator case here — a 200 response whose body is Google
-- Drive's own virus-scan interstitial page, not the file) instead of
-- staying silent about it. Same RLS/policy pattern as
-- roadmap_event_suggestions (migration 0238).
create table if not exists document_link_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  source_url text not null,
  storage_path text,          -- null when status <> 'ok'
  sha256 text,                -- idem
  bytes bigint,
  detected_kind text,
  status text not null check (status in ('ok', 'failed')),
  failure_reason text,        -- a LinkFetchFailure value, or 'not_a_supported_file'
  fetched_at timestamptz not null default now(),
  unique (document_id)
);

alter table document_link_snapshots enable row level security;

drop policy if exists document_link_snapshots_org_members on document_link_snapshots;
create policy document_link_snapshots_org_members on document_link_snapshots
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table document_link_snapshots is
  'Prompt 462 Fase 1a: a fetched and verified snapshot of a document-link external_url, stored under link-snapshots/<orgId>/<documentId>.pdf so the extraction pipeline reads it like any uploaded file. unique(document_id): one current snapshot per document, upserted on re-fetch. A failed row is kept deliberately, so a later phase can report honestly instead of staying silent.';
