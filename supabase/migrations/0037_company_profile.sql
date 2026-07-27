-- Company tab redesign — Identity, Team (startup), Round. See
-- prompt_claude_code_company_tab.md. WRITTEN FOR REVIEW — NOT applied.
--
-- Design notes (see inventory in the chat reply):
--   * `stage` (shared enum, also used by entities.stage_min/max) gets a new
--     'other' value + orgs.stage_other companion column, instead of a
--     parallel round_stage field — the Round card's "Estádio" IS orgs.stage.
--   * orgs.sector (existing, single text) is left alone — still read by
--     composer.ts / ReviewOptimizationPanel — the new orgs.sectors (tags)
--     is what the Identity UI actually edits; the app keeps `sector` in
--     sync (sectors.join(', ')) on every save so nothing downstream needs
--     to change.
--   * logo_url holds a Storage PATH in the existing `data-room` bucket
--     (${org_id}/logo/...), not a public URL — resolved to a signed URL at
--     render time, same pattern as document downloads. No new bucket.
--   * EUR-only, no currency column — matches the rest of the app.

alter type stage add value if not exists 'other';

alter table orgs
  -- Identity
  add column if not exists legal_name text,
  add column if not exists logo_url text,
  add column if not exists hq_city text,
  add column if not exists postal_code text,
  add column if not exists founded_year int,
  add column if not exists description text,
  add column if not exists sectors text[] not null default '{}',
  -- Team (startup) headcount rollups — company_people (below) holds the roster
  add column if not exists employee_count int,
  add column if not exists founder_count_override int,
  -- Round
  add column if not exists round_raising boolean,
  add column if not exists round_secured_eur int,
  add column if not exists round_instruments text[] not null default '{}',
  add column if not exists round_instrument_other text,
  add column if not exists round_valuation_eur int,
  add column if not exists round_runway_months int,
  add column if not exists round_target_close_date date,
  add column if not exists round_use_of_funds text,
  add column if not exists round_flexible boolean not null default false,
  add column if not exists round_flexible_note text,
  add column if not exists stage_other text;

create table company_people (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  full_name text not null,
  title text,
  is_founder boolean not null default false,
  linkedin_url text,
  email text,
  bio text,
  photo_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table company_people enable row level security;
create policy company_people_org_members on company_people for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create index on company_people (org_id, sort_order);

-- touch_updated_at() already exists (0001_init.sql).
create trigger company_people_touch before update on company_people
  for each row execute function touch_updated_at();
