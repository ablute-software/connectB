-- Redeeming an entity-bound seat code: at most 5 WRONG attempts per person per hour.
--
-- APPLIED to production on 12/10/2026 (Nuno's OK), after a dry run inside a transaction that always rolls back:
-- 5 checks passed (five tries counted down, the sixth and seventh refused with retry_after, another user
-- independent, clear starts again, the lock lifts when the hour is up) and nothing persisted. After applying: RLS
-- on, no function executable by anon/authenticated, and one live call (a throw-away uuid) that was deleted.
--
-- Why: since Adenda 1 (09/10/2026) a code is PD-XXXX-XXXX, 40 bits. It only works for someone who already has an
-- approved claim and an active seat on that exact firm (so they are already behind a login and inside the firm),
-- but nothing limited how often they could try. This is the same idea as the registration code's "5 wrong
-- attempts", with one difference: a seat code has no "send me a new one" step to reset the count, so the lock
-- lifts by itself when the hour is up.
--
-- Design (the app, src/lib/investor-firm-seats.ts, decides nothing here; it only calls these two functions):
--   seat_code_reserve_attempt(user, max, window)  -- called BEFORE the code is checked. It counts the attempt
--       first and answers allowed/refused under a row lock, so two parallel guesses cannot both slip under the
--       limit (the count is taken before the answer is known, not after).
--   seat_code_clear_attempts(user)                -- called after a code worked: the count starts again.
--
-- ADDITIVE only: one new table and two new functions; nothing existing is touched. No policies on purpose
-- (RLS on + no policy = unreachable for anon/authenticated; only our routes, with the service role).
create table if not exists public.seat_code_attempts (
  user_id           uuid primary key,
  wrong_attempts    integer     not null default 0,
  window_started_at timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.seat_code_attempts enable row level security;

create or replace function public.seat_code_reserve_attempt(p_user uuid, p_max integer, p_window_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.seat_code_attempts;
  v_now   timestamptz := now();
  v_wait  integer;
begin
  insert into public.seat_code_attempts (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into r from public.seat_code_attempts where user_id = p_user for update;

  -- The hour is up: a fresh window.
  if r.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    update public.seat_code_attempts set wrong_attempts = 0, window_started_at = v_now, updated_at = v_now
     where user_id = p_user;
    r.wrong_attempts := 0;
    r.window_started_at := v_now;
  end if;

  if r.wrong_attempts >= p_max then
    v_wait := ceil(extract(epoch from (r.window_started_at + make_interval(secs => p_window_seconds) - v_now)));
    return jsonb_build_object('allowed', false, 'attempts_left', 0, 'retry_after', greatest(v_wait, 1));
  end if;

  update public.seat_code_attempts set wrong_attempts = wrong_attempts + 1, updated_at = v_now where user_id = p_user;
  return jsonb_build_object('allowed', true, 'attempts_left', p_max - (r.wrong_attempts + 1), 'retry_after', 0);
end;
$$;

create or replace function public.seat_code_clear_attempts(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.seat_code_attempts where user_id = p_user;
$$;

revoke all on function public.seat_code_reserve_attempt(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.seat_code_clear_attempts(uuid) from public, anon, authenticated;
grant execute on function public.seat_code_reserve_attempt(uuid, integer, integer) to service_role;
grant execute on function public.seat_code_clear_attempts(uuid) to service_role;
