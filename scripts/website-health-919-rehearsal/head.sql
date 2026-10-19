-- Prompt 919 — ensaio da migração 20261016140000_website_health.sql contra os DADOS REAIS de produção, num único statement
-- (um bloco DO) que acaba SEMPRE num RAISE EXCEPTION: nada pode ficar gravado. GERADO por
-- scripts/compose-website-health-919-rehearsal.mjs a partir de head.sql + a migração + tail.sql — não editar à mão; um teste
-- (website-health-919-rehearsal.test.ts) falha se divergir.
--
-- Para correr: colar o ficheiro inteiro numa chamada execute_sql (Supabase MCP) ou em psql. A resposta é um ERRO que começa por
-- "REHEARSAL_RESULT": cada linha é PASS/FAIL/INFO com o esperado e o obtido.
do $rehearsal$
declare
  v_org uuid; v_org2 uuid; v_user uuid; v_other uuid; v_got text; v_n int;
  v_orgs_before int; v_org_policies_before int; v_actions_before int; v_orgs_with_site int; v_orgs_with_site_real int;
  v_out text; v_pass int; v_fail int;
begin
  create temp table zz_res (seq serial primary key, name text, expected text, got text, mode text);

  create function pg_temp.zz_as(p_uid uuid) returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
  end $f$;

  create function pg_temp.zz_check(p_name text, p_expected text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, p_expected, p_got, 'exact'); end $f$;

  create function pg_temp.zz_info(p_name text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, null, p_got, 'info'); end $f$;

  -- 0. production BEFORE the migration
  select count(*) into v_orgs_before from public.orgs;
  select count(*) into v_org_policies_before from pg_policy where polrelid = 'public.orgs'::regclass;
  select count(*) into v_actions_before from public.ai_actions;
  select count(*) filter (where coalesce(btrim(website), '') <> ''),
         count(*) filter (where coalesce(btrim(website), '') <> '' and not coalesce(is_test, false) and not coalesce(is_internal, false))
    into v_orgs_with_site, v_orgs_with_site_real from public.orgs;
  perform pg_temp.zz_info('P0 production before: orgs in total / with a website / real (not test, not internal) with a website', v_orgs_before || ' / ' || v_orgs_with_site || ' / ' || v_orgs_with_site_real);

  -- >>> MIGRATION (verbatim) >>>
