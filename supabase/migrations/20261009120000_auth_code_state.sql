-- Prompt 904, Part B — server-side state for the "register with a 6-digit code" flow
-- (spec docs/calls/SPEC_CALLS_V2.md §13.2–13.4).
--
-- APPLIED to production on 09/10/2026 at 14:17:16Z (Nuno's go-ahead, after a dry run inside a transaction
-- that always rolls back: every function behaved as specified, nothing persisted).
--
-- Why a table at all. Supabase Auth guarantees that a code is random, single-use and
-- expiring, but it limits verification attempts per IP, never per code or per email. Every
-- candidate's request reaches Supabase from the same Vercel egress IP once verification goes
-- through our route, so Supabase's own counter cannot tell candidates apart and offers no
-- "5 wrong attempts -> new code" rule. Those two rules live here, as atomic SQL (one row
-- lock per email), not as read-then-write in TypeScript: two parallel guesses must each
-- consume an attempt.
--
-- State is kept for EVERY email that ever asks for a code, whether or not an account exists
-- behind it. That is deliberate: the counters and the "too early" answer must look the same
-- for an unknown email and a registered one, or they become an account-existence oracle
-- (same principle as the identity-oracle rules of Prompt 564 / gdpr-no-oracle).
--
-- No policies on purpose: RLS on + no policy = no access for anon/authenticated. Only the
-- service role (our routes) reaches these tables and functions.

create table if not exists public.auth_code_state (
  email             text primary key,                 -- lower-cased by the caller
  generation        integer     not null default 0,   -- bumped at every send; only the newest code is meant to work
  wrong_attempts    integer     not null default 0,   -- reset at every send
  needs_new_code    boolean     not null default true,-- true until a send, and again after success or lock
  last_sent_at      timestamptz,
  window_started_at timestamptz,
  sends_in_window   integer     not null default 0,
  updated_at        timestamptz not null default now()
);
alter table public.auth_code_state enable row level security;

create table if not exists public.auth_code_ip_events (
  id         bigserial primary key,
  ip         text        not null,
  kind       text        not null check (kind in ('request', 'verify')),
  created_at timestamptz not null default now()
);
alter table public.auth_code_ip_events enable row level security;
create index if not exists auth_code_ip_events_lookup_idx
  on public.auth_code_ip_events (ip, kind, created_at);

-- Reserve the right to send a code. Atomic per email.
--   allowed=false + reason 'too_early'  -> resend asked before p_min_interval seconds
--   allowed=false + reason 'hourly_cap' -> more than p_max_per_window sends in the window
--   allowed=true                        -> a new generation starts: attempts back to 0
create or replace function public.auth_code_reserve_send(
  p_email text, p_min_interval integer, p_max_per_window integer, p_window_seconds integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r           public.auth_code_state;
  v_now       timestamptz := now();
  v_wait      integer;
  v_win_start timestamptz;
  v_win_count integer;
  v_gen       integer;
begin
  insert into public.auth_code_state (email) values (lower(p_email)) on conflict (email) do nothing;
  select * into r from public.auth_code_state where email = lower(p_email) for update;

  if r.last_sent_at is not null and r.last_sent_at + make_interval(secs => p_min_interval) > v_now then
    v_wait := ceil(extract(epoch from (r.last_sent_at + make_interval(secs => p_min_interval) - v_now)));
    return jsonb_build_object('allowed', false, 'reason', 'too_early', 'retry_after', v_wait);
  end if;

  v_win_start := r.window_started_at;
  v_win_count := r.sends_in_window;
  if v_win_start is null or v_win_start + make_interval(secs => p_window_seconds) <= v_now then
    v_win_start := v_now;
    v_win_count := 0;
  end if;
  if v_win_count >= p_max_per_window then
    v_wait := ceil(extract(epoch from (v_win_start + make_interval(secs => p_window_seconds) - v_now)));
    return jsonb_build_object('allowed', false, 'reason', 'hourly_cap', 'retry_after', v_wait);
  end if;

  update public.auth_code_state
     set generation = generation + 1, wrong_attempts = 0, needs_new_code = false,
         last_sent_at = v_now, window_started_at = v_win_start, sends_in_window = v_win_count + 1,
         updated_at = v_now
   where email = lower(p_email)
  returning generation into v_gen;

  return jsonb_build_object('allowed', true, 'generation', v_gen);
end $$;

-- Reserve one verification attempt BEFORE asking Supabase to check the code (reserve, then
-- verify): the attempt is spent even if the request dies half-way or races a parallel guess.
--   reason 'no_code' -> nothing was ever sent to this email
--   reason 'locked'  -> p_max wrong attempts already spent, or the code was already used
create or replace function public.auth_code_reserve_attempt(p_email text, p_max integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.auth_code_state;
  v_used integer;
begin
  select * into r from public.auth_code_state where email = lower(p_email) for update;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'no_code', 'attempts_left', 0);
  end if;
  if r.needs_new_code or r.wrong_attempts >= p_max then
    update public.auth_code_state set needs_new_code = true, updated_at = now() where email = lower(p_email);
    return jsonb_build_object('allowed', false, 'reason', 'locked', 'attempts_left', 0);
  end if;
  update public.auth_code_state set wrong_attempts = wrong_attempts + 1, updated_at = now()
   where email = lower(p_email) returning wrong_attempts into v_used;
  return jsonb_build_object('allowed', true, 'attempts_left', p_max - v_used);
end $$;

-- The code worked: it is spent, so a replay at our layer needs a new code too.
create or replace function public.auth_code_mark_used(p_email text) returns void
language sql security definer set search_path = '' as $$
  update public.auth_code_state set needs_new_code = true, wrong_attempts = 0, updated_at = now()
   where email = lower(p_email);
$$;

-- Per-IP limiter (same shape as guest_link_rate_limit, 0297): record first, then count, so a
-- client that keeps hammering burns its own budget. Returns true when the IP is over the limit.
create or replace function public.auth_code_ip_hit(
  p_ip text, p_kind text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into public.auth_code_ip_events (ip, kind) values (p_ip, p_kind);
  if random() < 0.02 then
    delete from public.auth_code_ip_events where created_at < now() - interval '1 day';
  end if;
  select count(*) into v_count from public.auth_code_ip_events
   where ip = p_ip and kind = p_kind and created_at >= now() - make_interval(secs => p_window_seconds);
  return v_count > p_limit;
end $$;

-- Does an account exist behind this email, and is it confirmed? Read by the route only to
-- choose WHICH email to send; the HTTP response never depends on the answer.
create or replace function public.auth_code_user_state(p_email text) returns jsonb
language sql security definer set search_path = '' stable as $$
  select coalesce(
    (select jsonb_build_object('exists', true, 'confirmed', u.email_confirmed_at is not null)
       from auth.users u where lower(u.email) = lower(p_email) and u.deleted_at is null limit 1),
    jsonb_build_object('exists', false, 'confirmed', false));
$$;

revoke all on function public.auth_code_reserve_send(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.auth_code_reserve_attempt(text, integer) from public, anon, authenticated;
revoke all on function public.auth_code_mark_used(text) from public, anon, authenticated;
revoke all on function public.auth_code_ip_hit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.auth_code_user_state(text) from public, anon, authenticated;
grant execute on function public.auth_code_reserve_send(text, integer, integer, integer) to service_role;
grant execute on function public.auth_code_reserve_attempt(text, integer) to service_role;
grant execute on function public.auth_code_mark_used(text) to service_role;
grant execute on function public.auth_code_ip_hit(text, text, integer, integer) to service_role;
grant execute on function public.auth_code_user_state(text) to service_role;
