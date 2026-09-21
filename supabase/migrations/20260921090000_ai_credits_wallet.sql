-- Prompt 706 — AI credits wallet, per org, with configurable plans and
-- per-org overrides. Decisions already made by Nuno (not reopened here):
-- wallet is per-org (not per-user), blocks outright at zero (no overage,
-- no pay-as-you-go yet), unit is abstract credits (not euros), internal/
-- test orgs are exempt, backoffice/internal tools stay out of this
-- entirely.
--
-- Exemption is `is_test OR is_internal`, not is_test alone — confirmed
-- against production (2026-09-21): ablute_'s own org
-- (bca54499-03c8-469b-a48d-b9f442e44f69), the account the strategy doc
-- explicitly named as needing this exemption (216 of ~600 historical
-- ai_call_log rows), is is_test=false, is_internal=true. is_test alone
-- would have blocked exactly the account this requirement was written
-- for — the same is_test-vs-is_internal confusion this codebase has hit
-- before (several existing routes filter only is_test and undercount
-- "real customers" as a result).
--
-- PROPOSED, NOT APPLIED to production by this session — verified against
-- read-only queries of production (wkjcaoqdvhykrfacsylr) for this
-- migration's own preconditions (see the orgs.plan FK note below) and the
-- exemption logic above, and its RPCs' actual behavior confirmed via
-- BEGIN/ROLLBACK transactions against real data — never by actually
-- committing DDL there. A human (or the revisor session) applies it for
-- real, same convention as every other migration in this repo.
--
-- Naming: 14-digit UTC timestamp prefix, the convention this repo switched
-- to after migration 0343 (see e.g. 20260914224500_investor_access_started_at.sql's
-- own header) — not a new 4-digit number that could collide with another
-- branch's own next-in-sequence guess.

-- ============================================================================
-- A.1 — ai_actions: one row per BILLABLE ACTION (not per ai_call_log purpose
-- string — several purposes fan out from a single charge point, e.g. all
-- seven market_research_* sub-types share one `market_research` action
-- because chargeAiAction() is called once per request, before the section
-- is even chosen). `key` is what application code passes to
-- charge_ai_action(); it does NOT need to equal any ai_call_log.purpose
-- string, though most do, for legibility.
--
-- credit_cost is a PROPOSED starting point, not an official number — sized
-- proportionally against real average cost_eur per purpose from
-- ai_call_log (production, queried 2026-09-21, summarized in this
-- session's report): a clean 1 / 3 / 5 scale roughly tracking the real
-- ~€0.002–0.003 (cheap) / ~€0.10–0.11 (mid) / ~€0.13–0.18 (priciest —
-- Market data, confirmed in the strategy doc as "o mais caro, de longe")
-- bands. Flagged for Nuno to confirm/adjust — never meant to be taken as
-- final.
-- ============================================================================
create table if not exists ai_actions (
  key text primary key,
  label text not null,
  category text not null check (category in ('client', 'system', 'internal')),
  credit_cost int not null check (credit_cost > 0),
  needs_confirmation boolean not null default false,
  -- Prompt 706 Bloco C.3 — the "kill switch" Nuno asked for: an admin can
  -- disable one action entirely (e.g. a model started costing too much)
  -- without a deploy. charge_ai_action() below refuses with a clear
  -- message when this is false, before ever reaching the caller's AI call.
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table ai_actions is
  'Prompt 706 — the central registry of AI actions a client-facing button can trigger. category=client actions are metered by the wallet (charge_ai_action); system/internal never are (enrichment-worker, backoffice tools, automatic classifiers) — see this migration''s own header for the full list of what stays out.';

insert into ai_actions (key, label, category, credit_cost, needs_confirmation) values
  ('investability_report', 'Investability ranking (report + investor-safe SWOT)', 'client', 1, true),
  ('document_review', 'Review with AI (per document)', 'client', 1, false),
  ('cross_document_review', 'Find contradictions', 'client', 1, false),
  ('market_data_review', 'Benchmark my market', 'client', 1, false),
  ('strengthen_suggest', 'Strengthen a claim (suggestion)', 'client', 1, false),
  ('blueprint_gap_draft', 'Pitch Blueprint — draft an answer', 'client', 1, false),
  ('blueprint_gap_polish', 'Pitch Blueprint — polish an answer', 'client', 1, false),
  ('reconciliation', 'Pitch Blueprint — reconcile against documents', 'client', 1, true),
  ('answer_routing', 'Pitch Blueprint — route a free-text answer', 'client', 1, false),
  ('market_research', 'Market data research (any section)', 'client', 5, true),
  ('market_document_extract', 'Market data — extract from a document', 'client', 5, false),
  ('market_thesis_document_suggest', 'Market thesis — suggest from documents', 'client', 5, true),
  ('market_thesis_hypotheses_generate', 'Market thesis — generate hypotheses', 'client', 1, false),
  ('entity_enrich', 'Enrich an investor (per row)', 'client', 3, false),
  ('compose_outreach', 'Compose with AI', 'client', 1, false),
  ('roadmap_suggest', 'Roadmap — suggest events', 'client', 1, false),
  ('mini_pitch_synthesis', 'Mini-pitch synthesis', 'client', 1, false),
  ('team_sherlock_research', 'Team — Sherlock research', 'client', 3, false)
on conflict (key) do nothing;

alter table ai_actions enable row level security;
-- Readable by any signed-in user (the app needs action labels/costs to show
-- "this will use N credits" copy); only a platform admin can change one.
create policy ai_actions_read_all on ai_actions for select using (auth.role() = 'authenticated');
create policy ai_actions_admin_insert on ai_actions for insert with check (is_platform_admin());
create policy ai_actions_admin_update on ai_actions for update using (is_platform_admin()) with check (is_platform_admin());
create policy ai_actions_admin_delete on ai_actions for delete using (is_platform_admin());

-- ============================================================================
-- A.2 — plans: replaces orgs.plan's status as a bare string with no backing
-- row. Seeded with the THREE tiers that actually exist in code today
-- (src/lib/plans.ts's PLAN_TIERS) — the mini-prompt's own text named only
-- "idea, motherfunding," but production `orgs.plan` and PLAN_TIERS both
-- also have 'garage' live (confirmed: 0 orgs on it today, 6 idea + 2
-- motherfunding real, +9 is_test rows across idea/motherfunding — queried
-- 2026-09-21 — but garage IS a selectable, real tier in the UI and would
-- break the FK below if left unseeded).
--
-- monthly_ai_credits is a PROPOSED starting point, sized to comfortably
-- cover what garage/motherfunding already promise via the SEPARATE,
-- UNTOUCHED WATSON_DRAFT_QUOTA constant (90 / 210 "AI-personalized
-- outreach drafts" per month, plans.ts) now that compose_outreach draws
-- from this SAME shared pool instead of its own counter (see the
-- ai_drafts_used_this_month retirement note near the bottom of this file).
-- Flagged for Nuno: these numbers assume the pool is shared across ALL 18
-- actions, not just compose — if garage founders actually use anywhere
-- near 90 compose credits AND run several market-data/reconciliation
-- passes in the same month, 200 may be tight. Easy to raise later from the
-- backoffice screen (Bloco C) with no deploy.
-- ============================================================================
create table if not exists plans (
  key text primary key,
  label text not null,
  monthly_ai_credits int not null check (monthly_ai_credits >= 0),
  is_custom boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table plans is
  'Prompt 706 — plan tiers with a monthly AI-credit allowance, editable from the backoffice (Bloco C). Distinct from src/lib/plans.ts''s PLAN_TIERS/PLANS (pricing copy, seat counts, MatchDeal limits, Watson/Review quotas) — this table ONLY governs the AI-credit wallet; the two are linked only by sharing the same key values (idea/garage/motherfunding) for the three built-in tiers.';

insert into plans (key, label, monthly_ai_credits, is_custom) values
  ('idea', 'Elementary, my dear', 0, false),
  ('garage', 'List of Suspects', 200, false),
  ('motherfunding', 'It''s the butler!', 500, false)
on conflict (key) do nothing;

alter table plans enable row level security;
create policy plans_read_all on plans for select using (auth.role() = 'authenticated');
create policy plans_admin_insert on plans for insert with check (is_platform_admin());
create policy plans_admin_update on plans for update using (is_platform_admin()) with check (is_platform_admin());
create policy plans_admin_delete on plans for delete using (is_platform_admin());

-- ============================================================================
-- A.3 — orgs: the wallet balance itself, same counter+reset-timestamp shape
-- as ai_drafts_used_this_month/ai_drafts_reset_at (0102_watson_draft_credits.sql)
-- generalized to every action instead of just compose. Plus the FK linking
-- orgs.plan to the new plans table — safe today (verified against
-- production, 2026-09-21: every real orgs.plan value is 'idea' or
-- 'motherfunding', both seeded above; no 'garage', no legacy 'free'/'paid',
-- no NULL rows exist to violate it).
-- ============================================================================
alter table orgs
  add column if not exists ai_credits_used_this_period integer not null default 0,
  add column if not exists ai_credits_reset_at timestamptz not null default (now() + interval '1 month');

comment on column orgs.ai_credits_used_this_period is
  'Prompt 706 — credits spent this period across every ai_actions.key, reset lazily by charge_ai_action()/ai_wallet_status() the same way ai_drafts_used_this_month always has. is_test orgs never increment this (charge_ai_action() exempts them outright).';

alter table orgs
  add constraint orgs_plan_fkey foreign key (plan) references plans(key);

-- ============================================================================
-- A.4 — plan_overrides: both "this org has a whole custom plan with X
-- credits/month" (action_key null) and "this org gets a one-off discount on
-- one action" (action_key set) live here, never by editing the shared
-- `plans`/`ai_actions` rows themselves. At most one whole-org override and
-- at most one per-action override per org, enforced by the unique index
-- below (coalesce so a NULL action_key still collides with itself).
-- ============================================================================
create table if not exists plan_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  action_key text references ai_actions(key) on delete cascade,
  credit_cost_override int check (credit_cost_override > 0),
  monthly_credits_override int check (monthly_credits_override >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_overrides_shape check (
    (action_key is not null and credit_cost_override is not null and monthly_credits_override is null)
    or
    (action_key is null and monthly_credits_override is not null and credit_cost_override is null)
  )
);
create unique index if not exists plan_overrides_org_action_idx
  on plan_overrides (org_id, coalesce(action_key, ''));

comment on table plan_overrides is
  'Prompt 706 — per-org exceptions to plans/ai_actions: a whole-org monthly-credit override (action_key null) for a custom plan, or a one-off per-action cost override (action_key set), never both on the same row. Admin-only (no client read) — an org''s effective numbers are resolved server-side by ai_wallet_status()/charge_ai_action(), never read raw off this table by the client.';

alter table plan_overrides enable row level security;
create policy plan_overrides_admin_only on plan_overrides
  for all using (is_platform_admin()) with check (is_platform_admin());

-- ============================================================================
-- Bloco E.2 — a per-event ledger, not just the running total on `orgs`.
-- Without this, "compare ai_call_log to what the wallet debited" (E.2's own
-- requirement) has nothing on the wallet side to compare AGAINST beyond a
-- single current-period counter — exactly the shape of gap this whole
-- feature exists to close (blueprint_analyses.consumed_kind: a column that
-- LOOKED like it tracked consumption and was never actually reconciled
-- against anything). One row per SUCCESSFUL charge (never a refusal —
-- nothing was spent), written inside charge_ai_action's own transaction.
-- ============================================================================
create table if not exists ai_credit_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  action_key text not null references ai_actions(key),
  credits_charged int not null check (credits_charged > 0),
  created_at timestamptz not null default now()
);
create index if not exists ai_credit_charges_org_month_idx on ai_credit_charges (org_id, created_at);

comment on table ai_credit_charges is
  'Prompt 706 Bloco E.2 — one row per successful charge_ai_action() call, the wallet''s own event-level ledger for reconciling against ai_call_log (scripts/_verify_ai_credits_reconciliation.mjs). Never written on a refusal.';

alter table ai_credit_charges enable row level security;
create policy ai_credit_charges_admin_only on ai_credit_charges
  for all using (is_platform_admin()) with check (is_platform_admin());

-- ============================================================================
-- B.1 — the two RPCs. Same shape as watson_drafts_status/watson_record_draft
-- (0102_watson_draft_credits.sql): SECURITY DEFINER so the reset write and
-- the plan_overrides lookup don't need client-side grants on orgs/plans/
-- plan_overrides, `for update` row lock so a race can't double-spend, lazy
-- reset (no cron needed — consistent with the Hobby-plan once/day cron
-- limit CLAUDE.md already documents). Unlike Watson's pair, the actual
-- monthly limit and per-action cost are resolved INSIDE the function (from
-- plans/ai_actions/plan_overrides), not passed in by the caller — the
-- caller only ever says WHO and WHAT, never how much, so a plan or
-- override change takes effect on the very next call with zero app-code
-- changes.
-- ============================================================================

-- Read-only: applies a reset if due, then reports where the org stands for
-- ONE action (its resolved cost, and how many more times it could run this
-- period at that cost). Used by the /api/me wallet card and by the Bloco D
-- pre-spend popup (to show "you've used Y this month").
create or replace function public.ai_wallet_status(p_org_id uuid, p_action_key text)
returns table(
  used integer, monthly_limit integer, remaining integer, reset_at timestamptz,
  action_cost integer, action_enabled boolean,
  is_test boolean -- despite the name (kept for the caller's field name — see ai-credits.ts), this is really "exempt": is_test OR is_internal.
)
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_used integer;
  v_reset timestamptz;
  v_exempt boolean;
  v_plan text;
  v_base_limit integer;
  v_org_limit_override integer;
  v_base_cost integer;
  v_cost_override integer;
  v_enabled boolean;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  -- Prompt 706 — exempt on is_test OR is_internal, not is_test alone.
  -- Confirmed against production (2026-09-21): ablute_'s own org
  -- (bca54499-03c8-469b-a48d-b9f442e44f69) is is_test=false,
  -- is_internal=true — the exact account the strategy doc named as the
  -- one that must never get blocked from its own testing (216 of ~600
  -- historical ai_call_log rows). is_test alone would have missed it,
  -- the same is_test-vs-is_internal confusion this codebase has hit
  -- before (several routes filter only is_test and undercount "real
  -- customers" as a result) — never repeat that here.
  select ai_credits_used_this_period, ai_credits_reset_at, (is_test or is_internal), plan
    into v_used, v_reset, v_exempt, v_plan
    from public.orgs where id = p_org_id for update;

  if v_reset is null or now() >= v_reset then
    v_used := 0;
    v_reset := now() + interval '1 month';
    update public.orgs set ai_credits_used_this_period = v_used, ai_credits_reset_at = v_reset where id = p_org_id;
  end if;

  select monthly_ai_credits into v_base_limit from public.plans where key = v_plan;
  select monthly_credits_override into v_org_limit_override
    from public.plan_overrides where org_id = p_org_id and action_key is null;

  select credit_cost, enabled into v_base_cost, v_enabled from public.ai_actions where key = p_action_key;
  select credit_cost_override into v_cost_override
    from public.plan_overrides where org_id = p_org_id and action_key = p_action_key;

  return query select
    v_used,
    coalesce(v_org_limit_override, v_base_limit, 0),
    greatest(coalesce(v_org_limit_override, v_base_limit, 0) - v_used, 0),
    v_reset,
    coalesce(v_cost_override, v_base_cost, 0),
    coalesce(v_enabled, false),
    v_exempt;
end;
$function$;
grant execute on function public.ai_wallet_status(uuid, text) to authenticated;

-- The charge itself. Returns ok=false with a reason instead of raising, so
-- callers can show a clean 403 message rather than a generic server error.
-- Increments in the SAME statement that decides there's room — never after
-- the caller's own AI call — so a route that never reaches this function's
-- return with ok=true must not call the model at all (Bloco B.1's own
-- requirement: "nunca depois da resposta do modelo").
create or replace function public.charge_ai_action(p_org_id uuid, p_action_key text)
returns table(ok boolean, reason text, used integer, monthly_limit integer, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_used integer;
  v_reset timestamptz;
  v_exempt boolean;
  v_plan text;
  v_base_limit integer;
  v_org_limit_override integer;
  v_limit integer;
  v_base_cost integer;
  v_cost_override integer;
  v_cost integer;
  v_enabled boolean;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  select credit_cost, enabled into v_base_cost, v_enabled from public.ai_actions where key = p_action_key;
  if v_base_cost is null then
    raise exception 'unknown ai_actions.key: %', p_action_key;
  end if;

  -- Prompt 706 — exempt on is_test OR is_internal (see ai_wallet_status's
  -- own comment above for why is_test alone is not enough: ablute_'s real
  -- org is is_internal=true, is_test=false, confirmed against production).
  select ai_credits_used_this_period, ai_credits_reset_at, (is_test or is_internal), plan
    into v_used, v_reset, v_exempt, v_plan
    from public.orgs where id = p_org_id for update;

  -- Nuno's decision: is_test/is_internal orgs are exempt outright — no charge, no
  -- reset bookkeeping, so testing the product never trips its own limits.
  if v_exempt then
    return query select true, null::text, v_used, null::integer, null::integer, v_reset;
    return;
  end if;

  if not coalesce(v_enabled, false) then
    return query select false, 'This action is temporarily disabled.'::text, v_used, null::integer, null::integer, v_reset;
    return;
  end if;

  if v_reset is null or now() >= v_reset then
    v_used := 0;
    v_reset := now() + interval '1 month';
  end if;

  select monthly_ai_credits into v_base_limit from public.plans where key = v_plan;
  select monthly_credits_override into v_org_limit_override
    from public.plan_overrides where org_id = p_org_id and action_key is null;
  v_limit := coalesce(v_org_limit_override, v_base_limit, 0);

  select credit_cost_override into v_cost_override
    from public.plan_overrides where org_id = p_org_id and action_key = p_action_key;
  v_cost := coalesce(v_cost_override, v_base_cost);

  if v_used + v_cost > v_limit then
    -- Persist a due reset even on a refused call — both columns together,
    -- or a reset that happened to land on a request that gets refused
    -- (e.g. the idea plan, limit 0, always refuses) would advance
    -- reset_at while leaving the stale pre-reset used count in place.
    update public.orgs set ai_credits_used_this_period = v_used, ai_credits_reset_at = v_reset where id = p_org_id;
    return query select false,
      format('AI credits limit reached for this month — resets on %s, or upgrade your plan.', to_char(v_reset, 'YYYY-MM-DD')),
      v_used, v_limit, greatest(v_limit - v_used, 0), v_reset;
    return;
  end if;

  v_used := v_used + v_cost;
  update public.orgs set ai_credits_used_this_period = v_used, ai_credits_reset_at = v_reset where id = p_org_id;
  -- Bloco E.2 — the event-level ledger entry, same transaction as the
  -- balance update above: either both happen or neither does.
  insert into public.ai_credit_charges (org_id, action_key, credits_charged) values (p_org_id, p_action_key, v_cost);

  return query select true, null::text, v_used, v_limit, greatest(v_limit - v_used, 0), v_reset;
end;
$function$;
grant execute on function public.charge_ai_action(uuid, text) to authenticated;

-- ============================================================================
-- Guards (from the mini-prompt's own list, restated here so a future reader
-- of this migration alone sees them without cross-referencing the prompt):
-- daily_cap/weekly_cap (outreach volume discipline) are UNTOUCHED and
-- unrelated. REVIEW_QUOTA, WATSON_DRAFT_QUOTA-the-CONSTANT, MATCHDEAL_WEEKLY
-- and every other src/lib/plans.ts gate are UNTOUCHED — this wallet is an
-- ADDITIONAL layer on top of them, not a replacement, for every action
-- except one: ai_drafts_used_this_month/ai_drafts_reset_at (also on orgs,
-- also from 0102) is retired by application code once /api/compose calls
-- charge_ai_action('compose_outreach') instead — the columns themselves are
-- NOT dropped here (a later cleanup migration can do that once the app
-- code no longer references them; dropping them in the same migration that
-- introduces their replacement would make this migration harder to review
-- and impossible to roll back independently).
-- ============================================================================
