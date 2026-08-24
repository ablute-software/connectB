-- Prompt 358 Phase 2 — covering indexes for 0235's two foreign keys
-- (Supabase advisor 0001_unindexed_foreign_keys, INFO level).
create index if not exists gap_questions_claim_id_idx on gap_questions(claim_id);
create index if not exists gap_reconciliations_matched_document_id_idx on gap_reconciliations(matched_document_id);
