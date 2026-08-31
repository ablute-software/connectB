-- Prompt 497 — investor seat limit: enforce in Postgres what INVESTOR_PLANS
-- already charges for (Pro Scout/tier_a 1 seat, Ace Spotter/tier_b 2,
-- The Legendary Sleuth/tier_c 5).
--
-- The app-level gate (src/lib/investor-seats.ts, wired into
-- portal/investor-profile/link and backoffice/investor-entity-claims/[id]/
-- approve) is the primary control and the one that produces the readable
-- "you're on Pro Scout, which includes 1 seat" message. THIS is the
-- backstop for everything that isn't those two routes: a future route, a
-- back-office SQL fix, an import script. Same layering the repo already
-- uses for verification writes (migration 0183).
--
-- Numbers are duplicated from plans.ts on purpose and pinned here in the
-- same shape matchdeal_tier_limits() already uses for swipe/like caps —
-- keyed on matchdeal_profiles.plan_tier's tier_a/b/c codes, with tier_a as
-- the fail-closed default, exactly like that function's own `else` branch.
-- If plans.ts's `seats` ever change, this function changes with it.
create or replace function public.matchdeal_seat_limit(p_tier text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_tier when 'tier_a' then 1 when 'tier_b' then 2 when 'tier_c' then 5 else 1 end;
$$;

-- The firm's tier, using the same "first member with a value" convention
-- investorOrgRows() and investor-seats.ts use: plan is one firm-level value
-- even though the column lives per seat on matchdeal_profiles.
create or replace function public.matchdeal_firm_plan_tier(p_catalog_entity_id uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.plan_tier
       from public.matchdeal_investor_members m
       join public.matchdeal_profiles p
         on p.membership_id = m.id and p.kind = 'investor'
      where m.catalog_entity_id = p_catalog_entity_id
        and m.status = 'active'
        and p.plan_tier is not null
      order by m.created_at
      limit 1),
    'tier_a');
$$;

-- CRITICAL: this fires ONLY when a row TRANSITIONS INTO an active seat —
-- an insert with status='active', or an update that flips a non-active row
-- to active. Every other write to an existing active seat
-- (data_room_last_seen_at, notify preferences, role, pipeline_confirmed_at,
-- revoking) passes straight through. That is what makes this safe to ship
-- against a firm that is ALREADY over its limit: measured 2026-08-31,
-- exactly one is — `ablute_ — Internal QA` (2 seats on tier_a), the
-- internal QA fixture, not a paying account — and it keeps both seats and
-- every ordinary write to them. Nothing is revoked or downgraded here;
-- deciding what to do about an existing over-limit firm is Nuno's call,
-- not the schema's. Only a THIRD seat on it would now be refused.
--
-- SECURITY DEFINER on purpose, with a pinned search_path: the counting
-- query and the tier lookup must see EVERY active seat on the firm, not
-- the subset the writing role's RLS policies happen to expose (an invoker
-- that can only see its own membership row would count 0 and wave through
-- an over-limit seat, and a tier it can't read would resolve to the
-- strictest default and block a legitimate one). It also means the inner
-- helper calls run as the owner, so the revokes below can't turn the
-- trigger itself into a "permission denied for function" hard failure.
create or replace function public.enforce_matchdeal_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tier text;
  v_limit integer;
  v_used integer;
begin
  if new.status is distinct from 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  -- Already seated here -> not a new seat, wave it through. The app upserts
  -- on (user_id, catalog_entity_id) and a BEFORE INSERT trigger fires before
  -- ON CONFLICT resolves, so a routine re-link arrives here looking exactly
  -- like a fresh INSERT. Merely excluding this user's own row from the count
  -- is NOT enough: on a firm already at or over its limit the OTHER seats
  -- still reach it and the re-link is refused. Caught empirically against
  -- production data before this shipped — the QA firm (2 seats, 1-seat tier)
  -- refused its own owner's re-link under exactly that weaker rule.
  if exists (
    select 1 from public.matchdeal_investor_members m
     where m.catalog_entity_id = new.catalog_entity_id
       and m.user_id = new.user_id
       and m.status = 'active'
       and m.id is distinct from new.id
  ) then
    return new;
  end if;

  select count(*) into v_used
    from public.matchdeal_investor_members m
   where m.catalog_entity_id = new.catalog_entity_id
     and m.status = 'active'
     and m.user_id is distinct from new.user_id
     and m.id is distinct from new.id;

  v_tier := public.matchdeal_firm_plan_tier(new.catalog_entity_id);
  v_limit := public.matchdeal_seat_limit(v_tier);

  if v_used >= v_limit then
    raise exception
      'Seat limit reached: this investor firm is on % (% seat(s)) and already has % active seat(s).',
      v_tier, v_limit, v_used
      using errcode = 'check_violation',
            hint = 'Raise the firm plan_tier (backoffice Accounts -> set investor plan) or revoke a seat first.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_matchdeal_seat_limit on public.matchdeal_investor_members;
create trigger trg_enforce_matchdeal_seat_limit
  before insert or update of status on public.matchdeal_investor_members
  for each row execute function public.enforce_matchdeal_seat_limit();

-- Same posture as every other rule function in this schema: not reachable
-- through PostgREST. The trigger keeps working regardless — Postgres does
-- not check EXECUTE on a trigger function when firing a trigger, and the
-- SECURITY DEFINER above covers the two inner helper calls.
revoke all on function public.matchdeal_seat_limit(text) from public, anon, authenticated;
revoke all on function public.matchdeal_firm_plan_tier(uuid) from public, anon, authenticated;
revoke all on function public.enforce_matchdeal_seat_limit() from public, anon, authenticated;
grant execute on function public.matchdeal_seat_limit(text) to service_role;
grant execute on function public.matchdeal_firm_plan_tier(uuid) to service_role;
