-- Prompt 355 §A — link each investor doc score to the document VERSION it
-- actually evaluated, so a founder uploading a new version doesn't silently
-- keep an old rating attached to content the investor never rated.
--
-- Confirmed empirically before writing this: document_versions (migration
-- 0029) has ZERO rows in production even though 70 documents exist — no
-- founder has ever used "Nova versão" yet. store-supabase.tsx's own
-- addDocumentVersion() already handles this exact gap client-side: the
-- FIRST time a document gets a new version, it retroactively synthesizes a
-- version-1 row for whatever was already on file (documents.storage_path,
-- documents.created_at) before adding version 2. This migration runs that
-- same synthesis server-side, once, for every existing document — not an
-- invention of history, just representing the real current file as "version
-- 1" the same way the app's own upload flow would the first time it's
-- touched.
insert into document_versions (org_id, document_id, version, storage_path, uploaded_at)
select d.org_id, d.id, 1, d.storage_path, d.created_at
from documents d
where d.storage_path is not null
  and not exists (select 1 from document_versions dv where dv.document_id = d.id);

alter table investor_doc_scores add column if not exists document_version_id uuid references document_versions(id);

-- Retrocompatibilidade — every existing score, with no version of its own
-- yet, associates to the document's CURRENT version (the highest `version`
-- row, which after the insert above always exists for a storage-backed
-- document). Documented per the prompt's own explicit instruction.
update investor_doc_scores s
set document_version_id = (
  select dv.id from document_versions dv where dv.document_id = s.document_id order by dv.version desc limit 1
)
where document_version_id is null;

-- The old plain (investor_member_id, document_id) uniqueness meant ONE
-- score per document regardless of version — exactly the bug this prompt
-- exists to fix. Replaced with two partial unique indexes: a real score
-- is unique per (investor, document, version) once a version is known; an
-- external-link document (no storage_path, so never gets a version row)
-- keeps the old one-score-per-document behavior via the null-version index
-- — NULL isn't distinct-safe as a plain unique-constraint column (Postgres
-- allows unlimited NULLs), so this needs to be its own partial index, not
-- just adding document_version_id to the existing constraint.
alter table investor_doc_scores drop constraint investor_doc_scores_investor_member_id_document_id_key;
create unique index investor_doc_scores_member_doc_version_uidx
  on investor_doc_scores (investor_member_id, document_id, document_version_id) where document_version_id is not null;
create unique index investor_doc_scores_member_doc_null_version_uidx
  on investor_doc_scores (investor_member_id, document_id) where document_version_id is null;
