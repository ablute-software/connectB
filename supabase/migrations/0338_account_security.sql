-- Prompt 602 — change the password, close the account.
--
-- Additive and reversible: three new columns, one new table, two functions
-- (one new, one replaced with a strictly wider result), no data rewritten.

-- §B — the owner's own switch: "allow an admin to start a reset of my
-- password". Off by default. Lives on the owner's membership row because it
-- is that person's choice about their own credential, not an org setting.
alter table public.org_members
  add column if not exists allow_admin_password_reset boolean not null default false;

-- §C — a closure the OWNER asked for is not the same state as a platform
-- suspension or "closed because the last member was deleted" (0305). Who
-- closed it, why, and when the retention window ends.
alter table public.orgs
  add column if not exists closed_by uuid,
  add column if not exists closed_reason text,
  add column if not exists purge_after timestamptz;
alter table public.orgs drop constraint if exists orgs_closed_reason_check;
alter table public.orgs add constraint orgs_closed_reason_check
  check (closed_reason is null or closed_reason in ('owner', 'platform', 'last_member_deleted'));

-- The "who / when / from where" trail for credential and account events —
-- the user's own security history (readable by them), and the store for the
-- one-time "this wasn't me" token (hash only, never the token).
create table if not exists public.account_security_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid,
  org_id uuid references public.orgs(id) on delete set null,
  kind text not null check (kind in ('password_changed', 'owner_reset_initiated', 'owner_reset_disputed', 'org_closed', 'org_reopened')),
  actor_user_id uuid,
  ip text,
  user_agent text,
  token_hash text,
  token_expires_at timestamptz,
  used_at timestamptz,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists account_security_events_user_idx on public.account_security_events (user_id, created_at desc);
create index if not exists account_security_events_token_idx on public.account_security_events (token_hash) where token_hash is not null;
alter table public.account_security_events enable row level security;
drop policy if exists account_security_events_read on public.account_security_events;
create policy account_security_events_read on public.account_security_events
  for select using (user_id = auth.uid() or public.is_platform_admin());
-- No insert/update policy: service role only.

-- §A/§B — ending sessions server-side. "Change the password → the other
-- sessions fall" needs the caller's own JWT (GoTrue's /logout?scope=others),
-- which the change-password route has; "this wasn't me" has no JWT at all,
-- so it needs this: delete the user's auth.sessions (refresh tokens cascade),
-- optionally keeping one. SECURITY DEFINER (postgres owns auth.sessions),
-- EXECUTE revoked from every client role — service role only.
create or replace function public.account_terminate_sessions(p_user_id uuid, p_keep_session_id uuid default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  delete from auth.sessions s
   where s.user_id = p_user_id
     and (p_keep_session_id is null or s.id <> p_keep_session_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.account_terminate_sessions(uuid, uuid) from public, anon, authenticated;

-- §C — the middleware's one round-trip gate learns a fourth state. A closure
-- by the owner reads as 'closed' (its own page: "closed by its owner on X,
-- kept until Y"), checked BEFORE the suspension test because close_org()
-- also stamps platform_suspended_at and would otherwise report 'suspended'.
-- 'blocked', 'suspended' and 'active' are byte-for-byte migration 0180's.
create or replace function public.account_access_state()
returns text
language sql stable security definer
set search_path to 'public'
as $function$
  select case
    when exists (
      select 1 from public.blocked_emails be
        join auth.users u on lower(u.email) = be.email
       where u.id = auth.uid()
    ) then 'blocked'
    when exists (
      select 1 from public.org_members m
        join public.orgs o on o.id = m.org_id
       where m.user_id = auth.uid() and o.closed_at is not null and o.closed_reason = 'owner'
    ) then 'closed'
    when public.is_account_suspended() then 'suspended'
    else 'active'
  end;
$function$;
