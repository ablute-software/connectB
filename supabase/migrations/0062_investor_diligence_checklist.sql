-- Investor Workspace Tools (prompt 62.6) — diligence checklist per data
-- room section. One row per (org, investor, section), toggled from the
-- section's own UI in the portal. section_key reuses the exact 6 fixed
-- keys from PORTAL_SECTIONS (Prompt 55) rather than a free-text column, so
-- it can never drift out of sync with the actual section list.
create table investor_diligence_checklist (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  investor_email text not null,
  section_key text not null check (section_key = any (array[
    'start_here','product_market','traction_commercial','financial','team_governance','round_terms'
  ])),
  reviewed boolean not null default false,
  reviewed_at timestamptz,
  unique (org_id, investor_email, section_key)
);
alter table investor_diligence_checklist enable row level security;
