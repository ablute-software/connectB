-- Prompt 918 — ensaio da migração 20261015130000_company_badges_public_source.sql contra os DADOS REAIS de produção, num único
-- statement (um bloco DO) que acaba SEMPRE num RAISE EXCEPTION: nada pode ficar gravado. GERADO por
-- scripts/compose-company-badges-918-rehearsal.mjs a partir de head.sql + a migração + tail.sql — não editar à mão; um teste
-- (company-badges-918-rehearsal.test.ts) falha se divergir.
--
-- Para correr: colar o ficheiro inteiro numa chamada execute_sql (Supabase MCP) ou em psql. A resposta é um ERRO que começa por
-- "REHEARSAL_RESULT": cada linha é PASS/FAIL/INFO com o esperado e o obtido.
do $rehearsal$
declare
  v_org uuid; v_user uuid; v_b uuid; v_b2 uuid; v_got text; v_n int;
  v_total_before int; v_verified_before int; v_verified_names text; v_untouched_before text; v_untouched_after text;
  v_actions_before int;
  v_out text; v_pass int; v_fail int;
begin
  create temp table zz_res (seq serial primary key, name text, expected text, got text, mode text);

  create function pg_temp.zz_as(p_uid uuid) returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
  end $f$;

  create function pg_temp.zz_service() returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    perform set_config('request.jwt.claim.sub', '', true);
  end $f$;

  create function pg_temp.zz_check(p_name text, p_expected text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, p_expected, p_got, 'exact'); end $f$;

  create function pg_temp.zz_info(p_name text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, null, p_got, 'info'); end $f$;

  -- plpgsql, not sql: this runs BEFORE the migration adds source_url & co., and a sql function's body is checked against the table at CREATE time
  create function pg_temp.zz_state(p_id uuid) returns text language plpgsql as $f$
  declare v text;
  begin
    select coalesce(verification_status, '∅') || ' | note=' || coalesce(verification_note, '∅') || ' | verified_at=' || (verified_at is not null)::text
        || ' | src=' || coalesce(source_url, '∅') || ' | by=' || coalesce(source_found_by, '∅') || ' | title=' || coalesce(source_title, '∅')
        || ' | logo=' || coalesce(logo_url, '∅')
      into v from public.company_badges where id = p_id;
    return v;
  end $f$;

  -- 0. production BEFORE the migration
  select count(*) into v_total_before from public.company_badges;
  select count(*) into v_verified_before from public.company_badges where verification_status = 'verified';
  select string_agg(o.name || ' / ' || b.name || ' (' || coalesce(b.year::text, '—') || ')', '; ' order by o.name, b.name) into v_verified_names
    from public.company_badges b join public.orgs o on o.id = b.org_id where b.verification_status = 'verified';
  -- the rows the backfill must NOT touch: everything that is not verified
  select coalesce(string_agg(id::text || ':' || verification_status || ':' || coalesce(verification_note, ''), ',' order by id), '') into v_untouched_before
    from public.company_badges where verification_status <> 'verified';
  select count(*) into v_actions_before from public.ai_actions;
  perform pg_temp.zz_info('P0 production before: badges in total / verified', v_total_before || ' / ' || v_verified_before);
  perform pg_temp.zz_info('P0 the verified ones (every one is demoted by the backfill: none has a source)', coalesce(v_verified_names, '(none)'));

  -- >>> MIGRATION (verbatim) >>>
