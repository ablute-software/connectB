-- Prompt 914 — one definition of "the plan this org is on RIGHT NOW", in SQL as in TypeScript, and the AI-credit wallet reads it.
--
-- NOT YET APPLIED to production: waiting for Nuno's "sim". Rehearsed against production data inside ONE DO statement that always ends in
-- RAISE EXCEPTION (scripts/verify-effective-plan-914.sql, which embeds THIS file verbatim, so the rehearsal can never drift from what is
-- applied): the parity cases against the TypeScript rule, an old-versus-new comparison of the wallet for every org, and the path the app
-- really takes (role authenticated).
--
-- WHY. A redeemed 100%-off voucher never writes orgs.plan (by design: a billing-display concern, computed on read and reverting by itself
-- the moment benefit_ends_at passes — see src/lib/effective-plan.ts). The TypeScript side resolved the effective plan in resolveUserPlan,
-- but the AI-credit wallet read orgs.plan directly, so an org on a free trial of "It's the butler!" had Elementary's 80 credits a month
-- instead of 500: Wisify (PIONEER_100) and Insignals (PVPIONEER100) today.
--
-- THE RULE (identical to effective-plan.ts; effective-plan-cases.json runs against both):
--   the stored plan (orgs.plan, normalised: 'paid' -> garage, anything unknown -> idea),
--   raised to the highest tier covered by a promo_redemptions row whose promo_codes.discount_pct = 100 and whose code is not DELETED and
--   whose benefit has not ended (benefit_ends_at null or in the future),
--   and to the highest free_tier of a platform_badges row that is not revoked and whose free period has not ended.
--   Two decisions, both inherited from the code and kept exactly:
--     * the code being DELETED revokes the benefit for every holder; the code being DEACTIVATED (active = false) only stops new
--       redemptions — whoever redeemed it keeps the benefit until it runs out (promo.ts: isRedemptionCurrentlyActive checks deleted_at,
--       never active). The prompt's prose lists `active` among the conditions; the code, and the founder's decision behind it, do not.
--     * only 100% grants entitlements: a partial discount still has to be subscribed to at the discounted price.
--
-- WHAT CHANGES FOR THE WALLET: ai_wallet_status() and charge_ai_action() set v_plan from effective_plan() right after they lock the org
-- row. Nothing else in them moves (the rehearsal proves it by removing the added block and comparing the two definitions); the exemption
-- (is_test OR is_internal), the per-org override and the reset bookkeeping are untouched. CREATE OR REPLACE keeps their grants.
--
-- ALSO REPAIRED — it is the same function, and the change above would be dead code without it (found by the rehearsal, 13/10/2026):
-- ai_wallet_status() has raised 42702 `column reference "is_test" is ambiguous` on EVERY call since Prompt 706 created it (21/09). Its OUT
-- column is called is_test, so the unqualified is_test in `(is_test or is_internal)` can mean that variable or orgs.is_test, and plpgsql
-- (variable_conflict = error, the default; no role or database overrides it here) refuses to choose. Its only caller, aiWalletStatus() in
-- src/lib/ai-credits.ts, logs "[aiWalletStatus] RPC failed" and returns null, so for three weeks the credits card that /api/me builds from
-- it ("watson") has been hidden for every founder and the pre-spend popups have fallen back to their generic line, without "you've used X of
-- Y this month", while charge_ai_action() (no OUT column with that name) kept charging. The repair is the two qualified column names in
-- the first select of ai_wallet_status() and nothing else. The rehearsal proves the old function raises (B0) and that the new definition
-- differs from it ONLY by that qualification and the Prompt 914 block (A1).
--
-- effective_plan() is internal: revoked from public, anon and authenticated, reachable only through the SECURITY DEFINER functions above
-- (and the service role). It reads promo_redemptions / promo_codes, which are platform-admin-only under RLS.

-- 1. the rule
create or replace function public.effective_plan(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((
    select case max(x.rnk) when 3 then 'motherfunding' when 2 then 'garage' when 1 then 'idea' end
      from (
        select case t.tier when 'motherfunding' then 3 when 'garage' then 2 when 'idea' then 1 else 0 end as rnk
          from (
            select case o.plan when 'garage' then 'garage' when 'motherfunding' then 'motherfunding' when 'paid' then 'garage' else 'idea' end as tier
              from public.orgs o
             where o.id = p_org_id
            union all
            select u.tier
              from public.promo_redemptions r
              join public.promo_codes c on c.id = r.promo_code_id
              cross join lateral unnest(c.applicable_plans) as u(tier)
             where r.org_id = p_org_id
               and c.deleted_at is null
               and c.discount_pct = 100
               and (r.benefit_ends_at is null or r.benefit_ends_at > now())
            union all
            select b.free_tier
              from public.platform_badges b
             where b.org_id = p_org_id
               and b.revoked_at is null
               and b.free_tier is not null
               and (b.free_until is null or b.free_until > now())
          ) t
      ) x
  ), 'idea');
$$;

-- 2. the wallet reads it
create or replace function public.ai_wallet_status(p_org_id uuid, p_action_key text)
returns table(used integer, monthly_limit integer, remaining integer, reset_at timestamp with time zone, action_cost integer, action_enabled boolean, is_test boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  select ai_credits_used_this_period, ai_credits_reset_at, (orgs.is_test or orgs.is_internal), plan
    into v_used, v_reset, v_exempt, v_plan
    from public.orgs where id = p_org_id for update;

  -- >>> Prompt 914
  -- (The select above names orgs.is_test / orgs.is_internal on purpose: unqualified, is_test is ambiguous with this function's own OUT
  -- column of that name, and the function raised 42702 on every call since Prompt 706. See the header of the migration.)
  -- The limit follows the plan the org is on RIGHT NOW (stored plan, raised by a running 100% free trial or a badge's free tier), not
  -- orgs.plan: effective_plan() is the SQL twin of src/lib/effective-plan.ts. The stored value read above still feeds nothing else.
  v_plan := public.effective_plan(p_org_id);
  -- <<< Prompt 914

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

create or replace function public.charge_ai_action(p_org_id uuid, p_action_key text)
returns table(ok boolean, reason text, used integer, monthly_limit integer, remaining integer, reset_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- >>> Prompt 914
  -- Same as ai_wallet_status(): the plan the org is on RIGHT NOW, so what is charged against and what is shown agree.
  v_plan := public.effective_plan(p_org_id);
  -- <<< Prompt 914

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

-- 3. who may call it: nobody but the SECURITY DEFINER functions above (which run as their owner) and the service role
revoke execute on function public.effective_plan(uuid) from public, anon, authenticated;
grant execute on function public.effective_plan(uuid) to service_role;
