-- Prompt 854 §A — the Marketing group's outreach table: startups,
-- accelerators, incubators and programs the platform is courting with an
-- offer, one row per target. The generated promo code lives in promo_codes
-- itself (0040) — this table only ever points at it via promo_code_id, so
-- there is exactly one code registry, not two.
--
-- Deliberately no `joined` status: whether a target actually redeemed its
-- code is a FACT in promo_redemptions, derived and displayed (the back-office
-- page's own "Redeemed" column), never an opinion an admin types into a
-- select. Same reasoning as this codebase's other derived-not-typed states
-- (e.g. relationship stage derivation, derived-stage.ts).
create table promo_outreach_targets (
  id                       uuid primary key default uuid_generate_v4(),
  name                     text not null,
  category                 text not null check (category in ('startup','accelerator','incubator','program')),
  -- The offer this target is being made. Same vocabulary as promo_codes so
  -- the generated code is a straight copy, never a translation.
  kind                     text not null check (kind in ('percent_off','free_trial')),
  discount_pct             int  not null check (discount_pct between 1 and 100),
  applicable_plans         text[] not null default '{}',
  redeemable_until         timestamptz,
  benefit_duration_months  int check (benefit_duration_months is null or benefit_duration_months > 0),
  max_redemptions          int check (max_redemptions is null or max_redemptions > 0),
  website                  text,
  email                    text,
  phone                    text,
  -- Set once, by the generate action. Never a second code for one row.
  promo_code_id            uuid references promo_codes(id),
  status                   text not null default 'to_contact'
                             check (status in ('to_contact','contacted','replied','no_reply','declined')),
  contacted_on             date,
  notes                    text,
  created_at               timestamptz not null default now(),
  created_by               uuid references auth.users(id),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz
);

alter table promo_outreach_targets enable row level security;
create policy promo_outreach_targets_platform_admin on promo_outreach_targets for all
  using (is_platform_admin()) with check (is_platform_admin());

create index on promo_outreach_targets (deleted_at, status);
create index on promo_outreach_targets (promo_code_id) where promo_code_id is not null;
create unique index on promo_outreach_targets (promo_code_id) where promo_code_id is not null;
