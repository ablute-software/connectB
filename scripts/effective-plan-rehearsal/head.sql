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
