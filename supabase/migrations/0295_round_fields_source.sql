-- Prompt 541 §B — provenance for the nine Round fields a Vault document can
-- speak to.
--
-- NUMBERING: 0294 (Prompt 534's round_blueprint_scenarios) is the highest
-- number on this branch; see its own header for why 0291-0293 are reserved
-- or taken on other branches. 0295 is the next genuinely free number.
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
