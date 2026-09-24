-- PROPOSTA — NÃO APLICAR sem OK do Nuno.
--
-- Prompt 729 §3.2 — generalizes mini-pitch's own org_mini_pitches.
-- input_snapshot (already in production) to the other AI-generated reports
-- in Readiness & Training. Table/column names confirmed against
-- 0025_review_runs.sql, 0001_init.sql, and 0094_coaching_runs_table.sql
-- before writing this. Only review_runs is actually written to by any
-- route in this pass (/api/review/investability, gated by
-- report-snapshot-capability.ts) — ai_reviews and coaching_runs get the
-- column now so a later prompt can wire them without a second migration,
-- but nothing writes to those two columns yet.
alter table public.review_runs add column if not exists input_snapshot text;
alter table public.ai_reviews add column if not exists input_snapshot text;
alter table public.coaching_runs add column if not exists input_snapshot text;
