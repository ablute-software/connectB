-- IRM_SPEC §1a/§1b — authored contributions + back-office verification queue.
-- subject_id is a polymorphic reference (entities.id or people.id depending
-- on subject_type) — no FK possible across two tables, left as a plain uuid.

create type contribution_subject as enum ('entity', 'person');
create type contribution_status as enum ('submitted', 'verified', 'rejected');

create table contributions (
  id uuid primary key default uuid_generate_v4(),
  subject_type contribution_subject not null,
  subject_id uuid not null,
  org_id uuid not null references orgs(id) on delete cascade,
  author_user_id uuid references auth.users(id),
  field text not null,
  value jsonb not null,
  note text,
  status contribution_status not null default 'submitted',
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewer_notes text
);

alter table contributions enable row level security;

-- Org members see + create their own org's contributions; platform admins
-- see everything (needed for §1b's cross-org aggregation) but write only
-- through the service-role back-office API routes, not directly.
create policy contributions_select on contributions for select
  using (is_org_member(org_id) or is_platform_admin());
create policy contributions_insert on contributions for insert
  with check (is_org_member(org_id));

create index on contributions (org_id, subject_type, subject_id);
create index on contributions (status, created_at);
