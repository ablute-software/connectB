-- Prompt 461 §A — reconciliation.ts's readReconcilableDocuments has been
-- selecting a column that doesn't exist (`updated_at`) since the engine
-- shipped (Prompt 358): the query silently fails, extractionByDocId stays
-- empty, and every document gets described to the reconciliation model as
-- "content not yet analyzed" regardless of what was actually extracted.
-- Confirmed directly in production: only 2 reconciliation calls, 7 rows in
-- gap_reconciliations, ever. This column is what the query already assumed
-- existed. `default now()` only stamps future inserts — document-extraction-
-- pipeline.ts's own upsert (§B) refreshes it explicitly on every write, so a
-- re-extraction over an existing row is never mistaken for unchanged content.
alter table document_extractions
  add column updated_at timestamptz not null default now();
