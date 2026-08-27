-- Prompt 408 §B.1 — evaluation_snapshots: the investor's own history for
-- any evaluation tool, one row per explicit "Save" action. Same ownership
-- model as investor_berkus_estimates (0158) — per SEAT
-- (matchdeal_investor_members.id), private judgment, RLS is defense in
-- depth behind the real server-route + service-role ownership check.
--
-- Append-only by design (a snapshot IS history — "se existe é autêntico"):
-- unlike investor_berkus_estimates' single `for all` policy, this splits
-- select/insert so there is deliberately no update or delete policy at
-- all — RLS defaults to deny any operation with no matching policy, so
-- there is no way to alter or remove a snapshot through the API, ever.
create table public.evaluation_snapshots (
  id uuid primary key default gen_random_uuid(),
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('berkus', 'scenarios', 'scorecard')),
  inputs jsonb not null,
  outputs jsonb not null,
  created_at timestamptz not null default now()
);
create index evaluation_snapshots_lookup_idx on public.evaluation_snapshots (investor_member_id, startup_org_id, kind, created_at);

alter table public.evaluation_snapshots enable row level security;

create policy evaluation_snapshots_owner_select on public.evaluation_snapshots for select
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy evaluation_snapshots_owner_insert on public.evaluation_snapshots for insert
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
