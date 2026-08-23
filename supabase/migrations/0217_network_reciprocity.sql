-- Prompt 323 — My Network 8/9: reciprocity. Office hours (network_offers/
-- network_offer_claims) and reverse scout (network_scout_requests) get
-- their own tables — not folded into network_posts' `kind` column, unlike
-- 322's structured updates — because slot claiming needs real atomic
-- read-modify-write semantics (network_claim_offer_slot below) that an
-- immutable, soft-deletable post was never built for. They still reuse
-- everything else this series already has: the same actor/connection
-- identity, the same anti-sales linter (applied to description text
-- server-side, same as every other free-text surface), the same
-- network_suspended_at gate.
create table if not exists network_offers (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references network_actors(id) on delete cascade,
  kind text not null check (kind in ('deck_review', 'intro', 'advice', 'other')),
  description text not null check (char_length(description) between 1 and 1000),
  slots_total integer not null check (slots_total between 1 and 20),
  slots_claimed integer not null default 0 check (slots_claimed >= 0 and slots_claimed <= slots_total),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists network_offers_actor_idx on network_offers (actor_id, created_at);

create table if not exists network_offer_claims (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references network_offers(id) on delete cascade,
  claimant_actor_id uuid not null references network_actors(id) on delete cascade,
  note text check (note is null or char_length(note) <= 500),
  claimed_at timestamptz not null default now(),
  unique (offer_id, claimant_actor_id)
);
create index if not exists network_offer_claims_offer_idx on network_offer_claims (offer_id);

-- The real atomicity guarantee (Pedido A: "não permite passar de
-- slots_total" under concurrent claims): SELECT … FOR UPDATE locks the
-- offer row for the duration of the transaction, so two simultaneous
-- claims on the last open slot serialize instead of racing — a
-- read-then-write from the client (check slots_claimed, then insert) is
-- exactly the TOCTOU race this avoids. Returns a short status string
-- ('ok' | 'not_found' | 'expired' | 'already_claimed' | 'full') rather than
-- raising, since "the offer is full" is an ordinary, expected outcome here,
-- not an exceptional one.
create or replace function public.network_claim_offer_slot(p_offer_id uuid, p_claimant_actor_id uuid, p_note text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer record;
begin
  select * into v_offer from public.network_offers where id = p_offer_id for update;
  if not found then return 'not_found'; end if;
  if v_offer.expires_at <= now() then return 'expired'; end if;
  if exists (select 1 from public.network_offer_claims where offer_id = p_offer_id and claimant_actor_id = p_claimant_actor_id) then
    return 'already_claimed';
  end if;
  if v_offer.slots_claimed >= v_offer.slots_total then return 'full'; end if;

  update public.network_offers set slots_claimed = slots_claimed + 1 where id = p_offer_id;
  insert into public.network_offer_claims (offer_id, claimant_actor_id, note) values (p_offer_id, p_claimant_actor_id, p_note);
  return 'ok';
end;
$$;
-- Trigger-like function called directly by the app (not from a trigger) —
-- still revoked from public/anon/authenticated: the API route is the only
-- intended caller, using the service-role client, same posture as every
-- other privileged function in this series that isn't an RLS helper.
revoke all on function public.network_claim_offer_slot(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
create table if not exists network_scout_requests (
  id uuid primary key default gen_random_uuid(),
  investor_actor_id uuid not null references network_actors(id) on delete cascade,
  sectors text[] not null default '{}',
  stage text,
  geography text,
  description text not null check (char_length(description) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'closed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists network_scout_requests_investor_idx on network_scout_requests (investor_actor_id, created_at);

-- Pedido B — "3 referrals recebidos através deste pedido": an optional,
-- additive link back to the referral it originated from. Nullable — every
-- referral created through 318's normal flow (shared-investor context, not
-- a scout request) leaves this null.
alter table network_referrals add column if not exists originating_scout_request_id uuid references network_scout_requests(id) on delete set null;
create index if not exists network_referrals_scout_request_idx on network_referrals (originating_scout_request_id);

-- ---------------------------------------------------------------------------
-- RLS. network_offers/network_scout_requests are each visible to the
-- author/investor themselves plus their own active connections — NEVER a
-- platform-wide broadcast (Pedido B's explicit requirement for scout
-- requests; applied identically to offers for the same reason). Mirrors
-- network_posts_visible_read's target='all' branch (0215) minus the
-- exclusion feature, which neither of these tables has.
alter table network_offers enable row level security;
alter table network_offer_claims enable row level security;
alter table network_scout_requests enable row level security;

create policy network_offers_visible_read on network_offers for select using (
  public.is_my_network_actor(actor_id)
  or exists (
    select 1 from public.network_connections nc
    join public.network_actors viewer on (
      (nc.actor_low_id = network_offers.actor_id and nc.actor_high_id = viewer.id)
      or (nc.actor_high_id = network_offers.actor_id and nc.actor_low_id = viewer.id)
    )
    where nc.status = 'active' and public.is_my_network_actor(viewer.id)
  )
);

create policy network_offer_claims_participant_read on network_offer_claims for select using (
  public.is_my_network_actor(claimant_actor_id)
  or exists (select 1 from public.network_offers o where o.id = offer_id and public.is_my_network_actor(o.actor_id))
);

create policy network_scout_requests_visible_read on network_scout_requests for select using (
  public.is_my_network_actor(investor_actor_id)
  or exists (
    select 1 from public.network_connections nc
    join public.network_actors viewer on (
      (nc.actor_low_id = network_scout_requests.investor_actor_id and nc.actor_high_id = viewer.id)
      or (nc.actor_high_id = network_scout_requests.investor_actor_id and nc.actor_low_id = viewer.id)
    )
    where nc.status = 'active' and public.is_my_network_actor(viewer.id)
  )
);
