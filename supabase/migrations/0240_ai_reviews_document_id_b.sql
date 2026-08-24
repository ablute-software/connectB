-- Prompt 360 Part B — cross-document check moves from "paste two blobs of
-- text" to "pick two real Vault documents." document_id/document_version
-- (0206) already capture the SINGLE-document review's target; this is the
-- second slot cross_document_review needs. Never repurposing the existing
-- pair for document B — a review kind that links to one document (deck
-- review, etc.) and cross_document_review (links to two) both read
-- document_id/document_version the same way; only cross_document_review
-- ever populates document_id_b/document_version_b.
alter table ai_reviews
  add column if not exists document_id_b uuid references documents(id) on delete set null,
  add column if not exists document_version_b text;

comment on column public.ai_reviews.document_id_b is
  'The second Vault document a cross_document_review compared, if the founder picked real Vault files rather than pasting text. Null for every other review kind, and null for a pre-Prompt-360 cross_document_review row (those pasted raw text instead).';
comment on column public.ai_reviews.document_version_b is
  'document_id_b''s version string AT REVIEW TIME. Null whenever document_id_b is null.';

create index if not exists ai_reviews_document_id_b_idx on ai_reviews(document_id_b);
