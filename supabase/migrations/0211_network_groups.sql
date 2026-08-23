-- Prompt 317 — My Network 2/9: groups. Second source of verified context
-- for connections (the first, 316, was "shares the investor X"), and the
-- future destination for posts (321) and their exclusions.
--
-- Joining a group is ALWAYS by invite/acceptance of the joinee — never
-- force-added (a group is a surface that reads other members' posts later;
-- being put there without consent is exactly what makes a network read as
-- spam). Reuses network_invites' existing expiry/pending-cap/accept-decline
-- state machine rather than a second one: a group-join invite is a row
-- with group_id set (to_actor_id is the invitee, accepting inserts into
-- network_group_members instead of network_connections) — 'shared_group'
-- was already a valid context_kind value as of migration 0209, added
-- ahead of time for exactly this.
create table if not exists network_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  kind text not null check (kind in ('accelerator_batch', 'investor_portfolio', 'topic')),
  owner_actor_id uuid not null references network_actors(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists network_groups_owner_idx on network_groups (owner_actor_id);

-- status: 'invited' while the join invite is pending, 'active' once
-- accepted, 'left' once the member leaves (or the owner removes them) —
-- never deleted, so "who was ever a member" stays honest.
create table if not exists network_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references network_groups(id) on delete cascade,
  actor_id uuid not null references network_actors(id) on delete cascade,
  added_by_actor_id uuid not null references network_actors(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active', 'left')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (group_id, actor_id)
);
create index if not exists network_group_members_actor_idx on network_group_members (actor_id, status);
create index if not exists network_group_members_group_idx on network_group_members (group_id, status);

alter table network_invites add column if not exists group_id uuid references network_groups(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- RLS — readable by any ACTIVE member of the group (that's the whole point
-- of a group: membership itself is visible to fellow members, per the
-- prompt's own privacy guard — "pertencer a um grupo é visível aos outros
-- membros DESSE grupo... nunca a quem está fora"), plus the owner (who
-- might not yet be an 'active' row — see the owner-auto-membership note in
-- network-db.ts). Writes stay service-role-only, same as every other
-- My Network table.
create or replace function public.is_my_active_group_membership(p_group_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.network_group_members gm
    where gm.group_id = p_group_id and gm.status = 'active' and public.is_my_network_actor(gm.actor_id)
  );
$$;

alter table network_groups enable row level security;
alter table network_group_members enable row level security;

create policy network_groups_member_read on network_groups
  for select using (public.is_my_active_group_membership(id) or public.is_my_network_actor(owner_actor_id));

create policy network_group_members_member_read on network_group_members
  for select using (
    public.is_my_active_group_membership(group_id)
    or public.is_my_network_actor(actor_id)
    or public.is_my_network_actor(added_by_actor_id)
  );

-- Deliberately NOT revoked, unlike 0210's trigger functions: this one is
-- referenced directly in the two RLS policies above, and revoking EXECUTE
-- from `authenticated` would break every founder's own read of their own
-- groups (a policy's USING clause runs under the querying role's own
-- privileges, not the security-definer owner's). Same accepted WARN as
-- is_org_member/is_my_network_actor (0209's own comment) — a real,
-- structural tradeoff of the RLS-helper-function pattern, not an oversight.
