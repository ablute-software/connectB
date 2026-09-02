-- Prompt 531 — completes the My Network moderation lifecycle that 0215
-- started. 0215 gave reports a home (support_tickets, category
-- 'network_content_report', context 'network_post:{id}') and a strike
-- counter (network_actors.network_strikes_count / network_suspended_at,
-- 3 strikes = My Network suspension). What it never gave anyone:
--
--   * the reported CONTENT in back-office — only the reporter's own message
--     was stored, so a moderator could read the complaint but not the post
--     it was about, and posts are author-deletable (deleted_at) so it could
--     be gone by review time;
--   * a strike RECORD — the count was a bare integer, so no strike could be
--     traced to the case that caused it, reversed, or appealed;
--   * any way to remove the offending post from back-office;
--   * any way for the affected startup to know, or to contest.
--
-- This migration adds exactly those, and deliberately does NOT change the
-- moderation POLICY: the 3-strike threshold, "only My Network, never the
-- whole account", and manual-human-only strikes all stay exactly as 0215
-- defined them.

-- ---------------------------------------------------------------------------
-- 1. The snapshot. Taken when the report is filed, never later.
--
-- A post is author-deletable and the moderation queue is asynchronous, so
-- "just join network_posts at review time" loses the evidence in the one
-- case that matters most. jsonb rather than a copy of the columns: posts
-- carry a `structured` payload whose shape belongs to the app, and this
-- table's job is to freeze what was reported, not to track the post
-- schema. Small by construction — network_posts.body is capped at 2000
-- chars and there are no binary attachments on a post, so nothing large is
-- duplicated here.
create table if not exists network_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references support_tickets(id) on delete cascade,
  post_id uuid references network_posts(id) on delete set null,
  author_actor_id uuid references network_actors(id) on delete set null,
  -- The post as it was at report time: body, kind, structured, target,
  -- group name, created_at. Never the reporter — this row is also the
  -- source the REPORTED startup is shown, so it must not contain anything
  -- about who filed the report.
  snapshot jsonb not null,
  captured_at timestamptz not null default now()
);
create index if not exists network_report_snapshots_post_idx on network_report_snapshots (post_id);
create index if not exists network_report_snapshots_author_idx on network_report_snapshots (author_actor_id);

-- ---------------------------------------------------------------------------
-- 2. Strikes as records, not just a number.
--
-- network_actors.network_strikes_count stays — every existing write surface
-- reads it, and the 3-strike rule is expressed against it. It becomes a
-- DERIVED value: recomputed from the count of status='active' rows here
-- (see recomputeActorStrikeState in network-moderation-db.ts) rather than
-- incremented blind, which is what makes a reversal able to move it back
-- down truthfully instead of just editing a display.
create table if not exists network_strikes (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references network_actors(id) on delete cascade,
  -- The moderation case. NOT NULL on purpose: "do not create a strike that
  -- cannot later be traced back to the moderation case that caused it".
  ticket_id uuid not null references support_tickets(id) on delete restrict,
  post_id uuid references network_posts(id) on delete set null,
  snapshot_id uuid references network_report_snapshots(id) on delete set null,
  applied_by uuid not null references auth.users(id),
  applied_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'reversed')),
  reversed_by uuid references auth.users(id),
  reversed_at timestamptz,
  -- Internal only. Never leaves the back-office — the startup-facing
  -- projection (network-moderation.ts) does not carry this field.
  reversal_reason text,
  -- Content removal is a SEPARATE action from the strike (§29) and is
  -- recorded on network_posts itself; this flag only mirrors whether it
  -- happened as part of this case, so the strike detail can say so without
  -- a join to a possibly-deleted post.
  content_removed boolean not null default false,
  constraint network_strikes_reversed_has_actor check (status <> 'reversed' or reversed_by is not null)
);
-- Idempotency, at the database rather than in a handler (§35): one strike
-- per moderation case, ever. A double-clicked button, a retried request, or
-- a refreshed page cannot produce a second row.
create unique index if not exists network_strikes_ticket_unique on network_strikes (ticket_id);
-- ...and one ACTIVE strike per post, so five people reporting the same post
-- (five tickets) still yields at most one strike for it. Reversing frees
-- the post to be struck again, which is the correct behaviour after a
-- mistaken reversal.
create unique index if not exists network_strikes_active_post_unique
  on network_strikes (post_id) where (post_id is not null and status = 'active');
create index if not exists network_strikes_actor_idx on network_strikes (actor_id, applied_at desc);

-- ---------------------------------------------------------------------------
-- 3. Appeals ("Contest decision").
create table if not exists network_strike_appeals (
  id uuid primary key default gen_random_uuid(),
  strike_id uuid not null references network_strikes(id) on delete cascade,
  actor_id uuid not null references network_actors(id) on delete cascade,
  -- The startup's own explanation. Written by the reported party, read by
  -- back-office. Never contains reporter data because the appeal screen it
  -- is written on never had any.
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'upheld', 'reversed')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  -- Internal moderator note on the decision. Never shown to the startup.
  decision_note text,
  constraint network_strike_appeals_decided_has_actor check (status = 'pending' or decided_by is not null)
);
-- One pending appeal per strike — a second "Contest" click cannot open a
-- duplicate case, and a decided appeal doesn't block a later one if the
-- product ever allows re-appeal.
create unique index if not exists network_strike_appeals_pending_unique
  on network_strike_appeals (strike_id) where (status = 'pending');
create index if not exists network_strike_appeals_actor_idx on network_strike_appeals (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Moderator removal of a post, distinguishable from the author's own
-- delete.
--
-- deleted_at is set TOO, deliberately: every existing read path already
-- filters on it (readFeedForActor, the RLS policy, readLastUpdatePostCreatedAt),
-- so a moderation removal is hidden everywhere the day this ships without
-- having to find and patch each query — and a missed query here is a
-- violating post still on the network. These two columns record that it was
-- moderation, and by whom, which deleted_at alone cannot say.
alter table network_posts
  add column if not exists moderation_removed_at timestamptz,
  add column if not exists moderation_removed_by uuid references auth.users(id);

-- ---------------------------------------------------------------------------
-- 5. RLS. Every one of these tables is served exclusively through
-- service-role routes (back-office moderation routes, and the startup's own
-- /api/network/moderation, which applies its own actor scoping and its own
-- field projection). No policy is created, so with RLS enabled the tables
-- are unreachable from anon/authenticated PostgREST — which is the point:
-- network_report_snapshots and network_strikes must never be readable by
-- the browser, or the reported startup could read another actor's cases,
-- and support_tickets-linked ids would be enumerable.
alter table network_report_snapshots enable row level security;
alter table network_strikes enable row level security;
alter table network_strike_appeals enable row level security;

revoke all on network_report_snapshots from anon, authenticated;
revoke all on network_strikes from anon, authenticated;
revoke all on network_strike_appeals from anon, authenticated;
