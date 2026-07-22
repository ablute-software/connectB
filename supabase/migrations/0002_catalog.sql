-- v3: platform catalog, packs, back-office (two-layer architecture)
-- Layer 1: platform-owned catalog (no org_id — global, admin-managed)
-- Layer 2: per-org CRM (0001) — pack unlocks copy verified catalog entries into entities.

create type catalog_verification as enum ('verified','pending','rejected');
create type submission_status as enum ('pending_review','approved','rejected','merged');
create type platform_role as enum ('admin','support');

-- Platform staff (developers). Separate from org_members on purpose.
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role platform_role not null default 'admin'
);

create or replace function is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create table catalog_entities (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  type entity_type not null,
  hq_city text, hq_country text,
  sectors text[] default '{}',
  stage_min stage, stage_max stage,
  check_min_eur int, check_max_eur int,
  thesis text, website text,
  verification_status catalog_verification not null default 'pending',
  verified_at timestamptz, verified_by uuid references auth.users(id),
  source text not null default 'team', -- 'team' | 'user_submission'
  notes text,
  created_at timestamptz not null default now()
);

create table packs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  price_eur int not null default 0,  -- charged via Stripe later; free during development
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table pack_items (
  pack_id uuid not null references packs(id) on delete cascade,
  catalog_id uuid not null references catalog_entities(id) on delete cascade,
  primary key (pack_id, catalog_id)
);

create table pack_unlocks (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  pack_id uuid not null references packs(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  paid boolean not null default false,
  unique (org_id, pack_id)
);

-- One row per catalog investor delivered to an org — THE anti-duplication ledger.
create table catalog_deliveries (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  catalog_id uuid not null references catalog_entities(id) on delete cascade,
  entity_id uuid references entities(id) on delete set null, -- the org-side copy
  via_pack uuid references packs(id),
  delivered_at timestamptz not null default now(),
  unique (org_id, catalog_id)  -- an investor is never delivered twice to the same org
);

create table investor_submissions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  payload jsonb not null,               -- name, type, hq, sectors, website, notes
  status submission_status not null default 'pending_review',
  reviewer_notes text,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  merged_catalog_id uuid references catalog_entities(id)
);

-- ===== RLS =====
alter table platform_admins enable row level security;
alter table catalog_entities enable row level security;
alter table packs enable row level security;
alter table pack_items enable row level security;
alter table pack_unlocks enable row level security;
alter table catalog_deliveries enable row level security;
alter table investor_submissions enable row level security;

create policy admins_self on platform_admins for select using (user_id = auth.uid() or is_platform_admin());

-- Catalog: founders may browse only VERIFIED entries (to preview packs); admins see all.
create policy catalog_read on catalog_entities for select
  using (verification_status = 'verified' or is_platform_admin());
create policy catalog_admin_write on catalog_entities for all
  using (is_platform_admin()) with check (is_platform_admin());

create policy packs_read on packs for select using (active or is_platform_admin());
create policy packs_admin on packs for all using (is_platform_admin()) with check (is_platform_admin());
create policy pack_items_read on pack_items for select using (true);
create policy pack_items_admin on pack_items for all using (is_platform_admin()) with check (is_platform_admin());

create policy unlocks_org on pack_unlocks for all
  using (is_org_member(org_id) or is_platform_admin())
  with check (is_org_member(org_id) or is_platform_admin());

create policy deliveries_read on catalog_deliveries for select
  using (is_org_member(org_id) or is_platform_admin());
create policy deliveries_admin on catalog_deliveries for insert with check (is_platform_admin() or is_org_member(org_id));

create policy submissions_org on investor_submissions for select
  using (is_org_member(org_id) or is_platform_admin());
create policy submissions_insert on investor_submissions for insert
  with check (is_org_member(org_id));
create policy submissions_admin_update on investor_submissions for update
  using (is_platform_admin());

create index on catalog_deliveries (org_id, catalog_id);
create index on investor_submissions (status, created_at);
