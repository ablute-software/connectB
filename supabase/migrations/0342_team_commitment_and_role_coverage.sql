-- Prompt 613 §F and §E — how much of each person this company has, and which
-- functions are covered by whom.
--
-- §F: `commitment` is NULLABLE and has NO default, deliberately. Defaulting
-- it to full_time would be inventing a fact about a real person, and it is
-- the one fact on this table an investor is certain to test. Null means
-- "nobody has answered", which is exactly what it is.
alter table public.company_people add column if not exists commitment text
  check (commitment is null or commitment in ('full_time', 'part_time'));

-- §E.4 — "duas saídas e não uma": an uncovered function can be ASSIGNED to
-- someone already on the team, or marked as a hire. The second is what makes
-- this a product rather than a telling-off — "hiring: finance" is a normal,
-- credible sentence for a seed company and says more to an investor than
-- silence.
--
-- role_key is free text against the RoleKey union in team-composition.ts
-- rather than a CHECK: that list is derived per company from sector and
-- stage and will grow, and a constraint here would mean a migration every
-- time a sector rule is added. The reader validates.
create table if not exists public.company_role_coverage (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  role_key text not null,
  -- Exactly one of these two is the answer. Both null is a row that says
  -- nothing and is deleted rather than stored.
  person_id uuid references public.company_people(id) on delete cascade,
  hiring boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_role_coverage_has_an_answer check (person_id is not null or hiring)
);

create unique index if not exists company_role_coverage_org_role_uniq
  on public.company_role_coverage (org_id, role_key);

drop trigger if exists company_role_coverage_touch on public.company_role_coverage;
create trigger company_role_coverage_touch before update on public.company_role_coverage
  for each row execute function public.touch_updated_at();

alter table public.company_role_coverage enable row level security;

-- The founder's own answer about their own team: members read and write it
-- directly, same shape as company_people's own policies. Platform admins
-- read it (the back-office account view), never write it — this is the
-- founder's statement about their own company, not ours.
drop policy if exists company_role_coverage_read on public.company_role_coverage;
create policy company_role_coverage_read on public.company_role_coverage
  for select using (public.is_org_member(org_id) or public.is_platform_admin());

drop policy if exists company_role_coverage_write on public.company_role_coverage;
create policy company_role_coverage_write on public.company_role_coverage
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
