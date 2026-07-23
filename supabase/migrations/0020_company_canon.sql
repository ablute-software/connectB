-- IRM_SPEC §11 — COMPANY CANON: the org's verified-truth archive. Founder
-- decision (23 Jul) after a real incident: the composer invented a
-- technical claim, a wrong date, and an unverified vendor detail in a real
-- outreach draft. company_facts is private, org-scoped truth the composer
-- must ground every claim in — never promoted to the shared catalog.
--
-- Pushed ahead of app-code review (overnight block) so it's ready for
-- morning application. All app code that depends on this table capability-
-- checks for its existence first and behaves exactly as it did before this
-- migration until the founder confirms it's applied — see
-- src/lib/company-canon.ts's capability probe.

create type company_fact_category as enum
  ('product','traction','team','positioning','financing','regulatory','market','metrics','other');
create type company_fact_status as enum ('confirmed','unconfirmed','deprecated');
create type company_fact_source as enum ('user','import','ai_extracted');

create table company_facts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  category company_fact_category not null default 'other',
  statement text not null,
  status company_fact_status not null default 'unconfirmed',
  source company_fact_source not null default 'user',
  source_ref text,
  valid_from date,
  -- Temporal rule: facts are never deleted, only superseded. The delta
  -- between a deprecated fact and its successor IS the re-approach
  -- argument (e.g. health/hardware -> wellness/biosphere) — see §11c.
  superseded_by uuid references company_facts(id) on delete set null,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table company_facts enable row level security;
create policy company_facts_all on company_facts for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create index on company_facts (org_id, status);
create index on company_facts (org_id, category);
create index on company_facts (superseded_by);

-- §11d misalignment alert — verdict + reasons live on the entity row itself
-- (assessed on demand, before generation), not a separate table: it's a
-- point-in-time read of entity-vs-canon, not history worth keeping forever.
create type entity_alignment_status as enum ('aligned','caution','misaligned');
alter table entities add column if not exists alignment_status entity_alignment_status;
alter table entities add column if not exists alignment_notes text;
alter table entities add column if not exists alignment_assessed_at timestamptz;
