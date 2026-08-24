-- Prompt 355 §B/C — "Sherlock summary" per document. Same cache-key shape
-- as document_extractions (document_id, sha256) — deliberately a SEPARATE
-- table, never added as a column there: document_extractions is
-- founder-only by RLS (0208's own explicit note), while a summary is
-- investor-facing by nature. Keeping them apart means an investor-facing
-- route can never accidentally gain a path into the founder-only
-- extractions table just by needing the summary that came from the same
-- Claude call.
create table if not exists document_summaries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  sha256 text not null,
  summary text not null,
  highlights jsonb not null default '[]'::jsonb,
  model text not null,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  created_at timestamptz not null default now()
);

create unique index if not exists document_summaries_document_sha_idx on document_summaries(document_id, sha256);
create index if not exists document_summaries_org_idx on document_summaries(org_id);

alter table document_summaries enable row level security;

-- Org members can read their own org's summaries (defense-in-depth, same
-- posture as document_extractions) — but the INVESTOR-facing read never
-- goes through RLS at all: investors aren't org_members, so it goes
-- through a service-role route that re-checks document visibility via
-- resolveDocumentAccess, the exact same access resolution /api/portal/access
-- already uses for the documents themselves (never a second, divergent
-- access logic for the summary of the same document).
create policy document_summaries_org_read on document_summaries
  for select using (is_org_member(org_id));
