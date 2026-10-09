-- Prompt 904, Part C — seats of custom plans (docs/calls/SPEC_CALLS_V2.md §9.3).
--
-- APPLIED to production on 09/10/2026 at 14:17:39Z (Nuno's go-ahead, after a dry run inside a transaction
-- that always rolls back: every function behaved as specified, nothing persisted).
--
-- What is missing today (report in docs/calls/ETAPA0_PARTE_C_SEATS.md, C1):
--   1. The seat limit of a firm is a function of ONE of three tiers (1/2/5 seats) read off the
--      first member's matchdeal_profiles.plan_tier. A firm with no active member has no tier at
--      all, so a plan cannot be pre-assigned before the first claim.
--   2. There is nowhere to say "this firm has 10 seats".
--   3. There is no record of who holds a seat since when, nor of who released it.
--   4. Promo codes only exist for founder organisations (percent_off / free_trial).
--
-- Single source of truth for the limit, on the SQL side: matchdeal_firm_seat_limit(entity).
-- The app reads the same table (src/lib/investor-firm-seats.ts), and a test pins that the
-- tier numbers below equal plans.ts, so the trigger and the TypeScript cannot disagree.
--
-- No policies on purpose: RLS on + no policy = unreachable for anon/authenticated. Only the
-- service role (our routes) touches these tables and functions.

-- 1. The firm-level plan -----------------------------------------------------------------
create table if not exists public.investor_firm_seat_plans (
  catalog_entity_id uuid primary key references public.catalog_entities(id) on delete cascade,
  plan_name         text        not null default 'Private Detective',
  seats             integer     not null check (seats between 1 and 500),
  -- Which feature tier the firm's members get (matchdeal_profiles.plan_tier vocabulary).
  tier              text        not null default 'tier_c' check (tier in ('tier_a', 'tier_b', 'tier_c')),
  status            text        not null default 'active' check (status in ('active', 'ended')),
  activated_via     text        not null default 'backoffice' check (activated_via in ('backoffice', 'promo_code')),
  -- Lower-cased. The claimant with this email is seated as 'admin' of the firm (C4).
  admin_email       text,
  note              text,
  set_by            uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.investor_firm_seat_plans enable row level security;

-- 2. Entity-bound codes (C3) --------------------------------------------------------------
-- Not an extension of promo_codes: that table prices a FOUNDER ORGANISATION (percent_off /
-- free_trial, redeemed against an org). This one is about a catalog entity, grants seats not a
-- discount, and may only be used by someone who already holds an approved claim on that exact
-- profile. Only the hash is stored; the code is shown once, to the backoffice, when created.
create table if not exists public.investor_seat_codes (
  id                uuid primary key default gen_random_uuid(),
  code_hash         text        not null unique,
  code_hint         text        not null,                 -- last 4 characters, to tell codes apart in the list
  catalog_entity_id uuid        not null references public.catalog_entities(id) on delete cascade,
  seats             integer     not null check (seats between 1 and 500),
  tier              text        not null default 'tier_c' check (tier in ('tier_a', 'tier_b', 'tier_c')),
  plan_name         text        not null default 'Private Detective',
  status            text        not null default 'active' check (status in ('active', 'redeemed', 'revoked')),
  expires_at        timestamptz not null,
  redeemed_by       uuid,
  redeemed_at       timestamptz,
  revoked_at        timestamptz,
  note              text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);
alter table public.investor_seat_codes enable row level security;
create index if not exists investor_seat_codes_entity_idx on public.investor_seat_codes (catalog_entity_id);

-- 2b. Reserved seats (C4) ----------------------------------------------------------------------
-- The firm's administrator reserves a seat for an EMAIL. It counts against the limit from the
-- moment it exists (so the 11th invite of a 10-seat plan is refused) and is consumed when that
-- person claims the profile. An email, not a user id: it works for someone who has no account
-- yet, and answering it never says whether an account exists (the no-oracle rule of Prompt 564).
create table if not exists public.investor_firm_seat_invites (
  id                uuid primary key default gen_random_uuid(),
  catalog_entity_id uuid        not null references public.catalog_entities(id) on delete cascade,
  email             text        not null,                 -- lower-cased by the caller
  status            text        not null default 'open' check (status in ('open', 'accepted', 'cancelled')),
  invited_by        uuid,
  accepted_user_id  uuid,
  accepted_at       timestamptz,
  created_at        timestamptz not null default now()
);
alter table public.investor_firm_seat_invites enable row level security;
create unique index if not exists investor_firm_seat_invites_open_uq
  on public.investor_firm_seat_invites (catalog_entity_id, email) where status = 'open';

-- 3. History (C6) -------------------------------------------------------------------------
create table if not exists public.investor_seat_events (
  id                bigserial primary key,
  catalog_entity_id uuid        not null,
  member_id         uuid,
  user_id           uuid,
  event             text        not null check (event in (
    'seat_granted', 'seat_released', 'plan_set', 'plan_ended', 'admin_changed',
    'invite_created', 'invite_cancelled', 'claim_approved', 'claim_declined',
    'code_created', 'code_redeemed', 'code_revoked')),
  actor_user_id     uuid,
  detail            jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);
alter table public.investor_seat_events enable row level security;
create index if not exists investor_seat_events_entity_idx on public.investor_seat_events (catalog_entity_id, id desc);

-- Every transition INTO or OUT OF an active seat is logged, whichever route made it (claim
-- approval, admin removal, a back-office SQL fix). The actor, when the app knows it, is filled
-- in by the route right after (src/lib/investor-firm-seats.ts recordSeatActor).
create or replace function public.log_matchdeal_seat_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' then
      insert into public.investor_seat_events (catalog_entity_id, member_id, user_id, event, detail)
      values (new.catalog_entity_id, new.id, new.user_id, 'seat_granted', jsonb_build_object('role', new.role));
    end if;
  elsif new.status = 'active' and old.status is distinct from 'active' then
    insert into public.investor_seat_events (catalog_entity_id, member_id, user_id, event, detail)
    values (new.catalog_entity_id, new.id, new.user_id, 'seat_granted', jsonb_build_object('role', new.role));
  elsif old.status = 'active' and new.status is distinct from 'active' then
    insert into public.investor_seat_events (catalog_entity_id, member_id, user_id, event, detail)
    values (new.catalog_entity_id, new.id, new.user_id, 'seat_released', '{}'::jsonb);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_log_matchdeal_seat_event on public.matchdeal_investor_members;
create trigger trg_log_matchdeal_seat_event
  after insert or update of status on public.matchdeal_investor_members
  for each row execute function public.log_matchdeal_seat_event();

-- 4. The limit — ONE place -----------------------------------------------------------------
-- The firm's tier: an active seat plan wins, then the existing "first member with a value"
-- convention of 0285, then the fail-closed tier_a.
create or replace function public.matchdeal_firm_plan_tier(p_catalog_entity_id uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select sp.tier from public.investor_firm_seat_plans sp
      where sp.catalog_entity_id = p_catalog_entity_id and sp.status = 'active'),
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

-- The number of seats: the custom plan's own number when there is one, else the tier's.
create or replace function public.matchdeal_firm_seat_limit(p_catalog_entity_id uuid)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select sp.seats from public.investor_firm_seat_plans sp
      where sp.catalog_entity_id = p_catalog_entity_id and sp.status = 'active'),
    public.matchdeal_seat_limit(public.matchdeal_firm_plan_tier(p_catalog_entity_id)));
$$;

-- 0285's trigger, with the limit read from the one function above. Everything else (only a
-- transition INTO an active seat is checked; an already-seated user is waved through; the
-- existing over-limit QA firm keeps its seats) is unchanged.
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
  v_custom boolean;
begin
  if new.status is distinct from 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

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
  v_limit := public.matchdeal_firm_seat_limit(new.catalog_entity_id);
  v_custom := exists (select 1 from public.investor_firm_seat_plans sp
                       where sp.catalog_entity_id = new.catalog_entity_id and sp.status = 'active');

  if v_used >= v_limit then
    if v_custom then
      raise exception
        'Seat limit reached: this firm has a custom plan with % seat(s) and already has % active seat(s).',
        v_limit, v_used
        using errcode = 'check_violation',
              hint = 'Release a seat first, or ask the back-office to raise the number of seats.';
    end if;
    raise exception
      'Seat limit reached: this investor firm is on % (% seat(s)) and already has % active seat(s).',
      v_tier, v_limit, v_used
      using errcode = 'check_violation',
            hint = 'Raise the firm plan_tier (backoffice Accounts -> set investor plan) or revoke a seat first.';
  end if;

  return new;
end;
$$;

-- 5. Redeeming a code (C3), atomic -----------------------------------------------------------
-- One statement-level decision under a row lock: the code is single-use even if two requests
-- race. Every refusal returns the same {ok:false} — "no such code", "expired", "revoked",
-- "already used", "not your profile" are indistinguishable, so a code cannot be probed.
create or replace function public.redeem_investor_seat_code(p_code_hash text, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.investor_seat_codes;
  v_email text;
begin
  select * into c from public.investor_seat_codes where code_hash = p_code_hash for update;
  if not found or c.status <> 'active' or c.expires_at <= now() then
    return jsonb_build_object('ok', false);
  end if;

  -- Only someone with an APPROVED claim on THIS profile, who still holds an active seat on it.
  if not (
    exists (select 1 from public.investor_entity_claims cl
             where cl.catalog_entity_id = c.catalog_entity_id and cl.claimant_user_id = p_user and cl.status = 'approved')
    and exists (select 1 from public.matchdeal_investor_members m
                 where m.catalog_entity_id = c.catalog_entity_id and m.user_id = p_user and m.status = 'active')
  ) then
    return jsonb_build_object('ok', false);
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = p_user;

  insert into public.investor_firm_seat_plans
    (catalog_entity_id, plan_name, seats, tier, status, activated_via, admin_email, note, set_by)
  values
    (c.catalog_entity_id, c.plan_name, c.seats, c.tier, 'active', 'promo_code', v_email, 'activated by code ' || c.code_hint, p_user)
  on conflict (catalog_entity_id) do update
     set seats = greatest(public.investor_firm_seat_plans.seats, excluded.seats),
         tier = excluded.tier, plan_name = excluded.plan_name, status = 'active',
         activated_via = 'promo_code',
         admin_email = coalesce(public.investor_firm_seat_plans.admin_email, excluded.admin_email),
         updated_at = now();

  update public.investor_seat_codes
     set status = 'redeemed', redeemed_by = p_user, redeemed_at = now()
   where id = c.id;

  -- The person who activated the plan administers it, unless the firm already has an admin.
  if not exists (select 1 from public.matchdeal_investor_members m
                  where m.catalog_entity_id = c.catalog_entity_id and m.status = 'active' and m.role in ('owner', 'admin')) then
    update public.matchdeal_investor_members set role = 'admin'
     where catalog_entity_id = c.catalog_entity_id and user_id = p_user and status = 'active';
  end if;

  insert into public.investor_seat_events (catalog_entity_id, user_id, event, actor_user_id, detail)
  values (c.catalog_entity_id, p_user, 'code_redeemed', p_user, jsonb_build_object('code_hint', c.code_hint, 'seats', c.seats));

  return jsonb_build_object('ok', true, 'catalog_entity_id', c.catalog_entity_id, 'seats', c.seats, 'tier', c.tier);
end;
$$;

revoke all on function public.log_matchdeal_seat_event() from public, anon, authenticated;
revoke all on function public.matchdeal_firm_plan_tier(uuid) from public, anon, authenticated;
revoke all on function public.matchdeal_firm_seat_limit(uuid) from public, anon, authenticated;
revoke all on function public.enforce_matchdeal_seat_limit() from public, anon, authenticated;
revoke all on function public.redeem_investor_seat_code(text, uuid) from public, anon, authenticated;
grant execute on function public.matchdeal_firm_plan_tier(uuid) to service_role;
grant execute on function public.matchdeal_firm_seat_limit(uuid) to service_role;
grant execute on function public.redeem_investor_seat_code(text, uuid) to service_role;
