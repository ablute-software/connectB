-- Prompt 914 — ensaio da migração 20261013170000_effective_plan.sql contra os DADOS REAIS de produção, numa transacção que nunca fecha
-- com commit. GERADO por scripts/compose-effective-plan-rehearsal.mjs a partir de head.sql + a migração + os casos de
-- src/lib/effective-plan-cases.json + tail.sql — não editar à mão; um teste (effective-plan-rehearsal.test.ts) falha se divergir.
--
-- COMO FUNCIONA (e porque não pode deixar rasto): é UM único statement (um bloco DO). Dentro dele corre, por esta ordem:
--   1. a prova (B0) de que HOJE a ai_wallet_status() de produção rebenta com 42702 e a charge_ai_action() funciona, e cópias fiéis das duas
--      funções da carteira COMO ESTÃO HOJE (de pg_get_functiondef, em runtime — nunca à mão; na ai_wallet_status só com a qualificação
--      de coluna, porque a original não corre e não se podia comparar);
--   2. a migração, textualmente (entre as linhas "-- >>> MIGRATION" e "-- <<< MIGRATION");
--   3. a prova de que as duas funções novas diferem das velhas SÓ pelo bloco "Prompt 914" (e, na ai_wallet_status, pela qualificação de
--      coluna que a faz deixar de rebentar): tirando-os, o texto é idêntico;
--   4. os casos de paridade (gerados do JSON que o TypeScript também lê): fixtures zz-test, a matriz, e as organisações reais, ao vivo;
--   5. a carteira velha contra a nova para TODAS as orgs de produção, e o caminho real da app (papel authenticated);
--   6. um RAISE EXCEPTION final, que desfaz TUDO (migração incluída) e leva o resultado na mensagem de erro.
-- Um só statement + excepção final = atómico e revertido por construção, qualquer que seja o cliente que o corra.
--
-- Para correr: colar o ficheiro inteiro numa chamada execute_sql (Supabase MCP) ou em psql. A resposta é um ERRO que começa por
-- "REHEARSAL_RESULT": cada linha é PASS/FAIL/INFO com o esperado e o obtido. Nada fica gravado.
do $rehearsal$
declare
  v_org uuid; v_member uuid; v_got text; v_n int; v_def text;
  v_old_def_status text; v_old_def_charge text; v_old_acl_status text; v_old_acl_charge text;
  r record; v_a record; v_b record;
  v_total int := 0; v_diffs jsonb := '[]'::jsonb; v_unexplained int := 0;
  v_wis uuid := '4d2f492d-a631-480a-8901-aa315f4f41b4'; v_ins uuid := '94dc7fe1-ff32-4d24-9ceb-a058c1cfa963'; v_about uuid := '7c1a5974-000b-4dd2-8632-87f99250cf68';
  v_old_limit int; v_new_limit int; v_eff text;
  v_out text; v_pass int; v_fail int;
begin
  create temp table zz_res (seq serial primary key, name text, expected text, got text, mode text);
  create temp table zz_olddefs (name text primary key, def text, acl text);

  create function pg_temp.zz_as(p_uid uuid) returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
  end $f$;

  create function pg_temp.zz_check(p_name text, p_expected text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, p_expected, p_got, 'exact'); end $f$;

  create function pg_temp.zz_info(p_name text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, null, p_got, 'info'); end $f$;

  -- fixtures (everything below is rolled back with the rest)
  create function pg_temp.zz_mk_org(p_label text, p_plan text) returns uuid language plpgsql as $f$
  declare v uuid;
  begin
    insert into public.orgs(name, plan) values ('zz-test-914-' || p_label, p_plan) returning id into v;
    return v;
  end $f$;

  create function pg_temp.zz_mk_redemption(p_org uuid, p_code text, p_pct int, p_plans text[], p_deleted boolean, p_deactivated boolean, p_ends_in_days int) returns void language plpgsql as $f$
  declare v_code uuid;
  begin
    insert into public.promo_codes(code, kind, discount_pct, applicable_plans, active, deleted_at)
    values ('ZZ914-' || p_code, case when p_pct = 100 then 'free_trial' else 'percent_off' end, p_pct, p_plans, not p_deactivated,
            case when p_deleted then now() - interval '1 day' else null end)
    returning id into v_code;
    insert into public.promo_redemptions(promo_code_id, org_id, benefit_ends_at)
    values (v_code, p_org, case when p_ends_in_days is null then null else now() + make_interval(days => p_ends_in_days) end);
  end $f$;

  create function pg_temp.zz_mk_badge(p_org uuid, p_badge text, p_free_tier text, p_free_until_days int, p_revoked boolean) returns void language plpgsql as $f$
  begin
    insert into public.platform_badges(org_id, badge, justification, free_tier, free_until, revoked_at)
    values (p_org, p_badge, 'zz-test 914 rehearsal', p_free_tier,
            case when p_free_until_days is null then null else now() + make_interval(days => p_free_until_days) end,
            case when p_revoked then now() - interval '2 days' else null end);
  end $f$;

  -- 1. the two wallet functions exactly as production has them today, under other names
  select pg_get_functiondef('public.ai_wallet_status(uuid,text)'::regprocedure), (select p.proacl::text from pg_proc p where p.oid = 'public.ai_wallet_status(uuid,text)'::regprocedure)
    into v_old_def_status, v_old_acl_status;
  select pg_get_functiondef('public.charge_ai_action(uuid,text)'::regprocedure), (select p.proacl::text from pg_proc p where p.oid = 'public.charge_ai_action(uuid,text)'::regprocedure)
    into v_old_def_charge, v_old_acl_charge;

  -- 1b. B0 — production TODAY, before the migration, with the REAL functions called the way the app calls them (as a member of Wisify):
  -- ai_wallet_status() raises 42702 (its OUT column is_test is ambiguous with orgs.is_test), charge_ai_action() works.
  perform pg_temp.zz_as((select m.user_id from public.org_members m where m.org_id = v_wis limit 1));
  begin
    perform s.used from public.ai_wallet_status(v_wis, 'compose_outreach') s;
    v_got := 'NO ERROR';
  exception when others then v_got := sqlstate;
  end;
  perform pg_temp.zz_check('B0 production today: ai_wallet_status() called by a member raises 42702 (is_test is ambiguous with its own OUT column)', '42702', v_got);
  begin
    perform c.ok from public.charge_ai_action(v_wis, 'compose_outreach') c;
    raise exception using errcode = 'P0001', message = 'rehearsal: undo this charge';
  exception when others then v_got := case when sqlstate = 'P0001' then 'works' else sqlstate end;
  end;
  perform pg_temp.zz_check('B0 production today: charge_ai_action() called by the same member works (it has no OUT column called is_test)', 'works', v_got);

  -- 1c. the copies kept for the old-versus-new comparison. The old ai_wallet_status raises, so it could not be compared as it is: its copy
  -- gets ONLY the column qualification (A1 proves that is the whole difference) and what is compared afterwards is the LOGIC — plan, limit,
  -- cost, exemption — not the bug.
  perform pg_temp.zz_check('A0 control: the old ai_wallet_status text does contain the unqualified "(is_test or is_internal)" the migration qualifies (the repair is a real edit)', 'true',
    (position('(is_test or is_internal)' in v_old_def_status) > 0)::text);
  v_def := replace(replace(v_old_def_status, 'public.ai_wallet_status(', 'public.zz_old_ai_wallet_status('), '(is_test or is_internal)', '(orgs.is_test or orgs.is_internal)');
  execute v_def;
  execute replace(v_old_def_charge, 'public.charge_ai_action(', 'public.zz_old_charge_ai_action(');

  -- >>> MIGRATION (verbatim) >>>
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
  -- <<< MIGRATION <<<

  -- 3. THE ONLY DIFFERENCES: charge_ai_action() is the old one plus the "Prompt 914" block; ai_wallet_status() is the old one plus that block
  -- plus the column qualification that stops it raising 42702 (B0 above) — nothing else moved in either
  perform pg_temp.zz_check('A1 ai_wallet_status: new definition minus the Prompt 914 block and minus the column qualification is byte-for-byte the old one', 'true',
    (replace(regexp_replace(pg_get_functiondef('public.ai_wallet_status(uuid,text)'::regprocedure), E'\n  -- >>> Prompt 914.*?-- <<< Prompt 914\n', ''),
             '(orgs.is_test or orgs.is_internal)', '(is_test or is_internal)') = v_old_def_status)::text);
  perform pg_temp.zz_check('A1 charge_ai_action: new definition minus the Prompt 914 block is byte-for-byte the old one', 'true',
    (regexp_replace(pg_get_functiondef('public.charge_ai_action(uuid,text)'::regprocedure), E'\n  -- >>> Prompt 914.*?-- <<< Prompt 914\n', '') = v_old_def_charge)::text);
  perform pg_temp.zz_check('A2 the grants of both wallet functions are untouched (CREATE OR REPLACE keeps them)', 'true|true',
    ((select p.proacl::text from pg_proc p where p.oid = 'public.ai_wallet_status(uuid,text)'::regprocedure) = v_old_acl_status)::text || '|' ||
    ((select p.proacl::text from pg_proc p where p.oid = 'public.charge_ai_action(uuid,text)'::regprocedure) = v_old_acl_charge)::text);
  perform pg_temp.zz_check('A3 control: the new definitions DO contain the Prompt 914 block (both) and the qualification (so the equalities in A1 are not vacuous ones)', 'true|true|true',
    (position('-- >>> Prompt 914' in pg_get_functiondef('public.charge_ai_action(uuid,text)'::regprocedure)) > 0
       and position('v_plan := public.effective_plan(p_org_id);' in pg_get_functiondef('public.charge_ai_action(uuid,text)'::regprocedure)) > 0)::text || '|' ||
    (position('-- >>> Prompt 914' in pg_get_functiondef('public.ai_wallet_status(uuid,text)'::regprocedure)) > 0
       and position('v_plan := public.effective_plan(p_org_id);' in pg_get_functiondef('public.ai_wallet_status(uuid,text)'::regprocedure)) > 0)::text || '|' ||
    (position('(orgs.is_test or orgs.is_internal)' in pg_get_functiondef('public.ai_wallet_status(uuid,text)'::regprocedure)) > 0)::text);

  -- 4. PARITY: the same cases the TypeScript test runs (effective-plan-cases.json). Fixtures are created inside this transaction;
  -- the "live" lines read the real organisations as they are right now.
  -- >>> GENERATED PARITY CASES >>>
  -- 3 fixtures · 23 matrix cases · 6 real organisations · 3 TypeScript-only (skipped here)
  -- fixtures (the three the prompt names)
  -- zz1 — zz-test fixture: no voucher (stored garage)
  v_org := pg_temp.zz_mk_org('zz1', 'garage');
  perform pg_temp.zz_check('zz1 zz-test fixture: no voucher (stored garage)', 'garage', public.effective_plan(v_org));
  -- zz2 — zz-test fixture: 100% voucher, still running (stored idea, covers garage)
  v_org := pg_temp.zz_mk_org('zz2', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'zz2-1', 100, array['garage']::text[], false, false, 30);
  perform pg_temp.zz_check('zz2 zz-test fixture: 100% voucher, still running (stored idea, covers garage)', 'garage', public.effective_plan(v_org));
  -- zz3 — zz-test fixture: 100% voucher, expired yesterday (stored idea)
  v_org := pg_temp.zz_mk_org('zz3', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'zz3-1', 100, array['garage']::text[], false, false, -1);
  perform pg_temp.zz_check('zz3 zz-test fixture: 100% voucher, expired yesterday (stored idea)', 'idea', public.effective_plan(v_org));
  -- matrix
  -- m01 — stored idea, nothing else
  v_org := pg_temp.zz_mk_org('m01', 'idea');
  perform pg_temp.zz_check('m01 stored idea, nothing else', 'idea', public.effective_plan(v_org));
  -- m02 — stored motherfunding, nothing else
  v_org := pg_temp.zz_mk_org('m02', 'motherfunding');
  perform pg_temp.zz_check('m02 stored motherfunding, nothing else', 'motherfunding', public.effective_plan(v_org));
  -- m03 — idea + 100% running, covers motherfunding
  v_org := pg_temp.zz_mk_org('m03', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm03-1', 100, array['motherfunding']::text[], false, false, 30);
  perform pg_temp.zz_check('m03 idea + 100% running, covers motherfunding', 'motherfunding', public.effective_plan(v_org));
  -- m04 — idea + 100% that never ends (benefit_ends_at null)
  v_org := pg_temp.zz_mk_org('m04', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm04-1', 100, array['motherfunding']::text[], false, false, null::int);
  perform pg_temp.zz_check('m04 idea + 100% that never ends (benefit_ends_at null)', 'motherfunding', public.effective_plan(v_org));
  -- m05 — garage + 100% running covering motherfunding (a higher tier wins)
  v_org := pg_temp.zz_mk_org('m05', 'garage');
  perform pg_temp.zz_mk_redemption(v_org, 'm05-1', 100, array['motherfunding']::text[], false, false, 30);
  perform pg_temp.zz_check('m05 garage + 100% running covering motherfunding (a higher tier wins)', 'motherfunding', public.effective_plan(v_org));
  -- m06 — motherfunding + 100% covering garage (never lowers)
  v_org := pg_temp.zz_mk_org('m06', 'motherfunding');
  perform pg_temp.zz_mk_redemption(v_org, 'm06-1', 100, array['garage']::text[], false, false, 30);
  perform pg_temp.zz_check('m06 motherfunding + 100% covering garage (never lowers)', 'motherfunding', public.effective_plan(v_org));
  -- m07 — idea + 100% that ended yesterday
  v_org := pg_temp.zz_mk_org('m07', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm07-1', 100, array['motherfunding']::text[], false, false, -1);
  perform pg_temp.zz_check('m07 idea + 100% that ended yesterday', 'idea', public.effective_plan(v_org));
  -- m08 — idea + 99% running (a partial discount grants nothing)
  v_org := pg_temp.zz_mk_org('m08', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm08-1', 99, array['motherfunding']::text[], false, false, 30);
  perform pg_temp.zz_check('m08 idea + 99% running (a partial discount grants nothing)', 'idea', public.effective_plan(v_org));
  -- m09 — idea + 100% whose code was DELETED (deleting revokes every holder)
  v_org := pg_temp.zz_mk_org('m09', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm09-1', 100, array['motherfunding']::text[], true, false, 30);
  perform pg_temp.zz_check('m09 idea + 100% whose code was DELETED (deleting revokes every holder)', 'idea', public.effective_plan(v_org));
  -- m10 — idea + 100% whose code was only DEACTIVATED (a holder keeps it until it runs out)
  v_org := pg_temp.zz_mk_org('m10', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm10-1', 100, array['motherfunding']::text[], false, true, 30);
  perform pg_temp.zz_check('m10 idea + 100% whose code was only DEACTIVATED (a holder keeps it until it runs out)', 'motherfunding', public.effective_plan(v_org));
  -- m11 — idea + one code covering garage AND motherfunding (the higher one)
  v_org := pg_temp.zz_mk_org('m11', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm11-1', 100, array['garage', 'motherfunding']::text[], false, false, 30);
  perform pg_temp.zz_check('m11 idea + one code covering garage AND motherfunding (the higher one)', 'motherfunding', public.effective_plan(v_org));
  -- m12 — idea + two 100% codes, garage and motherfunding (the higher one)
  v_org := pg_temp.zz_mk_org('m12', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm12-1', 100, array['garage']::text[], false, false, 30);
  perform pg_temp.zz_mk_redemption(v_org, 'm12-2', 100, array['motherfunding']::text[], false, false, 30);
  perform pg_temp.zz_check('m12 idea + two 100% codes, garage and motherfunding (the higher one)', 'motherfunding', public.effective_plan(v_org));
  -- m13 — idea + a 100% code that names a tier nobody has
  v_org := pg_temp.zz_mk_org('m13', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm13-1', 100, array['pro']::text[], false, false, 30);
  perform pg_temp.zz_check('m13 idea + a 100% code that names a tier nobody has', 'idea', public.effective_plan(v_org));
  -- m14 — garage + 100% covering only idea (nothing to add)
  v_org := pg_temp.zz_mk_org('m14', 'garage');
  perform pg_temp.zz_mk_redemption(v_org, 'm14-1', 100, array['idea']::text[], false, false, 30);
  perform pg_temp.zz_check('m14 garage + 100% covering only idea (nothing to add)', 'garage', public.effective_plan(v_org));
  -- m15 — idea + one deleted 100% code and one valid garage code (the valid one counts)
  v_org := pg_temp.zz_mk_org('m15', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm15-1', 100, array['motherfunding']::text[], true, false, 30);
  perform pg_temp.zz_mk_redemption(v_org, 'm15-2', 100, array['garage']::text[], false, false, 30);
  perform pg_temp.zz_check('m15 idea + one deleted 100% code and one valid garage code (the valid one counts)', 'garage', public.effective_plan(v_org));
  -- m16 — idea + tech master badge, free forever (free_until null)
  v_org := pg_temp.zz_mk_org('m16', 'idea');
  perform pg_temp.zz_mk_badge(v_org, 'tech_master', 'motherfunding', null::int, false);
  perform pg_temp.zz_check('m16 idea + tech master badge, free forever (free_until null)', 'motherfunding', public.effective_plan(v_org));
  -- m17 — idea + pioneer badge, free period still running
  v_org := pg_temp.zz_mk_org('m17', 'idea');
  perform pg_temp.zz_mk_badge(v_org, 'pioneer', 'motherfunding', 20, false);
  perform pg_temp.zz_check('m17 idea + pioneer badge, free period still running', 'motherfunding', public.effective_plan(v_org));
  -- m18 — idea + pioneer badge, free period ended yesterday
  v_org := pg_temp.zz_mk_org('m18', 'idea');
  perform pg_temp.zz_mk_badge(v_org, 'pioneer', 'motherfunding', -1, false);
  perform pg_temp.zz_check('m18 idea + pioneer badge, free period ended yesterday', 'idea', public.effective_plan(v_org));
  -- m19 — idea + badge that was revoked
  v_org := pg_temp.zz_mk_org('m19', 'idea');
  perform pg_temp.zz_mk_badge(v_org, 'tech_master', 'motherfunding', null::int, true);
  perform pg_temp.zz_check('m19 idea + badge that was revoked', 'idea', public.effective_plan(v_org));
  -- m20 — idea + badge with no free tier (the shape of the legacy pioneer flag)
  v_org := pg_temp.zz_mk_org('m20', 'idea');
  perform pg_temp.zz_mk_badge(v_org, 'pioneer', null::text, null::int, false);
  perform pg_temp.zz_check('m20 idea + badge with no free tier (the shape of the legacy pioneer flag)', 'idea', public.effective_plan(v_org));
  -- m21 — idea + garage voucher + motherfunding badge (the badge is higher)
  v_org := pg_temp.zz_mk_org('m21', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm21-1', 100, array['garage']::text[], false, false, 30);
  perform pg_temp.zz_mk_badge(v_org, 'tech_master', 'motherfunding', null::int, false);
  perform pg_temp.zz_check('m21 idea + garage voucher + motherfunding badge (the badge is higher)', 'motherfunding', public.effective_plan(v_org));
  -- m22 — idea + motherfunding voucher + motherfunding badge (a tie: the voucher is named)
  v_org := pg_temp.zz_mk_org('m22', 'idea');
  perform pg_temp.zz_mk_redemption(v_org, 'm22-1', 100, array['motherfunding']::text[], false, false, 30);
  perform pg_temp.zz_mk_badge(v_org, 'tech_master', 'motherfunding', null::int, false);
  perform pg_temp.zz_check('m22 idea + motherfunding voucher + motherfunding badge (a tie: the voucher is named)', 'motherfunding', public.effective_plan(v_org));
  -- m23 — garage + garage voucher + garage badge (nothing outranks the stored plan)
  v_org := pg_temp.zz_mk_org('m23', 'garage');
  perform pg_temp.zz_mk_redemption(v_org, 'm23-1', 100, array['garage']::text[], false, false, 30);
  perform pg_temp.zz_mk_badge(v_org, 'tech_master', 'garage', null::int, false);
  perform pg_temp.zz_check('m23 garage + garage voucher + garage badge (nothing outranks the stored plan)', 'garage', public.effective_plan(v_org));
  -- real organisations, read live (they only mean something while the situation they describe lasts)
  -- r1 (live) — Wisify Tech Solutions — stored idea, PIONEER_100 running
  perform pg_temp.zz_check('r1 LIVE Wisify Tech Solutions — stored idea, PIONEER_100 running', 'motherfunding', public.effective_plan('4d2f492d-a631-480a-8901-aa315f4f41b4'::uuid));
  -- r2 (live) — ABOUT FOOD — stored motherfunding, ZEROCOST running
  perform pg_temp.zz_check('r2 LIVE ABOUT FOOD — stored motherfunding, ZEROCOST running', 'motherfunding', public.effective_plan('7c1a5974-000b-4dd2-8632-87f99250cf68'::uuid));
  -- r3 (live) — Gripwise Tech, Lda — stored motherfunding, no voucher
  perform pg_temp.zz_check('r3 LIVE Gripwise Tech, Lda — stored motherfunding, no voucher', 'motherfunding', public.effective_plan('1d3dff6e-fc41-420a-868a-339d08151c58'::uuid));
  -- r4 (live) — Lunia — stored idea, no voucher
  perform pg_temp.zz_check('r4 LIVE Lunia — stored idea, no voucher', 'idea', public.effective_plan('8c669401-bea8-4f10-87ac-c05917ca2f1f'::uuid));
  -- r5 (live) — ablute_ — stored idea; every voucher deleted; the pioneer free period ended 11/09
  perform pg_temp.zz_check('r5 LIVE ablute_ — stored idea; every voucher deleted; the pioneer free period ended 11/09', 'idea', public.effective_plan('bca54499-03c8-469b-a48d-b9f442e44f69'::uuid));
  -- r6 (live) — Insignals — stored idea, PVPIONEER100 running (not on the prompt's list; affected all the same)
  perform pg_temp.zz_check('r6 LIVE Insignals — stored idea, PVPIONEER100 running (not on the prompt''s list; affected all the same)', 'motherfunding', public.effective_plan('94dc7fe1-ff32-4d24-9ceb-a058c1cfa963'::uuid));
  -- values the database cannot hold (orgs.plan is a foreign key to plans(key)): TypeScript only
  -- t01 — legacy stored value 'paid' is the entry paid tier: not run here — orgs.plan is a foreign key to plans(key): 'paid' cannot exist in the database
  -- t02 — no plan at all is the free tier: not run here — orgs.plan is not null
  -- t03 — an unknown stored value is the free tier: not run here — foreign key to plans(key)
  -- <<< GENERATED PARITY CASES <<<

  -- 5. THE WALLET, old logic against new, for EVERY organisation in production (as one of its members, the way the app asks; the old
  -- ai_wallet_status is the copy from 1c, with only the column qualification, because the original raises)
  for r in select o.id, o.name, o.plan,
                  (select m.user_id from public.org_members m where m.org_id = o.id order by m.role, m.user_id limit 1) as member
             from public.orgs o where o.name not like 'zz-test-914-%' order by o.created_at loop
    if r.member is null then continue; end if;
    perform pg_temp.zz_as(r.member);
    select s.used, s.monthly_limit, s.remaining, s.action_cost, s.action_enabled, s.is_test into v_a from public.zz_old_ai_wallet_status(r.id, 'compose_outreach') s;
    select s.used, s.monthly_limit, s.remaining, s.action_cost, s.action_enabled, s.is_test into v_b from public.ai_wallet_status(r.id, 'compose_outreach') s;
    v_eff := public.effective_plan(r.id);
    v_total := v_total + 1;
    if v_a is distinct from v_b then
      v_diffs := v_diffs || jsonb_build_object('org', r.name, 'stored', r.plan, 'effective', v_eff, 'limit_old', v_a.monthly_limit, 'limit_new', v_b.monthly_limit,
                                               'remaining_old', v_a.remaining, 'remaining_new', v_b.remaining, 'used', v_b.used);
      -- the only thing allowed to differ is the limit (and what is left of it), and only where the plan on the day is not the stored one
      if v_eff = r.plan or v_a.used is distinct from v_b.used or v_a.action_cost is distinct from v_b.action_cost
         or v_a.action_enabled is distinct from v_b.action_enabled or v_a.is_test is distinct from v_b.is_test then
        v_unexplained := v_unexplained + 1;
      end if;
    end if;
  end loop;
  perform pg_temp.zz_info('W0 organisations with a member compared (old wallet vs new wallet)', v_total::text);
  perform pg_temp.zz_info('W1 organisations whose wallet changes with the migration, TODAY (' || jsonb_array_length(v_diffs) || ')', v_diffs::text);
  perform pg_temp.zz_check('W1 every change is a LIMIT that moves because the org is on a free trial or badge (nothing else differs; nobody else moves)', '0', v_unexplained::text);

  -- the two organisations the prompt is about, one by one
  perform pg_temp.zz_as((select m.user_id from public.org_members m where m.org_id = v_wis limit 1));
  select s.monthly_limit into v_old_limit from public.zz_old_ai_wallet_status(v_wis, 'compose_outreach') s;
  select s.monthly_limit into v_new_limit from public.ai_wallet_status(v_wis, 'compose_outreach') s;
  perform pg_temp.zz_check('W2 Wisify (idea, PIONEER_100 running): monthly limit old -> new', '80 -> 500', v_old_limit || ' -> ' || v_new_limit);
  perform pg_temp.zz_as((select m.user_id from public.org_members m where m.org_id = v_ins limit 1));
  select s.monthly_limit into v_old_limit from public.zz_old_ai_wallet_status(v_ins, 'compose_outreach') s;
  select s.monthly_limit into v_new_limit from public.ai_wallet_status(v_ins, 'compose_outreach') s;
  perform pg_temp.zz_check('W2 Insignals (idea, PVPIONEER100 running): monthly limit old -> new', '80 -> 500', v_old_limit || ' -> ' || v_new_limit);
  perform pg_temp.zz_as((select m.user_id from public.org_members m where m.org_id = v_about limit 1));
  select s.monthly_limit into v_old_limit from public.zz_old_ai_wallet_status(v_about, 'compose_outreach') s;
  select s.monthly_limit into v_new_limit from public.ai_wallet_status(v_about, 'compose_outreach') s;
  perform pg_temp.zz_check('W2 ABOUT FOOD (stored motherfunding already): unchanged', '500 -> 500', v_old_limit || ' -> ' || v_new_limit);

  -- charging: the same action, old function against new, each in a sub-transaction that is rolled back (the charge must not pile up)
  perform pg_temp.zz_as((select m.user_id from public.org_members m where m.org_id = v_wis limit 1));
  begin
    select c.ok, c.monthly_limit, c.used into v_a from public.zz_old_charge_ai_action(v_wis, 'compose_outreach') c;
    v_old_limit := v_a.monthly_limit;
    raise exception using errcode = 'P0001', message = 'rehearsal: undo this charge';
  exception when others then null;
  end;
  begin
    select c.ok, c.monthly_limit, c.used into v_b from public.charge_ai_action(v_wis, 'compose_outreach') c;
    v_new_limit := v_b.monthly_limit;
    raise exception using errcode = 'P0001', message = 'rehearsal: undo this charge';
  exception when others then null;
  end;
  perform pg_temp.zz_check('W3 charge_ai_action for Wisify: the limit it charges against, old -> new (and the charge goes through)', '80 -> 500 | true', v_old_limit || ' -> ' || v_new_limit || ' | ' || v_b.ok::text);

  -- the wallet end to end on the three zz-test fixtures of the prompt, with a member each
  select u.id into v_member from auth.users u where not exists (select 1 from public.org_members m where m.user_id = u.id) order by u.created_at limit 1;
  if v_member is null then
    perform pg_temp.zz_info('W4 fixtures', 'no user without an org was left to be a member of the zz-test fixtures: the fixture wallet cases were not run');
  else
    v_org := pg_temp.zz_mk_org('w-novoucher', 'garage');
    insert into public.org_members(org_id, user_id, role) values (v_org, v_member, 'owner');
    perform pg_temp.zz_as(v_member);
    select s.monthly_limit into v_new_limit from public.ai_wallet_status(v_org, 'compose_outreach') s;
    perform pg_temp.zz_check('W4 fixture, stored garage, no voucher: limit', '200', v_new_limit::text);
    delete from public.org_members where org_id = v_org;

    v_org := pg_temp.zz_mk_org('w-voucher', 'idea');
    perform pg_temp.zz_mk_redemption(v_org, 'w-voucher', 100, array['garage'], false, false, 30);
    insert into public.org_members(org_id, user_id, role) values (v_org, v_member, 'owner');
    select s.monthly_limit into v_new_limit from public.ai_wallet_status(v_org, 'compose_outreach') s;
    perform pg_temp.zz_check('W4 fixture, stored idea + 100% voucher running (covers garage): limit', '200', v_new_limit::text);
    delete from public.org_members where org_id = v_org;

    v_org := pg_temp.zz_mk_org('w-expired', 'idea');
    perform pg_temp.zz_mk_redemption(v_org, 'w-expired', 100, array['garage'], false, false, -1);
    insert into public.org_members(org_id, user_id, role) values (v_org, v_member, 'owner');
    select s.monthly_limit into v_new_limit from public.ai_wallet_status(v_org, 'compose_outreach') s;
    perform pg_temp.zz_check('W4 fixture, stored idea + 100% voucher that ended yesterday: limit (reverts by itself)', '80', v_new_limit::text);
    delete from public.org_members where org_id = v_org;
  end if;

  -- 6. THE PATH THE APP REALLY TAKES: the user's own session, role 'authenticated'. effective_plan() is revoked from that role on
  -- purpose and is reached only through the two SECURITY DEFINER wallet functions; if that did not work, every AI action of every
  -- founder would raise. Proved with Wisify's member, plus a control (the function itself is refused to 'authenticated').
  perform pg_temp.zz_as((select m.user_id from public.org_members m where m.org_id = v_wis limit 1));
  execute 'set local role authenticated';
  select s.monthly_limit into v_new_limit from public.ai_wallet_status(v_wis, 'compose_outreach') s;
  begin perform public.effective_plan(v_wis); v_got := 'NO ERROR'; exception when insufficient_privilege then v_got := sqlstate; end;
  execute 'reset role';
  perform pg_temp.zz_check('P1 AS ROLE authenticated (the app path): Wisify ai_wallet_status limit', '500', v_new_limit::text);
  perform pg_temp.zz_check('P1 control: as authenticated effective_plan() itself is refused (so the line above really ran as that role)', '42501', v_got);

  -- 7. who may call what
  perform pg_temp.zz_check('P2 effective_plan: anon / authenticated / service_role may execute it', 'false|false|true',
    has_function_privilege('anon', 'public.effective_plan(uuid)', 'execute')::text || '|' ||
    has_function_privilege('authenticated', 'public.effective_plan(uuid)', 'execute')::text || '|' ||
    has_function_privilege('service_role', 'public.effective_plan(uuid)', 'execute')::text);
  perform pg_temp.zz_check('P2 the wallet functions stay callable by the founder session (authenticated may execute both)', 'true|true',
    has_function_privilege('authenticated', 'public.ai_wallet_status(uuid,text)', 'execute')::text || '|' ||
    has_function_privilege('authenticated', 'public.charge_ai_action(uuid,text)', 'execute')::text);

  -- 8. THE ANSWER
  select string_agg(
           case when mode = 'info' then 'INFO ' when (mode = 'exact' and expected is not distinct from got) then 'PASS ' else 'FAIL ' end
           || name || case when mode = 'info' then ' :: ' || coalesce(got, '') else ' :: expected [' || coalesce(expected, 'null') || '] got [' || coalesce(got, 'null') || ']' end,
           E'\n' order by seq),
         count(*) filter (where mode = 'exact' and expected is not distinct from got),
         count(*) filter (where mode <> 'info' and not (mode = 'exact' and expected is not distinct from got))
    into v_out, v_pass, v_fail from zz_res;
  raise exception E'REHEARSAL_RESULT pass=% fail=%\n%', v_pass, v_fail, v_out;
end
$rehearsal$;
