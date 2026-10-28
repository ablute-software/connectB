-- Prompt 922 (I3, 28/10/2026) — an evaluator may write the comment of a criterion before choosing its score (the screen saves by itself, so a comment can arrive first). The score of a row of
-- APPLIED 28/10/2026 to wkjcaoqdvhykrfacsylr (ledger version 20261028110858, name calls_eval_score_nullable) after a dry run (a transaction that was rolled back).
-- call_eval_scores was NOT NULL; it becomes nullable. A relaxation only: no data changes, nothing is dropped. A submission still needs every score (the server checks it), and a row with neither a score nor
-- a comment is deleted by the server.
alter table public.call_eval_scores alter column score drop not null;
