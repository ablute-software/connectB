-- Prompt 153 — wires the investor plan's monthlyCap (10/22/46, plans.ts)
-- into the Pipeline for the first time. Confirmed before writing this:
-- getPipelineWaves() (investor-pipeline.ts) never read plan_tier/monthlyCap
-- anywhere — WAVE_SIZE=8 was a flat constant, identical for every plan.
--
-- Coexistence model (confirmed with Nuno, not the simpler "WAVE_SIZE =
-- monthlyCap" alternative): monthlyCap limits how many NEW org candidates
-- are ever admitted into a given investor firm's discovery pool per
-- calendar month; WAVE_SIZE continues to control how many of the admitted
-- set are shown at once (existing "next wave unlocks once the current
-- one's fully decided" rule, untouched).
--
-- This table is the reason the coexistence model needs a migration at all:
-- "how many NEW entities this month" requires knowing WHEN each candidate
-- was first admitted, which nothing in this schema tracked before —
-- discoveryCards was (and still is) recomputed live, from scratch, on
-- every single call.
--
-- Keyed by investor_catalog_entity_id (the FIRM), not
-- matchdeal_investor_members.id (the per-seat row): monthlyCap is a
-- per-plan, per-firm quota (seats share it), and every other pipeline-wide
-- concept in this file (investor_relationship_decisions) already scopes
-- to catalog_entity_id for the same reason — "any teammate's decision must
-- show the same status to every other teammate."
create table public.investor_pipeline_admissions (
  id uuid primary key default gen_random_uuid(),
  investor_catalog_entity_id uuid not null references public.catalog_entities(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  admitted_at timestamptz not null default now(),
  unique (investor_catalog_entity_id, org_id)
);

alter table public.investor_pipeline_admissions enable row level security;
-- No policies — every reader/writer of this table is getPipelineWaves()
-- and its callers, all service-role (bypasses RLS by role, not by any
-- policy here). Locked to anon/authenticated by default, same as this
-- project's other internal-bookkeeping tables (e.g. promo_redemptions,
-- migration 0040's own header note).

create index investor_pipeline_admissions_entity_month_idx
  on public.investor_pipeline_admissions (investor_catalog_entity_id, admitted_at);
