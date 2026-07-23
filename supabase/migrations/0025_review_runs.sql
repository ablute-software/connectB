-- Batch 3 A / IRM_SPEC §11f (partial) — Review & Optimization: an
-- investability ranking (readiness vs round value) the founder runs on
-- demand, stored per run so the evolution is visible over time. Consumes
-- confirmed canon facts + pipeline stats; the model returns a structured
-- report (score + strengths/weaknesses/risks/recommendations).
--
-- Additive/nullable, capability-gated (src/lib/review-capability.ts) like
-- every prior migration — the Run-review UI stays inert until this is
-- confirmed applied. Rows are only ever inserted by the service-role route
-- (/api/review/investability) after a membership check; members can read
-- their own org's runs via RLS.
create table review_runs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  score int,
  summary text,
  report jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table review_runs enable row level security;
create policy review_runs_select on review_runs for select using (is_org_member(org_id));

create index on review_runs (org_id, created_at desc);
