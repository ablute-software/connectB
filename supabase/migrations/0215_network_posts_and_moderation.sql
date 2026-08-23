-- Prompt 321 — My Network 6/9: posts, and the anti-sales rule APPLIED BY
-- THE PRODUCT, not just a terms page ("Isto tem que ser explícito" — Nuno's
-- own words). This migration covers the model + moderation plumbing; the
-- linter itself (network-content-policy.ts) is pure TypeScript, applied
-- server-side before every insert this migration's tables accept.

-- ---------------------------------------------------------------------------
-- network_posts. No edit after publishing (kept simple, per the prompt);
-- delete is a soft delete (deleted_at) so a removed post's id can still be
-- referenced by an existing report.
create table if not exists network_posts (
  id uuid primary key default gen_random_uuid(),
  author_actor_id uuid not null references network_actors(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  target text not null check (target in ('all', 'group')),
  group_id uuid references network_groups(id) on delete cascade,
  excluded_actor_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint network_posts_group_requires_id check (target <> 'group' or group_id is not null),
  constraint network_posts_all_has_no_group check (target <> 'all' or group_id is null)
);
create index if not exists network_posts_author_idx on network_posts (author_actor_id, created_at);
create index if not exists network_posts_group_idx on network_posts (group_id, created_at);

alter table network_posts enable row level security;

-- Visibility is computed live off network_connections/network_group_members
-- every time — deliberately NEVER a snapshot taken at publish time (Pedido
-- A's own explicit requirement: remove a connection later and its author's
-- past posts disappear too, "coerente com já não são ligados"). Every
-- My Network route uses the service-role client (bypasses this entirely),
-- so the REAL enforcement is the equivalent allowlist filter in
-- network-posts-db.ts — this policy is the same defense-in-depth posture
-- as 0212's network_referrals.
create policy network_posts_visible_read on network_posts for select using (
  deleted_at is null and (
    public.is_my_network_actor(author_actor_id)
    or (target = 'group' and public.is_my_active_group_membership(group_id))
    or (
      target = 'all'
      and exists (
        select 1 from public.network_connections nc
        join public.network_actors viewer on (
          (nc.actor_low_id = author_actor_id and nc.actor_high_id = viewer.id)
          or (nc.actor_high_id = author_actor_id and nc.actor_low_id = viewer.id)
        )
        where nc.status = 'active'
          and public.is_my_network_actor(viewer.id)
          and not (viewer.id = any(network_posts.excluded_actor_ids))
      )
    )
  )
);

-- ---------------------------------------------------------------------------
-- Strikes + My Network suspension (Pedido C). Lives on network_actors — the
-- same dual-identity node 316 already built for exactly this kind of
-- cross-cutting per-actor state — rather than orgs.platform_suspended_at
-- (migration 0168), which suspends the WHOLE pipeline; this suspends ONLY
-- My Network access, per the prompt's own explicit distinction. Incremented
-- manually by back-office on a resolved report — never automated, same
-- "no AI decides alone on something with social consequence" posture as the
-- rest of this app's moderation.
alter table network_actors
  add column if not exists network_strikes_count integer not null default 0,
  add column if not exists network_suspended_at timestamptz;

-- ---------------------------------------------------------------------------
-- Report routing (Pedido C) — reuses support_tickets (migration 0036)
-- rather than a parallel moderation system. A first-class category value
-- (not 'other' + context) matches this codebase's own established
-- preference for explicit values over an overloaded fallback (see
-- entities.source's 'investor_invite', migration 0122/Prompt 318) — the
-- back-office needs to filter and act on these distinctly from a garden-
-- variety support question.
alter table support_tickets drop constraint if exists support_tickets_category_check;
alter table support_tickets add constraint support_tickets_category_check
  check (category in ('question', 'problem', 'billing', 'data_correction', 'claim_profile', 'network_content_report', 'other'));
