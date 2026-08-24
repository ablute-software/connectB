-- Prompt 348 — "Watching closely": a bilateral, PRIVATE channel between one
-- investor and one startup that both consented to, separate from the
-- Pipeline decision (interested/passed) and from My Network (public
-- publications to the whole network — watching is never posted there).
--
-- investor_watches — the relationship itself. Double opt-in: 'requested' by
-- the investor, 'active' only once the founder accepts, 'declined'/'revoked'
-- are both terminal (a declined/revoked watch can be re-requested, which
-- just inserts... no, unique(org_id, investor_catalog_entity_id) means a
-- re-request updates the SAME row back to 'requested' — app-level upsert,
-- not a new row, so history doesn't fork).
create table if not exists investor_watches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  investor_catalog_entity_id uuid not null references catalog_entities(id) on delete cascade,
  status text not null check (status in ('requested', 'active', 'declined', 'revoked')) default 'requested',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  -- Captured only once status becomes 'active' (the baseline "what this
  -- investor sees, right now" — startup_profile_snapshots, the exact same
  -- table/shape the Archive's own "then vs now" already uses).
  baseline_snapshot_id uuid references startup_profile_snapshots(id),
  -- Updated every time the investor marks the delta as seen (dossier visit
  -- with an active watch) — the anchor every "what changed" query reads
  -- forward from.
  last_seen_at timestamptz,
  unique (org_id, investor_catalog_entity_id)
);
create index if not exists investor_watches_org_idx on investor_watches (org_id);
create index if not exists investor_watches_investor_idx on investor_watches (investor_catalog_entity_id);

alter table investor_watches enable row level security;
-- Founder transparency ("o founder vê a lista dos seus watchers") — org
-- membership read, same pattern as investor_relationship_decisions. No
-- investor-side policy: the investor's own routes go through the
-- service-role client, same posture as every other investor-write path in
-- this schema (decide_investor_relationship, archive, etc.).
create policy investor_watches_org_member on investor_watches for select
  using (is_org_member(org_id));
create policy investor_watches_admin on investor_watches for select
  using (is_platform_admin());

-- investor_watch_thresholds — the mechanical, verifiable alert menu (never
-- free text). One row per (watch, kind); 'match_score_above' is the only
-- kind that carries a value.
create table if not exists investor_watch_thresholds (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references investor_watches(id) on delete cascade,
  kind text not null check (kind in (
    'class1_evidence', 'class2_evidence', 'round_opened_or_changed', 'roadmap_milestone', 'match_score_above'
  )),
  threshold_value numeric,
  created_at timestamptz not null default now(),
  unique (watch_id, kind)
);
alter table investor_watch_thresholds enable row level security;
-- Investor-private configuration — no policy at all (service-role only),
-- same posture as investor_scorecard_criteria's own writes.

-- investor_watch_alerts — a fired threshold, cited never invented ("New
-- class-1 traction evidence shared with you: {claim statement}"). Read by
-- the investor's own Actions-required aggregation.
create table if not exists investor_watch_alerts (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references investor_watches(id) on delete cascade,
  kind text not null,
  fact_text text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists investor_watch_alerts_watch_idx on investor_watch_alerts (watch_id);
alter table investor_watch_alerts enable row level security;

-- watch_updates — founder-authored, sent to watchers (all, or a named
-- subset) through the PRIVATE channel only — never the My Network feed.
create table if not exists watch_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  body text not null check (char_length(body) <= 2000),
  target text not null check (target in ('all', 'selected')) default 'all',
  recipient_investor_catalog_entity_ids uuid[],
  created_at timestamptz not null default now()
);
create index if not exists watch_updates_org_idx on watch_updates (org_id);
alter table watch_updates enable row level security;
create policy watch_updates_org_member on watch_updates for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));
