-- Prompt 117 Bloco B — History tab. PROPOSE ONLY, DO NOT APPLY without
-- Nuno's explicit go-ahead. The History UI (HistoryPanel.tsx) is gated by
-- the aiReviewHistoryFieldsAvailable capability probe and reads these
-- columns via coalesce(input_text, interaction_draft) so it works correctly
-- whether or not this migration has landed — old rows (and every row until
-- this ships) simply show "original text not recorded".
--
-- ai_reviews.document_id has existed since the original schema (0001) but is
-- never written by any code path — not reused here because a cross-document
-- review or a "sweep against N documents" run doesn't map to a single id;
-- input_meta.document_ids (jsonb) is the multi-document equivalent once the
-- Vault-sourced review modes (Bloco E/F) exist. No backfill: old rows keep
-- input_text null forever, read via coalesce(input_text, interaction_draft).
alter table ai_reviews
  add column input_text text,
  add column title text,
  add column created_by uuid references auth.users(id) on delete set null,
  add column source text,
  add column input_meta jsonb not null default '{}'::jsonb;

create index ai_reviews_org_created_at_idx on ai_reviews (org_id, created_at desc);
