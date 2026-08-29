-- Prompt 446 §A — the verdict lives in the same rows as the fact
-- (market_research_items), computed by market-assessment-engine.ts at the
-- same moment fact_status is (research/route.ts's runResearchPass) —
-- never a later pass, never an LLM-decided value.
alter table market_research_items add column if not exists change_class text check (change_class in ('CONFIRMED', 'CHALLENGED', 'DISCOVERED', 'UNRESOLVED'));
alter table market_research_items add column if not exists delta_type text check (delta_type in (
  'VALUE_ABOVE_EVIDENCE', 'VALUE_BELOW_EVIDENCE', 'VALUE_SUPPORTED', 'NEW_BUYER', 'NEW_MARKET', 'NEW_COMPETITOR',
  'NEW_RISK', 'NEW_DRIVER', 'NEW_REGULATORY_CONSTRAINT', 'MISSING_EXPECTED_EVIDENCE', 'SOURCE_CONFLICT', 'ASSUMPTION_UNSUPPORTED'
));
alter table market_research_items add column if not exists comparison_baseline text check (comparison_baseline in (
  'FOUNDER_CLAIM', 'MARKET_THESIS', 'PREVIOUS_RESEARCH_RUN', 'SHERLOCK_EXPECTATION', 'EXTERNAL_BENCHMARK'
));
alter table market_research_items add column if not exists implication_code text;
alter table market_research_items add column if not exists implication_scope text check (implication_scope in ('TAM', 'SAM', 'SOM', 'GROWTH', 'BUYER', 'COMPETITION', 'GTM', 'REGULATORY', 'TIMING'));
alter table market_research_items add column if not exists implication_direction text check (implication_direction in ('EXPANDS_OPTIONS', 'NARROWS_OPTIONS', 'RAISES_RISK', 'LOWERS_RISK', 'REVISES_ESTIMATE'));
-- Deliberately NOT called `confidence` — that column already exists and is
-- the LLM's own self-report about the research itself (high/medium/low "I
-- found this with what confidence"). insight_confidence is a different
-- thing: the CALCULATED confidence in the verdict, derived from
-- fact_status (computeInsightConfidence) — never read from the LLM.
alter table market_research_items add column if not exists insight_confidence text check (insight_confidence in ('high', 'medium', 'low'));
alter table market_research_items add column if not exists promoted_to_insight boolean not null default false;

comment on column market_research_items.change_class is
  'Prompt 446 SS B.4 — computeVerdict() output. Null when evidenceEligibleForInsight() is false (e.g. every trends/regulatory/definition row, which has no structured field and is always INSUFFICIENT_FACT) — never a guessed value.';
comment on column market_research_items.insight_confidence is
  'Prompt 446 SS B.2 — calculated from fact_status (computeInsightConfidence), distinct from the pre-existing `confidence` column (the LLM''s own self-report about the research).';
