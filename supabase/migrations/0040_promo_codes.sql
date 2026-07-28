-- Promo Codes & Offers. Two tables: the promo definition (back-office
-- authored) and one row per org that redeemed it. RLS locked to
-- platform_admin only (same shape as support_tickets/investor_access_requests,
-- 0036/0039) — every write, from either side (back-office creating a promo,
-- a founder redeeming a code), goes through the service role in a route, not
-- as the calling client directly.
--
-- Design notes, since several fields map loosely onto the spec's Portuguese:
--   - `kind`: the "tipo" dropdown. Two values — 'percent_off' (the general
--     case, 1-99%) and 'free_trial' (the "inclui total oferta" case, a 100%
--     discount for a fixed period). Modelled as the SAME discount mechanism
--     under the hood (both just set discount_pct + benefit_duration_months);
--     free_trial exists as its own label because "3 months free" reads
--     better in the UI than "100% off for 3 months", even though they
--     compute identically. The app locks discount_pct to 100 whenever
--     kind='free_trial'.
--   - `redeemable_until`: "quanto tempo a promoção ficará ativa / até quando
--     pode ser ativada" — the deadline for a user to REDEEM the code. Null
--     means no deadline (only the `active` flag gates it).
--   - `benefit_duration_months`: "por quanto tempo é essa promoção" — how
--     long the discount lasts once a given org redeems it (e.g. 3 months of
--     50% off, then the org reverts to full price). Null means the discount
--     never expires once redeemed (a permanent price change).
--   - `max_redemptions`: "nº limite de integrantes". Null = unlimited.
--   - `active`: the standalone deactivate switch, distinct from delete.
--   - `deleted_at`: soft delete ("eliminar/retirar a promoção") — kept for
--     audit rather than a hard DELETE, same convention as access_grants.
--     revoked_at, matchdeal_device_links.used_at, etc. elsewhere in this
--     schema. A deleted promo can no longer be redeemed but its history
--     (who already redeemed it, and their still-running benefit) is
--     unaffected — deleting the promo does not revoke existing redemptions.
--   - `applicable_plans`: only 'garage'/'motherfunding' are meaningful here
--     (idea is already free) — enforced in the API route, not a DB check
--     constraint, so the plan tier list only has to live in plans.ts.

create table promo_codes (
  id                       uuid primary key default uuid_generate_v4(),
  code                     text not null unique,
  label                    text,
  kind                     text not null check (kind in ('percent_off', 'free_trial')),
  discount_pct             int not null check (discount_pct between 1 and 100),
  applicable_plans         text[] not null,
  redeemable_until         timestamptz,
  benefit_duration_months  int check (benefit_duration_months is null or benefit_duration_months > 0),
  max_redemptions          int check (max_redemptions is null or max_redemptions > 0),
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  created_by               uuid references auth.users(id),
  deleted_at               timestamptz
);

create table promo_redemptions (
  id                uuid primary key default uuid_generate_v4(),
  promo_code_id     uuid not null references promo_codes(id) on delete cascade,
  org_id            uuid not null references orgs(id) on delete cascade,
  redeemed_by       uuid references auth.users(id),
  redeemed_at       timestamptz not null default now(),
  benefit_ends_at   timestamptz,
  unique (promo_code_id, org_id)
);

alter table promo_codes enable row level security;
alter table promo_redemptions enable row level security;

create policy promo_codes_platform_admin on promo_codes for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy promo_redemptions_platform_admin on promo_redemptions for all
  using (is_platform_admin()) with check (is_platform_admin());

create index on promo_codes (active, deleted_at);
create index on promo_redemptions (promo_code_id);
create index on promo_redemptions (org_id);
