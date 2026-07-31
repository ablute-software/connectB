-- Prompt 85 Correction 1 — three fields the "About [company]" (Company)
-- panel had no place to fill: Current phase (product/company maturity —
-- deliberately a NEW enum, not a reuse of orgs.stage, which is the funding
-- round's stage; the two are genuinely different questions, per the
-- prompt's own explicit warning), Revenue, and Primary contact (a real
-- foreign key into company_people, not a free-text field like
-- matchdeal_profiles.contact turned out to be — that's exactly the
-- mistake this prompt asked not to repeat).
alter table orgs
  add column if not exists current_phase text
    check (current_phase is null or current_phase in ('concept_idea', 'prototype', 'pilot', 'launch_early_adopters', 'growth')),
  add column if not exists revenue_eur numeric,
  add column if not exists primary_contact_person_id uuid references company_people(id) on delete set null;
