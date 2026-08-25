-- Prompt 373 — Market data becomes a layered market model instead of one
-- flat number, competitors become real cards instead of a free-text list,
-- and the investor-bridge (§C) + publish-by-group (§F) close the loop.
--
-- §0.1 (Nuno, 2026-08-25, REVOKES the prior rule): TAM/SAM/SOM-style market
-- sizing is no longer flagged "never investor-facing" by construction. The
-- CLAUDE.md root privacy rule survives untouched — it separates performance
-- DERIVED by the platform about the founder (passes, outreach counts,
-- pipeline stats: observation ABOUT the founder, never theirs to give) from
-- content DECLARED by the founder (their own research, their own written
-- analysis: normal pitch material, theirs to publish or not). Market
-- analysis is squarely the second kind — researched and curated by the
-- founder, same as their pitch deck — so it goes behind a founder-owned
-- publish toggle (§F, orgs.market_groups_visible_to_investors below), never
-- a blanket ban and never auto-published. Do not "fix" this back to a
-- blanket ban without re-reading this paragraph.
--
-- org_market_rings — three rings per org (beachhead/serviceable/category),
-- one row each, not a history table: editing a ring is a correction to the
-- SAME row (same "edit is accept" discipline as company_claims), never a
-- new row. AI can PROPOSE (origin='ai_proposed', status='proposed') from
-- already-extracted knowledge; the founder always has final Accept/Edit/
-- Reject. A ring with no sourced number stays with a definition and no
-- size_value_eur — never a fabricated figure (see proposeMarketRings, which
-- only ever attaches a size that already has a source).
create table org_market_rings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  ring text not null check (ring in ('beachhead', 'serviceable', 'category')),
  label text not null,
  definition text,
  buyer text,
  geography text,
  size_value_eur numeric,
  size_year int,
  size_method text check (size_method in ('bottom_up', 'top_down', 'report')),
  size_source_url text,
  growth_pct numeric,
  growth_period text,
  -- What has to become true to move to the NEXT ring out — the concrete
  -- half of "penetration and expansion" (certification, a channel, a price
  -- point, a sales team...).
  expansion_condition text,
  origin text not null default 'founder' check (origin in ('ai_proposed', 'founder')),
  status text not null default 'accepted' check (status in ('proposed', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, ring)
);
create index org_market_rings_org_idx on org_market_rings (org_id);

alter table org_market_rings enable row level security;
create policy org_market_rings_members on org_market_rings
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- org_competitors — the org's own RELATION to a shared market_companies
-- card (the card itself is platform-shared, per migration 0201's own
-- header; the relation — direct/indirect/adjacent, the founder's note, the
-- one-line positioning axis — is this org's private read of it).
create table org_competitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  market_company_id uuid not null references market_companies(id) on delete cascade,
  relation text not null default 'direct' check (relation in ('direct', 'indirect', 'adjacent')),
  note text,
  -- §B — "the real axis of difference facing this startup, one sentence,
  -- never vague praise." Founder-owned text, not a platform fact, so it
  -- lives here rather than on the shared market_companies row.
  positioning text,
  added_by text not null default 'founder' check (added_by in ('ai', 'founder')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, market_company_id)
);
create index org_competitors_org_idx on org_competitors (org_id);

alter table org_competitors enable row level security;
create policy org_competitors_members on org_competitors
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- market_companies gains the identity/status fields §B's "ficha" needs.
-- Written server-side only (RLS write stays is_platform_admin(), UNCHANGED
-- per §0.2's explicit safeguard #1 — the research route writes via
-- service-role inside a validated route, never by opening the policy to
-- founders).
alter table market_companies add column if not exists company_type text
  check (company_type is null or company_type in ('startup', 'incumbent', 'academic_spinoff', 'adjacent', 'distributor'));
alter table market_companies add column if not exists life_status text
  check (life_status is null or life_status in ('active', 'acquired', 'closed'));
alter table market_companies add column if not exists latest_news text;
alter table market_companies add column if not exists latest_news_date date;
alter table market_companies add column if not exists latest_news_url text;

-- market_company_flags — §0.2 safeguard #3: "a simple path for the founder
-- to flag a wrong fact reaches the backoffice", since there is no upstream
-- gate on this shared-write library. Same shape as entity_fraud_flags
-- (migration 0196) — the correct existing template per that migration's
-- own founder-initiated-report pattern (NOT suspicious_account_flags,
-- which is admin-write-only at every layer and has no founder path at all).
create table market_company_flags (
  id uuid primary key default gen_random_uuid(),
  market_company_id uuid not null references market_companies(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  justification text not null,
  flagged_by uuid not null references auth.users(id),
  flagged_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'actioned')),
  outcome text check (outcome in ('confirmed', 'dismissed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewer_notes text
);
create index market_company_flags_company_idx on market_company_flags (market_company_id);
create index market_company_flags_status_idx on market_company_flags (status);

alter table market_company_flags enable row level security;
create policy market_company_flags_founder_insert_select on market_company_flags
  for select using (is_org_member(org_id));
create policy market_company_flags_founder_insert on market_company_flags
  for insert with check (is_org_member(org_id));
create policy market_company_flags_admin_all on market_company_flags
  for all using (is_platform_admin()) with check (is_platform_admin());

-- §F — publish groups, one column, not six. "Escolhe o mais simples e
-- documenta" (Nuno's own instruction): a jsonb array of the group keys
-- currently published, rather than six new boolean columns + six new
-- capability probes for what is fundamentally one on/off list. Empty by
-- default — CLOSED, per §F.2 ("publishing is always a founder act, never
-- the initial state") — same fail-closed-by-omission discipline as
-- swot_visible_to_investors/round_progress_visible_to_investors
-- (dossier-fetch.ts): the investor projection only ever QUERIES a group's
-- data when its key is present here, never fetches-then-hides.
-- Valid keys (enforced in application code, not a DB constraint — the set
-- is expected to evolve without a migration each time): 'rings',
-- 'competitors', 'rounds', 'trends', 'regulatory', 'definition'.
alter table orgs add column if not exists market_groups_visible_to_investors jsonb not null default '[]'::jsonb;
comment on column orgs.market_groups_visible_to_investors is
  'Founder-chosen list of Market data groups published to investors (rings/competitors/rounds/trends/regulatory/definition). Empty = nothing published. Prompt 373 §F.';
