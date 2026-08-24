-- Prompt 360 Part A — "Market data — your sector": three sources converging
-- on one founder-curated canvas.
--
-- org_market_data: the "Added by you" structured facts — one row per org
-- (upserted, never a history table; a founder editing market size overwrites
-- the old number the same way every other Settings field does). segments,
-- competitors and free sources are jsonb arrays: each is a small, variably-
-- shaped list (a competitor row has 5 fields, a source is just a URL+label)
-- that nothing else in the schema needs to join against — same reasoning
-- roadmap_categories/items_v2 already used for "a list with no need for
-- per-item identity elsewhere."
create table if not exists org_market_data (
  org_id uuid primary key references orgs(id) on delete cascade,
  market_size_value_eur numeric,
  market_size_scope text,
  market_size_year int,
  market_size_source text,
  growth_pct numeric,
  segments jsonb not null default '[]'::jsonb,
  competitors jsonb not null default '[]'::jsonb,
  free_sources jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table org_market_data enable row level security;

drop policy if exists org_market_data_org_members on org_market_data;
create policy org_market_data_org_members on org_market_data
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table org_market_data is
  'Prompt 360 Part A — founder-entered structured market facts. One row per org, always current (no history).';

-- market_research_items: Sherlock research proposals — verify-then-promote,
-- same discipline as gap_reconciliations/roadmap_event_suggestions (never
-- auto-applied; a founder accepts or rejects each one). unique(org_id,
-- section, title) makes "a rejected item never comes back looking the same"
-- a DB invariant rather than app-remembered state, same reasoning as those
-- two tables' own unique constraints.
create table if not exists market_research_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  run_signature text not null,
  section text not null check (section in ('definition', 'sizing', 'growth', 'players', 'rounds', 'trends', 'regulatory')),
  title text not null,
  detail text not null,
  source_url text,
  source_accessed_at timestamptz,
  confidence text check (confidence in ('high', 'medium', 'low')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_claim_id uuid references company_claims(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, section, title)
);

create index if not exists market_research_items_org_idx on market_research_items(org_id, status);

alter table market_research_items enable row level security;

drop policy if exists market_research_items_org_members on market_research_items;
create policy market_research_items_org_members on market_research_items
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table market_research_items is
  'Prompt 360 Part A — Sherlock research proposals for the Market data tab, one row per proposed item, verify-then-promote. Every item MUST carry a source_url; nothing without one is ever created.';

-- Prompt 360 Part A — a founder accepting a Sherlock research item becomes a
-- mercado_timing claim with real source attribution. Neither 'fact' (no
-- documented meaning distinct from founder_answer) nor 'vault_doc'
-- (specifically means "a Vault document backs this," which routes through
-- Vault-visibility checks elsewhere — e.g. mini-pitch.ts's
-- filterEligibleClaims — that a web-sourced claim must NOT go through) fit
-- honestly, so this is a new, explicit sourceKind rather than overloading
-- either.
alter table company_claims drop constraint if exists company_claims_source_kind_check;
alter table company_claims add constraint company_claims_source_kind_check
  check (source_kind in ('fact', 'vault_doc', 'roadmap', 'profile', 'funding_round', 'founder_answer', 'web_research'));
