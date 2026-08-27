-- Prompt 408 §C — the investor's private decision record for one startup:
-- decisions and the micro-predictions that go with them. Same ownership
-- model as investor_berkus_estimates/evaluation_snapshots (per SEAT, RLS
-- as defense-in-depth behind a service-role route with its own ownership
-- check).
--
-- investor_case_decisions is append-only, same reasoning as
-- evaluation_snapshots (migration 0258): changing your mind is a NEW row,
-- never an edit of the old one — "se existe é autêntico". The most
-- recent row for a (investor_member_id, startup_org_id) pair is the
-- current decision; the API layer picks it by created_at desc, nothing
-- here marks one row as "the" current one structurally.
create table public.investor_case_decisions (
  id uuid primary key default gen_random_uuid(),
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  decision text not null check (decision in ('invest', 'pass', 'watch')),
  thesis text not null,
  premortem text,
  created_at timestamptz not null default now()
);
create index investor_case_decisions_lookup_idx on public.investor_case_decisions (investor_member_id, startup_org_id, created_at);

alter table public.investor_case_decisions enable row level security;
create policy investor_case_decisions_owner_select on public.investor_case_decisions for select
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy investor_case_decisions_owner_insert on public.investor_case_decisions for insert
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));

-- investor_case_predictions — captured now, resolved in a future
-- calibration wave (408 §C.1's own words: "a RESOLUÇÃO fica para a onda
-- de calibração — aqui só se capturam; deixa as colunas prontas").
-- resolved_at/outcome stay null until that wave exists; nothing today
-- writes them. This table is NOT append-only in the same sense as the
-- other two — a prediction needs an update path later to record its
-- resolution — but no route in this prompt performs that update, so for
-- now the same select+insert-only RLS shape applies; the future
-- resolution wave adds its own update policy (scoped narrowly to
-- resolved_at/outcome) alongside the route that needs it, not preemptively.
create table public.investor_case_predictions (
  id uuid primary key default gen_random_uuid(),
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  prediction text not null,
  horizon_months int not null check (horizon_months > 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  outcome text check (outcome in ('true', 'false'))
);
create index investor_case_predictions_lookup_idx on public.investor_case_predictions (investor_member_id, startup_org_id, created_at);

alter table public.investor_case_predictions enable row level security;
create policy investor_case_predictions_owner_select on public.investor_case_predictions for select
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy investor_case_predictions_owner_insert on public.investor_case_predictions for insert
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
