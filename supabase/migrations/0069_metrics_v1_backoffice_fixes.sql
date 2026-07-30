-- SherlockDeal_Metricas_BackOffice_V1, Section 1 — general backoffice fixes.
-- Two pieces:
--
-- 1. catalog_entities.geographies — the spec asks the Catalog list to show
--    "geografias abrangidas" (geographies an investor covers), a materially
--    different concept from hq_city/hq_country (where the entity is based).
--    No such column existed. Nullable text[], same shape as sectors.
--
-- 2. admin_org_actions — the generic benefit/action log the spec asks for
--    in Section 1.2 (discount, extension, pack/feature unlock, flag for
--    commercial contact) AND, unchanged, the exact same shape Section 12.3
--    (Organizations tab, a later phase) describes: "organização, tipo de
--    ação, data de início, data de fim, valor ou benefício, motivo, estado
--    e utilizador interno". Built once, to that shape, so the Organizations
--    tab doesn't need a second table later. org_type/org_ref_id is
--    polymorphic on purpose: startups are orgs.id, investors are
--    catalog_entities.id — there is no single "organizations" table this
--    schema shares between the two sides.
create table if not exists admin_org_actions (
  id uuid primary key default gen_random_uuid(),
  org_type text not null check (org_type in ('startup', 'investor')),
  org_ref_id uuid not null,
  action_type text not null check (action_type in (
    'discount', 'extension', 'pack_unlock', 'feature_unlock', 'flag_commercial_contact', 'other'
  )),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  value text,
  reason text not null,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists admin_org_actions_org_idx on admin_org_actions (org_type, org_ref_id);

alter table catalog_entities add column if not exists geographies text[];
