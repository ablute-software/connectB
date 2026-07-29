-- Investor Workspace Fase 1 — Zona 1 snapshot (prompt 54).
--
-- Almost everything Zona 1 needs already exists on `orgs` from the Company
-- tab redesign (0037): one_liner, stage, sectors, hq_city, country,
-- round_target_eur, round_secured_eur, round_instruments, round_valuation_eur,
-- round_runway_months, round_target_close_date, round_use_of_funds. Only
-- two round facts were genuinely missing (min ticket, post-round runway —
-- 0037 only ever asked for pre-round runway) and traction metrics didn't
-- exist at all. use_of_funds stays a free-text column, not restructured
-- into bullets — the founder types line breaks, the portal card renders
-- each line as a bullet; not worth a new shape for that.
alter table orgs
  add column if not exists round_min_ticket_eur int,
  add column if not exists round_runway_post_months int;

-- Same shape as company_people (0037): small ordered child table,
-- founder-editable, org-scoped RLS. A jsonb column on orgs would work too
-- but loses per-row RLS/indexing for no real benefit at this size.
create table org_traction_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  label text not null,
  value text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table org_traction_metrics enable row level security;
create policy org_traction_metrics_org_members on org_traction_metrics for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create index on org_traction_metrics (org_id, sort_order);

-- touch_updated_at() already exists (0001_init.sql).
create trigger org_traction_metrics_touch before update on org_traction_metrics
  for each row execute function touch_updated_at();
