-- Prompt 295 — foundation for Prompts 296/297, no UI of its own. Confirmed
-- by grep across src/ (heartbeat|visibilitychange|idle|standby|
-- active_seconds|dwell): zero real session-time tracking exists today —
-- the only visibilitychange usage is popup re-polling / deck re-fetch,
-- never a time measurement. Without this, "minutes in standby, minutes
-- in use, acessos/dia, horas habituais" (Prompt 296/297) has no data to
-- read.
--
-- usage_sessions — one row per tab-session (opened until hidden/closed or
-- timed out), NOT one row per heartbeat: the client accumulates active/
-- standby deltas and flushes an aggregate every ~60s (Prompt 295 §1),
-- so this table grows O(1) per active user per minute, never O(1) per
-- 5s heartbeat. Two identities coexist deliberately, never merged into
-- one FK: the CRM/backoffice side is user_id+org_id (same identity
-- app_events, migration 0122, already uses); the MatchDeal side is
-- matchdeal_profile_id (the polymorphic id matchdeal_exposures/
-- matchdeal_swipes already key on, migration 0053). Exactly one of
-- user_id/matchdeal_profile_id is populated per row — a real MatchDeal
-- session from a dual-role account still only has a profile id, not an
-- org id, until this table's own reader (Prompt 297) joins back to
-- resolve one if it needs to.
create table public.usage_sessions (
  id uuid primary key default uuid_generate_v4(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_flush_at timestamptz not null default now(),
  active_seconds int not null default 0,
  standby_seconds int not null default 0,
  user_id uuid references auth.users(id) on delete set null,
  org_id uuid references public.orgs(id) on delete set null,
  matchdeal_profile_id uuid references public.matchdeal_profiles(id) on delete set null,
  -- Prompt 295 §2 — distinguishes which fraction of usage this row
  -- belongs to, so Prompt 296/297's aggregations never have to guess
  -- from context: 'crm' (founder shell), 'backoffice' (platform-admin
  -- shell — a real, separate context even for a dual-role account like
  -- Nuno, since the two shells are two different client mount points),
  -- 'matchdeal' (the PWA).
  context text not null check (context in ('crm', 'backoffice', 'matchdeal')),
  created_at timestamptz not null default now()
);

create index usage_sessions_user_idx on public.usage_sessions (user_id);
create index usage_sessions_org_idx on public.usage_sessions (org_id);
create index usage_sessions_matchdeal_profile_idx on public.usage_sessions (matchdeal_profile_id);
create index usage_sessions_context_created_idx on public.usage_sessions (context, created_at desc);

alter table public.usage_sessions enable row level security;

-- Write path is exclusively the service-role flush route (src/app/api/
-- usage/heartbeat/route.ts) — same "never a direct browser write" pattern
-- already used by page-view/route.ts (app_events). No insert/update
-- policy for anon/authenticated on purpose: the service role bypasses
-- RLS entirely for that route, and nothing else should ever write here.
create policy usage_sessions_admin_read on public.usage_sessions
  for select using (is_platform_admin());

-- Prompt 295 §3 — history for the Overview dashboard, so a snapshot never
-- has to be reconstructed from scratch once real-time state has moved on.
-- payload is deliberately opaque jsonb: it is exactly whatever the SAME
-- computation functions in backoffice-metrics.ts return today (see
-- computeAndStoreOverviewSnapshot in that file) — no second, divergent
-- shape, no interpretation happens here or at write time (the prompt is
-- explicit: no AI call in this prompt, payload just needs to be captured
-- for that analysis to happen LATER without lost history).
create table public.metrics_snapshots (
  id uuid primary key default uuid_generate_v4(),
  scope text not null,
  period text not null,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  triggered_by text not null check (triggered_by in ('manual', 'daily_cron')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index metrics_snapshots_scope_computed_idx on public.metrics_snapshots (scope, computed_at desc);

alter table public.metrics_snapshots enable row level security;
create policy metrics_snapshots_admin_only on public.metrics_snapshots
  for all using (is_platform_admin()) with check (is_platform_admin());
