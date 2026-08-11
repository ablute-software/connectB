-- Prompt 167 — the Company tab's roadmap: a horizontal timeline of
-- founder-written milestones, one row per period (a quarter or a whole
-- year). The founding node itself is NOT stored here — it's always derived
-- from orgs.founded_year (already exists, IdentityCard.tsx) and drawn as a
-- fixed, non-editable starting point, so there's nothing to migrate or
-- backfill for it.
--
-- Same org-scoped RLS pattern as company_facts (0020) and
-- org_traction_metrics (0054): full CRUD for any org member, not
-- read-only-plus-service-role like review_runs — a roadmap is 100%
-- hand-written by the startup (Nuno's own decision, §"Não incluído aqui"),
-- so there's no AI-authored content here needing the extra caution SWOT/
-- clarifications' writes have.
--
-- period_quarter is null exactly when period_kind='year' — enforced by the
-- check constraint below, not left to application code alone. Sort key is
-- (period_year, quarter_sort) where quarter_sort is 0 for 'year' (an
-- annual milestone reads as that year's headline goal, sorted before that
-- same year's quarterly detail — Nuno's own decision) and the literal
-- quarter number (1-4) otherwise; computed in the app layer at read time,
-- not stored, since it's fully derived from period_kind/period_quarter.
--
-- PROPOSTA, NAO APLICADA — esta sessao nao aplica as proprias migracoes
-- (same discipline as every migration since 0158).
create table public.company_roadmap_milestones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  period_kind text not null check (period_kind in ('quarter', 'year')),
  period_year int not null check (period_year between 2000 and 2100),
  period_quarter int check (period_quarter between 1 and 4),
  items text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_roadmap_milestones_quarter_shape check (
    (period_kind = 'year' and period_quarter is null)
    or (period_kind = 'quarter' and period_quarter is not null)
  )
);
create index company_roadmap_milestones_org_idx on public.company_roadmap_milestones (org_id, period_year, period_quarter);

alter table public.company_roadmap_milestones enable row level security;
create policy company_roadmap_milestones_org_members on public.company_roadmap_milestones for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- touch_updated_at() already exists (0001_init.sql), same trigger every
-- other founder-editable child table (org_traction_metrics, 0054) uses.
create trigger company_roadmap_milestones_touch before update on public.company_roadmap_milestones
  for each row execute function touch_updated_at();

-- Prompt 167 §C — investor-facing visibility toggle, same shape/default as
-- swot_visible_to_investors (0159): opt-out, not opt-in, per Nuno's own
-- "por omissao ligada" for this tickbox too.
alter table public.orgs
  add column roadmap_visible_to_investors boolean not null default true;
