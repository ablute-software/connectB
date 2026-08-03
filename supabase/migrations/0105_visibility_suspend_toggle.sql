-- Prompt 107 — owner-controlled Visible/Suspended toggle, startups and
-- investors. §3.2 (already-delivered pipeline rows: disappear vs mark) is
-- resolved by the verification pass's own recommendation: rows STAY,
-- marked "Suspended", never disappear — see B.5 in the app layer.

-- A.1/3.1 — is_visible stops being an input and becomes a computed value.
-- The 0053 comment already reserved it for exactly this ("permitir no
-- futuro suspensão manual... sem mexer no cálculo de completude").
-- owner_suspended_at: written only by the owner-gated toggle route.
-- platform_suspended_at: written only by service-role/admin action (no UI
-- for this yet — reserved for a future backoffice action, per the prompt).
-- suspension_reminded_at: last time the monthly "you're still suspended"
-- reminder was shown to the owner.
alter table public.matchdeal_profiles
  add column owner_suspended_at timestamptz,
  add column platform_suspended_at timestamptz,
  add column suspension_reminded_at timestamptz;

create or replace function public.matchdeal_recompute_profile_completeness() returns trigger
language plpgsql as $$
begin
  if new.kind = 'startup' then
    new.is_complete := (
      new.photo_url is not null and
      new.website is not null and
      array_length(new.sectors, 1) > 0 and
      new.description is not null and
      new.country is not null and
      new.investment_stage_sought is not null and
      new.company_phase is not null
    );
  elsif new.kind = 'investor' then
    new.is_complete := (
      new.representative_name is not null and
      new.entity_name is not null and
      array_length(new.stages_invested, 1) > 0 and
      array_length(new.geographies, 1) > 0 and
      new.country is not null and
      new.website is not null
    );
  end if;

  -- P107 — is_visible is now completeness AND not-suspended (owner or
  -- platform). Application code must never write is_visible directly again.
  new.is_visible := new.is_complete and new.owner_suspended_at is null and new.platform_suspended_at is null;
  new.updated_at := now();
  return new;
end;
$$;

-- A.3 — investors have no owner concept today; confirmed by Nuno
-- (mini-prompt 2026-08-03, "sigo pela recomendação"). Same values as
-- org_role. Backfill: oldest active member per firm becomes owner — the
-- same "oldest active wins" convention portal-access.ts and
-- investor-membership.ts already use, formalized rather than invented.
alter table public.matchdeal_investor_members
  add column role text not null default 'member' check (role in ('owner', 'admin', 'manager', 'member'));

with oldest_active as (
  select distinct on (catalog_entity_id) id
  from public.matchdeal_investor_members
  where status = 'active'
  order by catalog_entity_id, created_at asc
)
update public.matchdeal_investor_members
set role = 'owner'
where id in (select id from oldest_active);

-- B.6 — a suspended investor (owner or platform) is excluded from the
-- catalog ranking entirely, so it never consumes a fresh quota slot while
-- suspended. Already-unlocked rows are untouched (first branch below) —
-- this only affects NOT-yet-unlocked candidates. Ordering and quota
-- arithmetic are otherwise byte-identical to 0042's original.
create or replace function catalog_is_visible(e_id uuid, e_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select true from entities where id = e_id and org_id = e_org and source = 'catalog' and unlocked_at is not null),
    (
      select rn <= remaining
      from (
        select id,
               row_number() over (
                 order by coalesce(wave, 999), fit_rank(fit_score), created_at, id
               ) as rn,
               greatest(0, plan_catalog_quota(e_org) - (
                 select count(*) from entities where org_id = e_org and source = 'catalog' and unlocked_at is not null
               )) as remaining
        from entities
        where org_id = e_org and source = 'catalog' and unlocked_at is null
          and not exists (
            select 1 from catalog_deliveries cd
            join matchdeal_investor_members mim on mim.catalog_entity_id = cd.catalog_id
            join matchdeal_profiles mp on mp.membership_id = mim.id and mp.kind = 'investor'
            where cd.org_id = e_org and cd.entity_id = entities.id
              and (mp.owner_suspended_at is not null or mp.platform_suspended_at is not null)
          )
      ) candidates
      where id = e_id
    ),
    false
  );
$$;
