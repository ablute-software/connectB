-- Prompt 313 — the engine reads what's actually IN a Vault document, not
-- just its filename/folder. Confirmed real gap: renaming a signed WomenTechEU
-- grant agreement to be explicit about its contents changed nothing, because
-- readKnowledgeSources() (company-knowledge-db.ts) never reads document
-- CONTENT at all — only id/name/folder metadata. This table is where a
-- one-time, cached extraction of a document's content lives.
--
-- One row per (document, content version): sha256 is the cache key (already
-- computed in the upload-security flow — src/lib/upload-security.ts), so
-- re-uploading identical bytes, or re-running the backfill, never re-pays
-- the Anthropic call. status='failed' rows still fill `extracted` with
-- {error: message} so a future attempt can tell "never tried" from "tried
-- and broke" — and are never treated as a "same sha256, skip" cache hit
-- (only status='completed' rows are).
--
-- Founder-only data, by construction: read only by is_org_member() below,
-- and every reader of this table in application code
-- (document-extraction-linking.ts, the Blueprint/Review routes) is itself
-- founder-only. No investor-facing route ever touches document_extractions
-- or the document_refs column this migration also adds to company_claims —
-- see the root privacy rule in CLAUDE.md.
create table if not exists document_extractions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  sha256 text not null,
  -- Closed list, no free-form summary — see document-extraction.ts's
  -- DocumentExtractionData for the exact shape this jsonb holds.
  extracted jsonb not null default '{}'::jsonb,
  model text not null,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  created_at timestamptz not null default now()
);

create unique index if not exists document_extractions_document_sha_idx on document_extractions(document_id, sha256);
create index if not exists document_extractions_org_idx on document_extractions(org_id);

alter table document_extractions enable row level security;

-- Reads for org members; writes only via service-role (which bypasses RLS
-- entirely) — no insert/update/delete policy exists for authenticated/anon,
-- so those roles simply cannot write regardless of table-level grants. Same
-- posture as every other admin-populated table in this codebase.
create policy document_extractions_org_read on document_extractions
  for select using (is_org_member(org_id));

-- Prompt 313 §B — where an accepted/proposed claim's evidence actually
-- lives: a mechanically-matched Vault document + page (company-claims.ts's
-- findDocumentLinkCandidate), never AI-decided and never fed back into
-- evidence_class/specificity — see that function's own header and ruleG4's
-- comment in company-gaps.ts for why. Additive-only, defaults to an empty
-- array so every existing row reads as "no linked document" rather than null.
alter table company_claims add column if not exists document_refs jsonb not null default '[]'::jsonb;

-- Prompt 313 §B, hardened after adversarial review: a founder can upload
-- several PDFs within moments of each other, each firing its own
-- fire-and-forget extraction request (store-supabase.tsx) — two of those
-- requests can genuinely run concurrently and both match the SAME claim
-- against two DIFFERENT documents. A plain "read document_refs in app code,
-- append, write back" has a lost-update race there: both reads see the
-- claim's refs before either write, so whichever UPDATE commits last
-- silently overwrites the other's ref with no error. This function makes
-- the append atomic — the existence check and the write happen in the
-- SAME statement, so Postgres's own row lock (not application code) is what
-- serializes two concurrent calls: the second one to acquire the lock
-- re-evaluates the WHERE clause against the just-committed row, which
-- already contains the first call's ref, so it correctly appends its own
-- ref on top rather than clobbering it.
create or replace function public.link_claim_document_ref(p_claim_id uuid, p_ref jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.company_claims
  set document_refs = document_refs || jsonb_build_array(p_ref)
  where id = p_claim_id
    and not exists (
      select 1 from jsonb_array_elements(document_refs) elem
      where elem->>'documentId' = p_ref->>'documentId'
    );
end;
$$;
revoke all on function public.link_claim_document_ref(uuid, jsonb) from public, anon, authenticated;
