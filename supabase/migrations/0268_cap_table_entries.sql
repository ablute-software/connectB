-- Prompt 422 §A — structured cap table data. "Cap table" existed only as a
-- recognized DOCUMENT TYPE before this (vault-strength.ts) — a PDF the
-- founder could upload, never data the app could draw a chart from. The
-- document keeps existing separately, as complementary evidence, not a
-- substitute for these rows.
--
-- Multiple rows per category are normal (several founders, several named
-- investors) — option_pool/adviser are typically one row each but the
-- model doesn't enforce that.
create table public.cap_table_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  category text not null check (category in ('founder', 'option_pool', 'adviser', 'investor')),
  label text not null,
  pct numeric not null check (pct >= 0 and pct <= 100),
  as_of date not null default current_date,
  updated_at timestamptz not null default now()
);

create index cap_table_entries_org_idx on public.cap_table_entries (org_id);

alter table public.cap_table_entries enable row level security;
-- Same generic org-scoped policy every founder-only CRM table uses
-- (0001_init.sql's own policy loop).
create policy cap_table_entries_all on public.cap_table_entries for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));
