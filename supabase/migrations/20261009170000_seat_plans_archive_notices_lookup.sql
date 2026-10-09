-- Prompt 904, Adenda 1 (v2) — ended plans archive, "added to a firm" notices, delete-a-code history,
-- and a lookup of an account by email. Everything here is ADDITIVE: a new table or two, one function that
-- replaces another with the same signature, and a CHECK that gains values (a superset of the old one).
--
-- APPLIED to production on 09/10/2026 (authorised in the prompt for additive migrations), after a dry run
-- inside a transaction that always rolls back: 7 checks passed (backfill of a pre-existing ended plan, end a
-- plan with a member snapshot, two ended plans on one firm, the CHECK, the email lookup, the redeem fix, the
-- notices table) and nothing persisted. Production had 0 ended plans, so the backfill inserted nothing.
--
-- What this answers (docs/calls/ADENDA1_SEATS_BACKOFFICE.md):
--   1. A seat plan is ONE row per firm (investor_firm_seat_plans, key catalog_entity_id). Ending it only
--      flips `status`, and a new plan on the same firm overwrites the old row. So who held the seats
--      when it ended, and that it ever existed, were lost. `investor_firm_seat_plan_archive` keeps one
--      row per ENDED plan, with a snapshot of the members at that instant, written in the SAME
--      transaction that ends the plan (end_investor_seat_plan below).
--   2. "Add a person by email": the person is told on the platform as well as by email. A person with no
--      account yet cannot be addressed by user id, so a notice is keyed by EMAIL and shown to whoever signs
--      in with that confirmed address (investor_seat_notices).
--   3. Deleting a never-used code is logged in the firm's history: the events CHECK gains 'code_deleted'.
--   4. seat_user_id_by_email(): auth.users is not reachable through PostgREST, and walking listUsers() for
--      one address is O(users). One indexed lookup, service role only.
--
-- Also fixed, because it is the same row: redeem_investor_seat_code() used `greatest(old.seats, new)` on
-- conflict, which let the seats of a long-ENDED plan leak into the plan a code later re-activates. It now
-- only takes the greater number when the existing plan is still active, and a re-activated plan starts a
-- new life (created_at = now()).
--
-- No policies on purpose, as for the other seat tables: RLS on + no policy = unreachable for
-- anon/authenticated. Only the service role (our routes) touches them.

-- 1. The archive of ended plans ----------------------------------------------------------------
create table if not exists public.investor_firm_seat_plan_archive (
  id                uuid primary key default gen_random_uuid(),
  catalog_entity_id uuid        not null references public.catalog_entities(id) on delete cascade,
  plan_name         text        not null,
  seats             integer     not null,
  tier              text        not null,
  activated_via     text        not null,
  admin_email       text,
  note              text,
  plan_created_at   timestamptz not null,   -- when the plan began (the row's created_at / its last re-activation)
  plan_changed_at   timestamptz not null,   -- the last change before it ended
  ended_at          timestamptz not null default now(),
  ended_by          uuid,
  -- [{userId, email, name, role, since}] — who held a seat at the moment the plan ended.
  members           jsonb       not null default '[]'::jsonb,
  -- true when rebuilt from investor_seat_events for a plan that ended before this table existed.
  reconstructed     boolean     not null default false,
  created_at        timestamptz not null default now()
);
alter table public.investor_firm_seat_plan_archive enable row level security;
create index if not exists investor_firm_seat_plan_archive_entity_idx
  on public.investor_firm_seat_plan_archive (catalog_entity_id, ended_at desc);

-- 2. Notices ("You've been added to X") ---------------------------------------------------------
create table if not exists public.investor_seat_notices (
  id                uuid primary key default gen_random_uuid(),
  email             text        not null,                 -- lower-cased by the caller
  catalog_entity_id uuid        not null references public.catalog_entities(id) on delete cascade,
  kind              text        not null default 'added_to_firm' check (kind in ('added_to_firm')),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  seen_at           timestamptz
);
alter table public.investor_seat_notices enable row level security;
create index if not exists investor_seat_notices_unseen_idx
  on public.investor_seat_notices (email) where seen_at is null;

-- 3. History: the new event type ----------------------------------------------------------------
do $chk$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.investor_seat_events'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%seat_granted%'
  loop
    execute format('alter table public.investor_seat_events drop constraint %I', c.conname);
  end loop;
  alter table public.investor_seat_events add constraint investor_seat_events_event_check check (event in (
    'seat_granted', 'seat_released', 'plan_set', 'plan_ended', 'admin_changed',
    'invite_created', 'invite_cancelled', 'claim_approved', 'claim_declined',
    'code_created', 'code_redeemed', 'code_revoked', 'code_deleted'));
end
$chk$;

-- 4. Account lookup by email --------------------------------------------------------------------
create or replace function public.seat_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
$$;
revoke all on function public.seat_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.seat_user_id_by_email(text) to service_role;

-- 5. End a plan: archive + status + history, ONE transaction -------------------------------------
-- A function because PostgREST cannot span statements in a transaction. Nobody is removed from the firm:
-- the members stay, the firm falls back to its 1/2/5 tier (matchdeal_firm_plan_tier ignores an ended plan).
create or replace function public.end_investor_seat_plan(p_entity uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.investor_firm_seat_plans;
  v_members jsonb;
  v_archive uuid;
begin
  select * into p from public.investor_firm_seat_plans
   where catalog_entity_id = p_entity and status = 'active' for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', m.user_id,
           'email', lower(u.email),
           'name', (select pr.representative_name from public.matchdeal_profiles pr
                     where pr.membership_id = m.id and pr.kind = 'investor' limit 1),
           'role', m.role,
           'since', coalesce((select max(e.created_at) from public.investor_seat_events e
                               where e.member_id = m.id and e.event = 'seat_granted'), m.created_at)
         ) order by m.created_at), '[]'::jsonb)
    into v_members
    from public.matchdeal_investor_members m
    left join auth.users u on u.id = m.user_id
   where m.catalog_entity_id = p_entity and m.status = 'active';

  insert into public.investor_firm_seat_plan_archive
    (catalog_entity_id, plan_name, seats, tier, activated_via, admin_email, note,
     plan_created_at, plan_changed_at, ended_at, ended_by, members)
  values
    (p.catalog_entity_id, p.plan_name, p.seats, p.tier, p.activated_via, p.admin_email, p.note,
     p.created_at, p.updated_at, now(), p_actor, v_members)
  returning id into v_archive;

  update public.investor_firm_seat_plans set status = 'ended', updated_at = now()
   where catalog_entity_id = p_entity;

  insert into public.investor_seat_events (catalog_entity_id, event, actor_user_id, detail)
  values (p_entity, 'plan_ended', p_actor,
          jsonb_build_object('seats', p.seats, 'archiveId', v_archive, 'members', jsonb_array_length(v_members)));

  return jsonb_build_object('ok', true, 'archiveId', v_archive, 'seats', p.seats);
end;
$$;
revoke all on function public.end_investor_seat_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.end_investor_seat_plan(uuid, uuid) to service_role;

-- 6. Redeeming a code, with the stale-seats fix (see the header) ----------------------------------
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
     set seats = case when public.investor_firm_seat_plans.status = 'active'
                      then greatest(public.investor_firm_seat_plans.seats, excluded.seats) else excluded.seats end,
         tier = excluded.tier, plan_name = excluded.plan_name,
         created_at = case when public.investor_firm_seat_plans.status = 'active'
                           then public.investor_firm_seat_plans.created_at else now() end,
         status = 'active',
         activated_via = 'promo_code',
         admin_email = case when public.investor_firm_seat_plans.status = 'active'
                            then coalesce(public.investor_firm_seat_plans.admin_email, excluded.admin_email) else excluded.admin_email end,
         updated_at = now();

  update public.investor_seat_codes
     set status = 'redeemed', redeemed_by = p_user, redeemed_at = now()
   where id = c.id;

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
revoke all on function public.redeem_investor_seat_code(text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_investor_seat_code(text, uuid) to service_role;

-- 7. Plans that ended BEFORE the archive existed ---------------------------------------------------
-- Rebuilt from investor_seat_events: the members whose last seat event up to the end was `seat_granted`.
-- Their role is the current one (the only one still on record). Flagged `reconstructed`.
insert into public.investor_firm_seat_plan_archive
  (catalog_entity_id, plan_name, seats, tier, activated_via, admin_email, note,
   plan_created_at, plan_changed_at, ended_at, ended_by, members, reconstructed)
select
  sp.catalog_entity_id, sp.plan_name, sp.seats, sp.tier, sp.activated_via, sp.admin_email, sp.note,
  sp.created_at, sp.updated_at,
  coalesce(ended.created_at, sp.updated_at), ended.actor_user_id,
  coalesce((
    select jsonb_agg(jsonb_build_object('userId', m.user_id, 'email', lower(u.email), 'name', null,
                                        'role', m.role, 'since', last_ev.created_at) order by last_ev.created_at)
      from public.matchdeal_investor_members m
      left join auth.users u on u.id = m.user_id
      join lateral (
        select e.event, e.created_at from public.investor_seat_events e
         where e.member_id = m.id and e.event in ('seat_granted', 'seat_released')
           and e.created_at <= coalesce(ended.created_at, sp.updated_at)
         order by e.id desc limit 1
      ) last_ev on last_ev.event = 'seat_granted'
     where m.catalog_entity_id = sp.catalog_entity_id
  ), '[]'::jsonb),
  true
from public.investor_firm_seat_plans sp
left join lateral (
  select e.created_at, e.actor_user_id from public.investor_seat_events e
   where e.catalog_entity_id = sp.catalog_entity_id and e.event = 'plan_ended'
   order by e.id desc limit 1
) ended on true
where sp.status = 'ended'
  and not exists (select 1 from public.investor_firm_seat_plan_archive a where a.catalog_entity_id = sp.catalog_entity_id);
