-- Prompt 318 — My Network 3/9: referrals with double opt-in, the heart of
-- the feature. Founder A (already invested by investor X) refers startup B
-- (a contact of A's, from the network) to X: B has to accept FIRST — B
-- controls what X ever gets to see — only then does X receive the
-- referral, badged "referred by A, from your portfolio". If X accepts, B
-- enters X's pipeline AND X enters B's pipeline, without spending either
-- side's monthly quota. Investors also refer their own portfolio startups
-- to other investors in their network (same mechanic, target_kind stays
-- 'investor' either way — this table's only supported direction today).
--
-- target_kind is stored (not hardcoded in application code only) because
-- the prompt's own spec calls for the column now, ahead of whatever a
-- later prompt in this series might add as a second target kind — same
-- "declare the value now, no migration needed later" reasoning as 316's
-- context_kind.
create table if not exists network_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_actor_id uuid not null references network_actors(id) on delete cascade,
  referred_org_id uuid not null references orgs(id) on delete cascade,
  target_actor_id uuid not null references network_actors(id) on delete cascade,
  target_kind text not null default 'investor' check (target_kind in ('investor')),
  message text not null,
  state text not null default 'pending_referred_consent' check (state in (
    'pending_referred_consent', 'pending_target_decision', 'accepted', 'declined_by_referred', 'declined_by_target'
  )),
  created_at timestamptz not null default now(),
  referred_decided_at timestamptz,
  target_decided_at timestamptz,
  constraint network_referrals_no_self_target check (referrer_actor_id <> target_actor_id)
);
create index if not exists network_referrals_referrer_idx on network_referrals (referrer_actor_id, created_at);
create index if not exists network_referrals_target_idx on network_referrals (target_actor_id, state);
create index if not exists network_referrals_referred_org_idx on network_referrals (referred_org_id, state);

-- "nunca duplicar uma referência já pending/accepted para o mesmo par
-- (referida, alvo)" — a partial unique index (not a plain unique
-- constraint) so a NEW referral for the same pair is only blocked while an
-- earlier one is still live; once it reaches a genuinely terminal state
-- (declined by either side), a fresh attempt is a normal insert again.
-- Note: 'expired' is deliberately never a value this column actually takes
-- (see the comment above effectiveReferralState in network.ts) — expiry is
-- read-time computed, exactly like 316's invites, so it never needed a slot
-- in this partial index's state list.
create unique index if not exists network_referrals_live_pair_idx
  on network_referrals (referred_org_id, target_actor_id)
  where state in ('pending_referred_consent', 'pending_target_decision', 'accepted');

-- 5 referrals sent per actor per calendar month (network.ts's own
-- MAX_REFERRALS_PER_MONTH) — server-enforced via trigger, not just the UI,
-- same posture as 0209's pending-invite cap. Scarcity is the whole point
-- of the idea (Nuno's own framing), so this one has no "just wait for one
-- to clear" escape valve the way the 5-pending-invite cap does — it resets
-- on the calendar, not on an earlier referral's resolution.
create or replace function public.enforce_network_referral_monthly_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month_start timestamptz := date_trunc('month', now());
  v_count int;
begin
  select count(*) into v_count from public.network_referrals
  where referrer_actor_id = new.referrer_actor_id and created_at >= v_month_start;
  if v_count >= 5 then
    raise exception 'NETWORK_REFERRAL_MONTHLY_CAP_REACHED';
  end if;
  return new;
end;
$$;
create trigger network_referrals_monthly_cap before insert on network_referrals
  for each row execute function public.enforce_network_referral_monthly_cap();
revoke all on function public.enforce_network_referral_monthly_cap() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS. The central guarantee of this whole prompt: the target (X/Z) can
-- NEVER see a row still in 'pending_referred_consent', not even that it
-- exists — this policy is the DB-level backstop, but the actual guarantee
-- this app relies on is the explicit .eq('state', ...) allowlist in
-- network-referrals-db.ts's referralsVisibleToTarget, since every route uses
-- the service-role client, which bypasses RLS entirely. Both layers encode
-- the SAME allowlist on purpose — a real defense in depth, not decoration.
alter table network_referrals enable row level security;

create policy network_referrals_scoped_read on network_referrals
  for select using (
    public.is_my_network_actor(referrer_actor_id)
    or exists (
      select 1 from public.network_actors na
      where na.org_id = network_referrals.referred_org_id and public.is_my_network_actor(na.id)
    )
    or (public.is_my_network_actor(target_actor_id) and state in ('pending_target_decision', 'accepted', 'declined_by_target'))
  );
