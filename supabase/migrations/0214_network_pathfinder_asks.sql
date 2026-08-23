-- Prompt 320 — My Network 5/9: Pathfinder. No new relationship data — the
-- match itself is computed live from network_connections + catalog_deliveries
-- (the exact same query 318's referral eligibility already runs), never
-- stored. The only new persistence is the "ask" itself (Pedido B): the
-- founder viewing the investor asks a specific connection to compose the
-- referral, rather than composing it themselves — same "notify, don't act
-- on their behalf" discipline as 319's network_followon_requests.
create table if not exists network_pathfinder_asks (
  id uuid primary key default gen_random_uuid(),
  requester_actor_id uuid not null references network_actors(id) on delete cascade,
  connection_actor_id uuid not null references network_actors(id) on delete cascade,
  target_actor_id uuid not null references network_actors(id) on delete cascade,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint network_pathfinder_asks_no_self_ask check (requester_actor_id <> connection_actor_id)
);
-- Partial unique — a duplicate open ask for the exact same
-- (requester, connection, target) triple is a no-op, not a second row;
-- once resolved (dismissed, or the connection actually sent the referral),
-- a fresh ask is a normal insert again.
create unique index if not exists network_pathfinder_asks_open_idx
  on network_pathfinder_asks (requester_actor_id, connection_actor_id, target_actor_id) where resolved_at is null;
create index if not exists network_pathfinder_asks_connection_idx on network_pathfinder_asks (connection_actor_id, resolved_at);

alter table network_pathfinder_asks enable row level security;
-- Both sides of an ask can read their own row via is_my_network_actor
-- (316's own RLS helper, deliberately not revoked from authenticated — see
-- CLAUDE.md's RLS-helper-accepted-WARN note) — the requester to see whether
-- their ask is still open, the connection to see what's been asked of them.
create policy network_pathfinder_asks_participant_read on network_pathfinder_asks for select
  using (public.is_my_network_actor(requester_actor_id) or public.is_my_network_actor(connection_actor_id));
