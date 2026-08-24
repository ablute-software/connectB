-- Prompt 370 §C — "Read my documents": a document-sourced counterpart to
-- the existing web research pass, reusing market_research_items rather
-- than a third approval pipeline (explicit ask in the prompt). Distinguish
-- the two by source_kind; document_id+page carry the real provenance a
-- document-sourced item always has (source_url stays null for these —
-- there's no URL, only a Vault document + page).
alter table market_research_items add column if not exists source_kind text not null default 'web'
  check (source_kind in ('web', 'document'));
alter table market_research_items add column if not exists document_id uuid references documents(id) on delete set null;
alter table market_research_items add column if not exists page int;
-- Typed fields for the sections that can auto-fill org_market_data on
-- Accept (sizing/growth/segments/players) instead of becoming a claim —
-- see respond/route.ts. Null for web items and for trends/regulatory
-- document items, which still become a claim like before.
alter table market_research_items add column if not exists structured jsonb;

-- 'segments' is a new section this pass can propose (Added by you already
-- has a segments field with nothing feeding it before this prompt).
alter table market_research_items drop constraint if exists market_research_items_section_check;
alter table market_research_items add constraint market_research_items_section_check
  check (section in ('definition', 'sizing', 'growth', 'players', 'rounds', 'trends', 'regulatory', 'segments'));

create index if not exists market_research_items_document_idx on market_research_items(org_id, document_id) where document_id is not null;

comment on column market_research_items.source_kind is
  'Prompt 370 — ''web'' (Sherlock research, existing) or ''document'' (Read my documents, new): distinguishes which pass produced this proposal.';
comment on column market_research_items.structured is
  'Prompt 370 — typed fields for sizing/growth/segments/players document items, so Accept can auto-fill org_market_data instead of re-parsing title/detail text.';
