-- Prompt 244/245 — Backoffice "Suspicious accounts" queue: manual flagging
-- by developers (NOT automatic pattern detection — confirmed explicitly by
-- Nuno), evidence capture, and three actions (alert email / suspend for a
-- chosen duration / delete + block email). Builds on migration 0121
-- (account_moderation_actions, orgs/catalog_entities.moderation_status) —
-- reused, not duplicated.

-- ===== 1. Time-boxed suspension — a clock separate from quarantineUntil =====
-- moderation_quarantine_until (0121) has always meant "how long until delete
-- is allowed," nothing else — the plain Startups/Investors suspend flow
-- blocks login/visibility INDEFINITELY regardless of it, until an explicit
-- "undo". The Suspicious Accounts queue needs a suspension that expires on
-- its own after a developer-chosen number of hours; reusing
-- quarantine_until for that would silently shorten the 30-day delete gate
-- too. New column instead — null means indefinite (unchanged default
-- behaviour for every existing/plain suspend).
alter table public.orgs
  add column if not exists moderation_suspended_until timestamptz;
alter table public.catalog_entities
  add column if not exists moderation_suspended_until timestamptz;

-- is_account_suspended() (0121) re-defined: 'deleted' still always blocks;
-- 'suspended' only blocks while moderation_suspended_until is null
-- (indefinite — the pre-existing behaviour) or still in the future.
create or replace function public.is_account_suspended()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select true from public.org_members om
       join public.orgs o on o.id = om.org_id
      where om.user_id = auth.uid()
        and (o.moderation_status = 'deleted'
             or (o.moderation_status = 'suspended'
                 and (o.moderation_suspended_until is null or o.moderation_suspended_until > now())))
      limit 1),
    (select true from public.matchdeal_investor_members mim
       join public.catalog_entities ce on ce.id = mim.catalog_entity_id
      where mim.user_id = auth.uid() and mim.status = 'active'
        and (ce.moderation_status = 'deleted'
             or (ce.moderation_status = 'suspended'
                 and (ce.moderation_suspended_until is null or ce.moderation_suspended_until > now())))
      limit 1),
    false
  );
$$;

-- Records whether a delete used the queue's bypass-quarantine exception
-- (see suspicious_account_flag_actions below) — auditable, not silent.
alter table public.account_moderation_actions
  add column if not exists bypassed_quarantine boolean not null default false;

-- ===== 2. Blocked emails =====
-- Prevents a blocked address from being granted new access anywhere in the
-- platform (checked at every account-creation/invite/grant server route —
-- see blocked-emails-server.ts) and from signing back in once already
-- blocked (checked via account_access_state() below, in middleware). Does
-- NOT prevent the auth.users row itself from being created by a
-- client-side signUp()/signInWithOtp() call — those hit Supabase Auth
-- directly, before any of our routes run. A Postgres "Before User Created"
-- hook could close that gap but lives in project config, not a migration —
-- flagged, not built, per the prompt's own instruction.
create table if not exists public.blocked_emails (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique check (email = lower(trim(email))),
  reason text not null,
  blocked_by uuid not null references auth.users(id),
  blocked_at timestamptz not null default now()
);

alter table public.blocked_emails enable row level security;
create policy blocked_emails_developer_read on public.blocked_emails
  for select using (public.is_ablute_developer());
-- Writes go through service-role backoffice API routes only, same
-- convention as account_moderation_actions (0121) — no insert/update/
-- delete policy needed for any authenticated role.

-- One combined RPC for middleware: was calling is_account_suspended()
-- alone; now also checks blocked_emails so a single round-trip per request
-- covers both. SECURITY DEFINER so it can read blocked_emails (RLS above
-- only grants developers select) using the caller's own session (auth.uid()
-- / the auth.users row it resolves to), not a client-supplied email.
create or replace function public.account_access_state()
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (
      select 1 from public.blocked_emails be
        join auth.users u on lower(u.email) = be.email
       where u.id = auth.uid()
    ) then 'blocked'
    when public.is_account_suspended() then 'suspended'
    else 'active'
  end;
$$;
grant execute on function public.account_access_state() to authenticated;

-- ===== 3. Suspicious account flags =====
-- One flag per developer-identified case; evidence is free text plus a
-- structured array of references to the concrete rows that back it up
-- (deal_messages/interactions/investor_relationship_decisions/etc ids) so a
-- reviewer can jump straight to them, not just read a paraphrase.
create table if not exists public.suspicious_account_flags (
  id uuid primary key default uuid_generate_v4(),
  target_type text not null check (target_type in ('org', 'investor')),
  target_id uuid not null,
  company_name text not null,
  email text,
  account_created_at timestamptz,
  evidence text not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  flagged_by uuid not null references auth.users(id),
  flagged_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'actioned'))
);
create index if not exists suspicious_account_flags_target_idx
  on public.suspicious_account_flags (target_type, target_id);
create index if not exists suspicious_account_flags_status_idx
  on public.suspicious_account_flags (status, flagged_at desc);

alter table public.suspicious_account_flags enable row level security;
create policy suspicious_account_flags_developer_read on public.suspicious_account_flags
  for select using (public.is_ablute_developer());

-- A flag can accumulate more than one action over time (e.g. an alert email
-- today, a suspension next week) — so the "result" the prompt asks for
-- (which action, when, by whom) is a child table, not columns on the flag
-- itself. `status` flips to 'actioned' the first time any row lands here
-- (app-layer, alongside the action's own write) and stays 'actioned' —
-- it's a "has this been looked at and acted on" marker, not a single-shot
-- outcome.
create table if not exists public.suspicious_account_flag_actions (
  id uuid primary key default uuid_generate_v4(),
  flag_id uuid not null references public.suspicious_account_flags(id) on delete cascade,
  action_type text not null check (action_type in ('alert_email', 'suspend', 'delete_and_block')),
  -- Links back to the shared moderation log (account_moderation_actions)
  -- for 'suspend'/'delete_and_block' — those actions go through the SAME
  -- applyModerationAction() state machine every other suspend/delete does,
  -- never a second, parallel implementation.
  moderation_action_id uuid references public.account_moderation_actions(id),
  suspend_hours int,
  email_id text,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  notes text
);
create index if not exists suspicious_account_flag_actions_flag_idx
  on public.suspicious_account_flag_actions (flag_id, created_at desc);

alter table public.suspicious_account_flag_actions enable row level security;
create policy suspicious_account_flag_actions_developer_read on public.suspicious_account_flag_actions
  for select using (public.is_ablute_developer());
-- Writes for both new tables go through service-role backoffice API routes
-- only (requirePlatformAdmin() gates every /api/backoffice/* route) — same
-- convention as account_moderation_actions.
