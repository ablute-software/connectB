-- Prompt 349 — Watson's three chambers.
--
-- investor_feedback_shares — Chamber 2: an investor's explicit, item-by-item
-- opt-in share of one Watson insight. Identified (the investor's own name),
-- never anonymous — "é uma escolha dele, não anónima". Written only via the
-- investor's own POST after they've seen the exact preview; nothing here is
-- ever auto-populated from Chamber 1's ephemeral (never persisted) output.
create table if not exists investor_feedback_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  investor_catalog_entity_id uuid not null references catalog_entities(id) on delete cascade,
  investor_name text not null,
  kind text not null check (kind in ('reading', 'threshold_suggestion', 'alert_reason')),
  text text not null,
  shared_at timestamptz not null default now()
);
create index if not exists investor_feedback_shares_org_idx on investor_feedback_shares (org_id);
alter table investor_feedback_shares enable row level security;
create policy investor_feedback_shares_org_member on investor_feedback_shares for select
  using (is_org_member(org_id));
-- No investor-side policy: the share route runs through the service-role
-- client, same posture as every other investor write in this schema.

-- watson_investor_feedback_digests — Chamber 3: the k-anonymous (k>=3)
-- structural aggregate for Readiness & Train's "What investors think".
-- ONE row per org, regenerated at most once/day (checked at read time by
-- the route, never a cron of its own — this app's Hobby-plan cron is
-- already daily and this doesn't need its own). Structures only: a score
-- distribution summary and Watson-extracted THEMES — never verbatim notes,
-- never an investor identity, never a watchlist ordering.
create table if not exists watson_investor_feedback_digests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade unique,
  contributor_count int not null,
  score_avg numeric,
  score_min numeric,
  score_max numeric,
  themes text[] not null default '{}',
  generated_at timestamptz not null default now()
);
alter table watson_investor_feedback_digests enable row level security;
create policy watson_investor_feedback_digests_org_member on watson_investor_feedback_digests for select
  using (is_org_member(org_id));
-- No investor-side policy — this is a founder-facing aggregate; investors
-- never read this table at all (their own contribution stays as private as
-- their scorecard was before it fed the aggregate).
