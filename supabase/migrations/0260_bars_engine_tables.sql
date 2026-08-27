-- Prompt 411 §B — BARS (Behaviorally Anchored Rating Scale) engine state:
-- the investor's own answers, per-axis N/A flag, red-flag verification
-- state, and the Risk Register. Same ownership model as
-- investor_berkus_estimates/evaluation_snapshots/investor_case_decisions
-- (0158/0258/0259) — per SEAT (matchdeal_investor_members.id), RLS as
-- defense-in-depth behind a service-role route with its own ownership
-- check.
--
-- Unlike 0258/0259's append-only history tables, these four are
-- CURRENT-STATE tables ("respostas e riscos são estado-corrente
-- editável; o histórico é via snapshots" — 411 §B header) — an investor
-- can change an answer/flag-state/risk assessment in place. So each gets
-- an owner UPDATE policy alongside select+insert; still no delete policy
-- (RLS defaults to deny any operation with no matching policy), matching
-- this codebase's general avoidance of hard deletes on investor judgment
-- data.

create table public.bars_answers (
  id uuid primary key default gen_random_uuid(),
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  axis text not null check (axis in ('team', 'market', 'product', 'technology')),
  bank_version text not null,
  question_id text not null,
  -- null + skipped=false = not yet answered; skipped=true = explicit
  -- "not enough evidence" (never an implicit 3/5 — see bars-scoring.ts).
  level int check (level between 1 and 5),
  skipped boolean not null default false,
  -- {kind: 'claim'|'document'|'traction_metric'|'roadmap_event'|'interaction'|'investor_note', id?, text?}[]
  evidence_refs jsonb not null default '[]',
  note text,
  updated_at timestamptz not null default now(),
  unique (investor_member_id, startup_org_id, question_id)
);

alter table public.bars_answers enable row level security;
create policy bars_answers_owner_select on public.bars_answers for select
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy bars_answers_owner_insert on public.bars_answers for insert
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy bars_answers_owner_update on public.bars_answers for update
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()))
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));

-- bars_axis_state — the per-axis "Not material (N/A)" opt-out (transversal
-- rule 5 of the v2 content doc; today only Technology uses it in
-- practice, the model stays general). Composite PK, no synthetic id —
-- one row per (investor, case, axis), nothing else to key by.
create table public.bars_axis_state (
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  axis text not null check (axis in ('team', 'market', 'product', 'technology')),
  not_material boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (investor_member_id, startup_org_id, axis)
);

alter table public.bars_axis_state enable row level security;
create policy bars_axis_state_owner_select on public.bars_axis_state for select
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy bars_axis_state_owner_insert on public.bars_axis_state for insert
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy bars_axis_state_owner_update on public.bars_axis_state for update
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()))
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));

-- bars_red_flag_states — Confirmed vs. Critical Unverified (the
-- distinction is load-bearing in bars-scoring.ts: only 'confirmed' ever
-- caps an axis score; 'unverified' just surfaces a neutral badge and
-- pushes to a DD queue).
create table public.bars_red_flag_states (
  id uuid primary key default gen_random_uuid(),
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  flag_id text not null,
  bank_version text not null,
  state text not null check (state in ('unverified', 'confirmed', 'cleared')) default 'unverified',
  evidence_refs jsonb not null default '[]',
  note text,
  updated_at timestamptz not null default now(),
  unique (investor_member_id, startup_org_id, flag_id)
);

alter table public.bars_red_flag_states enable row level security;
create policy bars_red_flag_states_owner_select on public.bars_red_flag_states for select
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy bars_red_flag_states_owner_insert on public.bars_red_flag_states for insert
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy bars_red_flag_states_owner_update on public.bars_red_flag_states for update
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()))
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));

-- investor_case_risks — the Risk Register, 14 fixed categories. assessed
-- defaults false: "unknown ≠ low" — not-yet-assessed is its own visible
-- state, never silently read as a low-risk rating.
create table public.investor_case_risks (
  id uuid primary key default gen_random_uuid(),
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  category text not null check (category in (
    'technology', 'product', 'market', 'adoption', 'commercial', 'financial',
    'financing', 'team', 'governance', 'legal_ip', 'regulatory', 'competitive',
    'execution', 'exit_liquidity'
  )),
  probability text check (probability in ('low', 'medium', 'high')),
  impact text check (impact in ('low', 'medium', 'high')),
  assessed boolean not null default false,
  mitigation text,
  residual text check (residual in ('low', 'medium', 'high')),
  thesis_breaking boolean not null default false,
  evidence_refs jsonb not null default '[]',
  note text,
  updated_at timestamptz not null default now(),
  unique (investor_member_id, startup_org_id, category)
);

alter table public.investor_case_risks enable row level security;
create policy investor_case_risks_owner_select on public.investor_case_risks for select
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy investor_case_risks_owner_insert on public.investor_case_risks for insert
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy investor_case_risks_owner_update on public.investor_case_risks for update
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()))
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));

-- §B.5 — widen evaluation_snapshots.kind (0258) so 412 can save BARS and
-- Risk Register snapshots the same way berkus/scenarios/scorecard already
-- do. Additive only — drops and re-adds the same auto-named check with
-- two more values, nothing existing changes.
alter table public.evaluation_snapshots drop constraint evaluation_snapshots_kind_check;
alter table public.evaluation_snapshots add constraint evaluation_snapshots_kind_check
  check (kind in ('berkus', 'scenarios', 'scorecard', 'bars', 'risks'));
