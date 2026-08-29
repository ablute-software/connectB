-- Prompt 445 §E — market_research_items gains hypothesis_id (a run is
-- always per-hypothesis now, never per whole org) and fact_status
-- (computed at write time, see computeFactStatus in
-- market-research-structured.ts — never a later pass).
--
-- hypothesis_id is nullable on purpose: pre-445 items (no hypothesis yet)
-- keep existing in the table, they just stop appearing in any read from
-- this phase on (reads now always filter by hypothesis_id). No backfill,
-- no delete — "if it exists it's authentic".
alter table market_research_items add column if not exists hypothesis_id uuid references org_market_hypotheses(id) on delete cascade;
alter table market_research_items add column if not exists fact_status text check (fact_status in ('VALIDATED_FACT', 'PARTIAL_FACT', 'CONFLICTING_FACT', 'INSUFFICIENT_FACT'));

create index if not exists market_research_items_hypothesis_idx on market_research_items(hypothesis_id, status) where hypothesis_id is not null;

comment on column market_research_items.hypothesis_id is
  'Prompt 445 §A — a research run is always scoped to one hypothesis. Null on pre-445 rows only; every row written from this phase on has one.';
comment on column market_research_items.fact_status is
  'Prompt 445 §D — computed by computeFactStatus() at the moment this row is written (structured + source presence, cross-source agreement within the same run), never derived later from free text.';
