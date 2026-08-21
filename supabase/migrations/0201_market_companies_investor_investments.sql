-- Prompt 292 §Fase 1 (Pedidos 1+2) — "identificar investidores de
-- concorrentes, com biblioteca partilhada entre startups". Two new
-- PLATFORM-level tables (no org_id, same shape as catalog_entities) —
-- these are public market facts about third parties (funding rounds,
-- investors, valuations), never a founder's own private data, so the
-- CLAUDE.md "startup-performance privacy" root rule does not apply here
-- (that rule protects data DERIVED about the founder's own platform
-- activity — passes, outreach, pipeline stats — not public facts about
-- OTHER companies the platform researches). Explicitly meant to be
-- shared across every startup on the platform, not duplicated per org —
-- that's the whole point of the "biblioteca partilhada" the prompt asks
-- for.
--
-- market_companies — a company only enters this library once, regardless
-- of how many startups have it as a declared competitor (saves the
-- repeated research Nuno explicitly asked to avoid). No org_id, no
-- verification_status: Fase 1 doesn't need a review workflow for this,
-- just the same "never invent a value" discipline already used
-- everywhere else in the catalog — an admin enters what's actually
-- sourced, leaves the rest null.
create table public.market_companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  domain text,
  sectors text[] not null default '{}',
  description text,

  last_known_valuation_eur bigint,
  last_round_type text,
  last_round_date date,
  last_round_amount_eur bigint,

  -- Provenance — same DISCIPLINE as catalog_entity_enrichment_sources
  -- (fonte, data, qualidade), kept as plain inline columns rather than a
  -- separate multi-source table for this Fase 1 MVP: a dedicated
  -- provenance table only earns its complexity once a single company
  -- genuinely needs multiple independently-sourced facts, which Fase 1
  -- doesn't yet require. Revisit if/when that need shows up.
  source_url text,
  source_date date,
  source_quality text,

  -- Same zz-test- convention as orgs/catalog_entities (CLAUDE.md) — this
  -- table WILL accumulate verification fixtures during future prompts.
  is_test boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Non-unique on purpose: Pedido 4's worker (Fase 2) is what enforces
-- "look up before creating" in code ("lista fechada, o código valida",
-- same discipline the enrichment-worker already uses) — a hard unique
-- index here would also incorrectly forbid two real, differently-run
-- companies that happen to share an exact name.
create index market_companies_name_idx on public.market_companies (lower(name));
create index market_companies_domain_idx on public.market_companies (lower(domain)) where domain is not null;

-- investor_investments — links a catalog investor (fund or, optionally,
-- a specific person at that fund) to a company in the library above.
-- Every field the prompt asked for, verbatim: amount, when, round type,
-- stake at the time, whether still held, exit date/amount, current
-- stake, source, confidence. Nothing defaulted to a guessed value —
-- still_held/stake_pct_current stay null when genuinely unknown, never
-- assumed true/0 just to fill the column.
create table public.investor_investments (
  id uuid primary key default uuid_generate_v4(),
  investor_entity_id uuid not null references public.catalog_entities(id) on delete cascade,
  investor_person_id uuid references public.catalog_people(id) on delete set null,
  company_id uuid not null references public.market_companies(id) on delete cascade,

  amount_eur bigint,
  invested_at date,
  round_type text,
  stake_pct_at_investment numeric(5, 2),

  still_held boolean,
  sold_at date,
  sold_amount_eur bigint,
  -- Nullable independently of still_held — "nulo se still_held=false e
  -- não soubermos o residual" is a fact about OUR knowledge, not a
  -- constraint the schema should enforce (a still_held=false row with a
  -- non-null stake_pct_current is a legitimate "sold down but kept a
  -- sliver" case).
  stake_pct_current numeric(5, 2),

  source text,
  -- Reuses email_confidence verbatim (high/medium/low) — same vocabulary
  -- the prompt explicitly asked for, not a new enum.
  confidence email_confidence,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index investor_investments_investor_idx on public.investor_investments (investor_entity_id);
create index investor_investments_company_idx on public.investor_investments (company_id);

alter table public.market_companies enable row level security;
alter table public.investor_investments enable row level security;

-- Read: open to any authenticated founder, same openness as
-- catalog_entities' own catalog_read policy (using verification_status
-- there; these tables have no such gate — the admin-only write below is
-- the only quality gate Fase 1 needs) — this is explicitly a SHARED
-- library, not scoped to is_org_member of anything.
create policy market_companies_read on public.market_companies
  for select using (true);
create policy market_companies_admin_write on public.market_companies
  for all using (is_platform_admin()) with check (is_platform_admin());

create policy investor_investments_read on public.investor_investments
  for select using (true);
create policy investor_investments_admin_write on public.investor_investments
  for all using (is_platform_admin()) with check (is_platform_admin());
