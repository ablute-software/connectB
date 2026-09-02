-- Prompt 541 §B — provenance for the nine Round fields a Vault document can
-- speak to.
--
-- NUMBERING: 0298. Originally written as 0295, RENUMBERED after merging
-- claude/sherlockdeal-git-access-bek6d7, which showed 0295 already taken by
-- 0295_backfill_lost_catalog_deliveries.sql — and already applied to
-- production. Prompt 537's own entry in DECISIONS.md is the reason this was
-- caught: 0293 (claude/prompt-518-reconciled), 0294 (this branch, Prompt
-- 534), 0295/0296/0297 (the 536/537 branch) are all taken, so 0298 is the
-- first genuinely free number. Reading `main` alone would have missed it —
-- `git ls-remote --heads origin` is the check, per that entry.
--
-- WHY A COLUMN AND NOT A TABLE. The prompt's own instruction ("não construir
-- o mecanismo de proveniência como uma tabela nova separada se uma coluna
-- jsonb em orgs resolver com menos migração"). The data is exactly one small
-- object per org, always read and written together with the org row itself,
-- never queried across orgs, never joined, never independently listed. A
-- table would buy row-level history — which is real, but is not what the
-- precedence rule needs: it needs the CURRENT state of each field ("is there
-- a human decision recorded here?"), not an audit trail.
--
-- WHAT IS IN IT. Keyed by the orgs column name, one entry per field that has
-- ever been saved:
--   {
--     "round_target_eur": {
--       "source": "manual" | "document",
--       "document_id": "…", "document_name": "…", "extracted_at": "…",
--       "at": "2026-09-02T12:00:00.000Z",
--       "dismissed_candidate": "1500000"
--     }, …
--   }
-- `dismissed_candidate` holds the canonical form (src/lib/round-field-
-- precedence.ts's roundValueKey) of a document value the founder turned down
-- by keeping their own, so the same conflict is not re-raised on every visit.
--
-- NO CHECK CONSTRAINT ON THE SHAPE, deliberately. The reader
-- (round-field-precedence.ts) already treats every entry as untrusted and
-- falls back to "no human decision recorded" for anything it does not
-- recognise — which is the SAFE direction only for reads. The protective
-- direction is enforced where it matters, in nextRoundFieldsSource: a field
-- saved without an explicit document attribution is recorded as `manual`.
-- A jsonb CHECK here would add a way for a save to fail outright without
-- making any wrong value less wrong.
--
-- DEFAULT '{}' RATHER THAN NULL so that every existing org reads as "no
-- provenance recorded for any field" without a backfill, which is exactly
-- the truth: nothing before this migration knew where a Round value came
-- from. The practical effect on an org that already filled the Round tab by
-- hand is that its fields are NOT yet protected as `manual` — they become so
-- the first time each is saved again. That is the honest state (we genuinely
-- do not know), and it fails toward "offer a suggestion", never toward
-- "overwrite a decision", because a suggestion still needs a click.

alter table public.orgs
  add column if not exists round_fields_source jsonb not null default '{}'::jsonb;

comment on column public.orgs.round_fields_source is
  'Prompt 541 — per-field provenance for the Round tab: which values the founder typed and which came from a Vault document extraction. Read by src/lib/round-field-precedence.ts to decide whether a new extraction may be offered, must raise a conflict, or should stay quiet.';
