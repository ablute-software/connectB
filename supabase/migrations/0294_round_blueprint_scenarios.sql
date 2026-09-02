-- Prompt 534 Phase 1 — Round Blueprint scenarios.
--
-- NUMBERING: 0291 is reserved for renaming 0289_contribute_catalog_person.sql
-- when claude/prompt-512-contribute-people merges (see the ORDERING DEBT note
-- atop 0289_founder_person_contributions.sql); 0292 is taken by
-- guest_link_views on claude/prompt-518-access-request-lifecycle; 0293 is
-- Prompt 533's constraint fix. 0294 is the first genuinely free number.
--
-- WHAT IS STORED, AND WHAT DELIBERATELY IS NOT. Only the INPUTS — the levers
-- the founder set. Every simulated point and marker is recomputed on read by
-- src/lib/round-blueprint.ts. Storing results would create a second, staler
-- answer to "what is my runway", and the first time the two disagreed nobody
-- would know which was current.
--
-- The Ask itself still lives in `orgs`. This table never becomes a second
-- source of truth for round terms: it holds scenarios the founder is exploring,
-- and only an explicit "Apply to my round" writes anything back through
-- /api/org/update, unchanged.
--
-- FOUNDER-ONLY. There is no investor-facing read path to this table anywhere,
-- and none should be added: a scenario is planning, often pessimistic, and is
-- exactly the class of founder-private data CLAUDE.md's root privacy rule
-- keeps off investor surfaces.

create table if not exists public.round_blueprint_scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- Conventionally 'conservative' | 'base' | 'optimistic', but free text: a
  -- founder comparing "with the hire" against "without" should not be forced
  -- into someone else's vocabulary.
  name text not null,
  -- The RunwayInputs object. jsonb rather than columns because these are the
  -- knobs of a simulation, not entities: tranches and burn steps are variable-
  -- length, and a schema change per new lever would be the wrong trade.
  inputs jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists round_blueprint_scenarios_org_idx
  on public.round_blueprint_scenarios (org_id);

alter table public.round_blueprint_scenarios enable row level security;

-- Org members do everything; nobody else sees anything. Split per command
-- rather than one FOR ALL policy so a future read-only role can be given
-- select without inheriting writes.
create policy round_blueprint_scenarios_select on public.round_blueprint_scenarios
  for select using (public.is_org_member(org_id));
create policy round_blueprint_scenarios_insert on public.round_blueprint_scenarios
  for insert with check (public.is_org_member(org_id));
create policy round_blueprint_scenarios_update on public.round_blueprint_scenarios
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy round_blueprint_scenarios_delete on public.round_blueprint_scenarios
  for delete using (public.is_org_member(org_id));

revoke all on public.round_blueprint_scenarios from anon;
