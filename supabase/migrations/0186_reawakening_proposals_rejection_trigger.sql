-- Prompt 251/253 Bloco B — feed the EXISTING reawakening_proposals queue
-- (migration 0030) from a second trigger: a deterministic rejection_codes
-- comparison, not just a confirmed company_fact. Not a second parallel
-- queue — 251 was explicit that this must feed the queue that already
-- exists (ReawakeningQueue.tsx/approveReawakening already do everything
-- needed downstream: agenda task, entity reactivation, dedup by row).
--
-- fact_id was NOT NULL — a code-triggered proposal has no company_fact at
-- all (the trigger can be the INVESTOR editing their own thesis fields,
-- entities.stage_min/stage_max/sectors/invests_in_geographies, per the 253
-- addendum). rejection_code_id is the alternate anchor; the XOR check
-- keeps every row traceable to exactly one trigger, never both/neither.
-- unique(fact_id, entity_id) still stands for the fact-triggered path
-- (unaffected: NULLs never collide against each other in a unique
-- constraint) — the new partial unique index is the code-triggered path's
-- own dedup, one lifetime proposal per rejection_code.
alter table reawakening_proposals alter column fact_id drop not null;
alter table reawakening_proposals add column rejection_code_id uuid references rejection_codes(id) on delete cascade;
alter table reawakening_proposals add constraint reawakening_proposals_trigger_xor
  check ((fact_id is not null) <> (rejection_code_id is not null));
create unique index reawakening_proposals_rejection_code_unique on reawakening_proposals (rejection_code_id) where rejection_code_id is not null;

-- The fact-triggered path only ever inserts server-side (/api/reawakening/
-- evaluate, service-role, because it also drives the AI call). The
-- code-triggered path is deterministic — zero AI, per 251/253 — and safe
-- for a founder to insert directly into their OWN org's queue (no
-- cross-tenant exposure, it's their own pipeline data): adding INSERT for
-- org members is what lets both store providers (demo AND Supabase) call
-- the exact same client-side comparison function without a new API route.
create policy reawakening_proposals_insert on reawakening_proposals
  for insert with check (is_org_member(org_id));
