-- AP-06..16 (Pipeline Interested/Pass) — the decision is per ORGANIZATION
-- (AP-14: "associada à organização investidora, não ao utilizador
-- individual"), not per matchdeal_profiles row. That distinction matters:
-- matchdeal_swipes (the existing Interest/Pass mechanism, Prompt 58/60)
-- is keyed by actor_profile_id, which is PER TEAM MEMBER — two people
-- from the same investor firm get two different matchdeal_profiles rows
-- (via two different matchdeal_investor_members rows), so it can't
-- enforce "the org decided once" on its own. This new table is org-scoped
-- from the start, with a UNIQUE constraint doing the actual race-safety
-- work AP-14's "duas pessoas... não conseguem submeter decisões
-- diferentes ao mesmo tempo" test requires — checked at the database
-- level via INSERT ... ON CONFLICT DO NOTHING, not an
-- application-level check-then-write (which would have exactly that
-- race). matchdeal_swipes/investor_archive_entries keep being written
-- too (existing Archive/ticket-signal UI depends on them) — this table
-- is the new source of truth for the decision itself, not a replacement.
create table if not exists investor_relationship_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  investor_catalog_entity_id uuid not null references catalog_entities(id) on delete cascade,
  decision text not null check (decision in ('interested', 'passed')),
  -- Free text, not the old fixed PASS_REASONS category list
  -- (ticket_too_small/outside_thesis/too_early/other) — the spec asks
  -- for a real explanation ("Reason for passing", max 1000 chars), not a
  -- category. Required for 'passed', optional for 'interested'.
  reason_detail text check (reason_detail is null or char_length(reason_detail) <= 1000),
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  access_revoked_count integer not null default 0,
  notified_at timestamptz,
  notify_failed boolean not null default false,
  unique (org_id, investor_catalog_entity_id)
);
create index if not exists investor_relationship_decisions_org_idx on investor_relationship_decisions (org_id);
create index if not exists investor_relationship_decisions_investor_idx on investor_relationship_decisions (investor_catalog_entity_id);

alter table investor_relationship_decisions enable row level security;
-- Startup side reads through org membership (same pattern every org-scoped
-- table in this schema uses).
create policy investor_relationship_decisions_org_member on investor_relationship_decisions for select
  using (is_org_member(org_id));
-- Platform admin (back office, AP-15).
create policy investor_relationship_decisions_admin on investor_relationship_decisions for select
  using (is_platform_admin());
-- All writes go through the service-role function below — no direct
-- investor-side INSERT/UPDATE policy, matching how matchdeal_swipes'
-- own investor-facing write already goes through a service-role API
-- route today, not a client-side RLS write.
