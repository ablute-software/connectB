-- Prompt 703 §4 — Nuno asked for "Grant…" on the Investors list to write
-- into platform_badges "with the right org_id", mirroring the Startups
-- table's own control exactly. Checked before building: platform_badges.org_id
-- is a strict `references public.orgs(id)` (migration 0337) — it cannot
-- hold a catalog_entities.id, and platform-badges-server.ts's own grant/
-- revoke/lapse-sweep logic is entirely founder-org-shaped (Stripe
-- subscription lookups via orgs.stripe_subscription_id, founder `tasks`,
-- owner emails via org_members) — none of it resolves an investor identity.
-- Relaxing that FK or overloading the same table would mean either a
-- nullable-both-columns polymorphic mess on a table with real production
-- rows, or teaching every one of those founder-specific readers to branch
-- on which kind of id they got. A parallel table, scoped to exactly what
-- this prompt asks for (grant/revoke + a justification, no Stripe coupon
-- application, no tech-master lapse-sweep — none of that was requested for
-- investors and none of it has an investor-side equivalent to hang it on
-- today), is the smaller and safer change.
create table if not exists public.investor_platform_badges (
  id uuid primary key default uuid_generate_v4(),
  catalog_entity_id uuid not null references public.catalog_entities(id) on delete cascade,
  badge text not null check (badge in ('tech_master', 'pioneer')),
  granted_at timestamptz not null default now(),
  -- null = the system, same convention as platform_badges.granted_by /
  -- admin_audit_log.admin_user_id.
  granted_by uuid,
  justification text not null,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamptz not null default now()
);

-- One ACTIVE row per (catalog_entity, badge); revoked rows stay as history —
-- same shape as platform_badges_active_uniq.
create unique index if not exists investor_platform_badges_active_uniq
  on public.investor_platform_badges (catalog_entity_id, badge) where revoked_at is null;
create index if not exists investor_platform_badges_entity_idx
  on public.investor_platform_badges (catalog_entity_id);

alter table public.investor_platform_badges enable row level security;

-- Same bar as platform_badges (§C there: "isto dá direitos que valem
-- dinheiro" applies here too, even with no Stripe side-effect yet) — no
-- insert/update/delete policy at all; every write goes through the service
-- role behind requirePlatformAdmin() and lands in admin_audit_log.
drop policy if exists investor_platform_badges_read on public.investor_platform_badges;
create policy investor_platform_badges_read on public.investor_platform_badges
  for select using (public.is_platform_admin());

comment on table public.investor_platform_badges is
  'Tech master / pioneer cohort badges for investor firms (catalog_entities), granted by hand in Back-office -> Investors. Parallel to platform_badges (orgs) rather than sharing it: platform_badges.org_id is FK''d strictly to orgs, and its own grant/revoke logic (Stripe coupons, tech-master lapse sweep) is founder-specific throughout. This table intentionally has neither — Prompt 703 asked only for the grant/revoke control, not billing integration or lapse tracking for investors.';
