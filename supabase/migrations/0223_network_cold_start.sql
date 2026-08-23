-- Prompt 335 — My Network cold start. "My contacts (0)" doesn't grow itself:
-- Prompt 316's "no open people search — every connection starts from
-- verified, shared context" rule was designed against spam, but in practice
-- also blocks the network from ever starting. This is a deliberate,
-- documented extension of that rule (not a silent bypass): verified context
-- now also includes "I know this person personally and invited them by
-- their own email" — the founder's own stated justification, always shown
-- to the recipient before they accept, exactly like every other invite kind.

-- §D1/§330 — two new context_kind values. 'direct_known' already exists
-- (migration 0222, Prompt 330's own email-invite mechanism, which this
-- migration extends rather than duplicates). 'directory' is a §D2 invite
-- from the discoverable-founders search; 'connect_link' is a §D3a invite
-- created by opening someone's personal connect link.
alter table network_invites drop constraint if exists network_invites_context_kind_check;
alter table network_invites add constraint network_invites_context_kind_check
  check (context_kind in ('shared_investor', 'shared_group', 'referral', 'direct_known', 'directory', 'connect_link'));

-- §D1 — email invites. ONE table for both outcomes of "invite this email":
-- the target already has an account (a real network_invites row is created
-- immediately, `resulting_invite_id` points to it, status -> 'delivered')
-- or they don't yet (status stays 'pending', the token becomes a copyable
-- link; signing up with a matching email later materializes the same real
-- network_invites row via provision-org, see network-db.ts's own comment).
-- Unifying both paths here — rather than only tracking the "doesn't exist
-- yet" case — is what makes ONE unique constraint do triple duty: it caps
-- re-sends, blocks re-inviting a declined email, and blocks re-inviting an
-- already-connected email, all as the same "you already tried this email"
-- fact, forever, per actor. No carve-out for expiry — Prompt 335's own text
-- has no exception for it, so this is the literal, simpler reading.
create table if not exists network_email_invites (
  id uuid primary key default gen_random_uuid(),
  from_actor_id uuid not null references network_actors(id) on delete cascade,
  email text not null,
  message text not null,
  -- sha256 hex, same shape as matchdeal_pairing_tokens.token_hash — the raw
  -- token is only ever returned once, to the founder, as the copyable link.
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'accepted', 'declined', 'expired', 'revoked')),
  resulting_invite_id uuid references network_invites(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index if not exists network_email_invites_from_idx on network_email_invites (from_actor_id, created_at);
create index if not exists network_email_invites_email_idx on network_email_invites (lower(email));
-- A plain table-level UNIQUE can't reference lower(email) (Postgres unique
-- constraints can't be built on an expression) — a unique INDEX can, and is
-- exactly as enforcing at the DB level.
create unique index if not exists network_email_invites_no_repeat on network_email_invites (from_actor_id, lower(email));

alter table network_email_invites enable row level security;
create policy network_email_invites_self_read on network_email_invites
  for select using (public.is_my_network_actor(from_actor_id));

-- §D3a — "My connect link": one permanent, revocable/regenerable link per
-- actor. Opening it (by an authenticated user who isn't the owner) creates
-- a pending network_invites row FROM the link owner TO the opener
-- (context_kind='connect_link') — double opt-in still holds: the opener
-- still has to accept it like any other invite, opening the link is not
-- itself a connection.
create table if not exists network_connect_links (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null unique references network_actors(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table network_connect_links enable row level security;
create policy network_connect_links_self_read on network_connect_links
  for select using (public.is_my_network_actor(actor_id));

-- §D3b — cohort codes: a shared code (e.g. handed out to an accelerator
-- batch or event) that lets a founder self-join the matching group directly
-- — a NEW, additive path alongside the existing owner-initiated
-- network_invites(group_id=...) flow (migration 0211), which stays exactly
-- as it was. The group itself IS legitimate shared context under Prompt
-- 316's own rule once you're a member — this only changes how membership
-- can start. No founder-facing UI to CREATE a code in this prompt
-- (backoffice/developer sets it directly), per the prompt's own scope.
alter table network_groups add column if not exists join_code text unique;

-- §D1 — the rate cap ("máx. 5 convites directos/dia e 20/semana", mirroring
-- rules.ts's own outreach-cap NUMBERS deliberately, not the same constants
-- — a founder's outbound-to-investors cap and their network-invite cap are
-- different budgets that happen to use the same round numbers) is computed
-- in application code from network_email_invites.created_at — no DB trigger
-- needed for it, unlike the pre-existing 5-PENDING-total cap on
-- network_invites (migration 0209's enforce_network_invite_pending_cap,
-- untouched), which is a different axis (how many are outstanding right
-- now, not how many were sent recently).
