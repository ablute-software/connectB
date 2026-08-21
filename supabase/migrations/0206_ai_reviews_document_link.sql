-- Prompt 302 §2 — link a document review to the REAL Vault file it's
-- about. ai_reviews.document_id already existed since migration 0001 (never
-- written by the actual review flow, which takes pasted text — confirmed
-- by grep before this prompt) — document_version is new, capturing the
-- CURRENT version string (e.g. 'v3') at the moment the review was
-- submitted, since the document may be versioned again afterward and the
-- review should still say what it was actually reviewing.
--
-- Retroactive linking is not possible (§2's own explicit scope note): a
-- review made before this existed never knew which file it came from.
-- document_id/document_version stay null on every such row, forever — the
-- UI states this plainly rather than guessing.
alter table public.ai_reviews
  add column if not exists document_version text;

comment on column public.ai_reviews.document_id is
  'Which Vault document this review is about, when the founder picked one (Prompt 302 §2). Null for every review made before this existed, and for review kinds with no single target file (message_review, market_data, cross_document_review).';
comment on column public.ai_reviews.document_version is
  'The document''s version string (e.g. v3) AT REVIEW TIME — the document may have a newer version now. Null whenever document_id is null.';
