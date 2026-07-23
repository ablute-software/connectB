-- F — fact-triggered reawakening. When a canon fact is CONFIRMED (the only
-- trigger — there is no cron / periodic scan anywhere), dormant/passed entities
-- carrying a reopen_trigger are mechanically shortlisted and judged by ONE
-- batched AI call. Every evaluated (fact_id, entity_id) pair gets exactly one
-- row here (the unique constraint IS the "already evaluated" dedup):
--   reopens = true  → status 'pending'   (surfaced in the Pipeline queue)
--   reopens = false → status 'dismissed' (evaluated, never re-proposed)
-- Approve → status 'approved' (+ entity back to active + agenda task, done in
-- the app). Reject → status 'rejected' (pair stays evaluated).
--
-- Rows are INSERTED by the service-role route (/api/reawakening/evaluate) after
-- a membership check; members read + resolve their own org's rows via RLS.
-- Additive, capability-gated (src/lib/reawakening-capability.ts).
create table reawakening_proposals (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  fact_id uuid not null references company_facts(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  reopens boolean not null,
  rationale text,
  suggested_wave int,
  suggested_fit text,
  prior_pass_reason text,
  prior_pass_category text,
  fact_statement text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (fact_id, entity_id)
);

alter table reawakening_proposals enable row level security;
create policy reawakening_proposals_select on reawakening_proposals for select using (is_org_member(org_id));
create policy reawakening_proposals_update on reawakening_proposals for update using (is_org_member(org_id)) with check (is_org_member(org_id));

create index on reawakening_proposals (org_id, status);
create index on reawakening_proposals (fact_id);
