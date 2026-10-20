-- Developer Viewer — ensaio da migração 20261020110000_developer_viewer_reads_more_tables.sql (e do seu rollback) contra os DADOS REAIS de produção, num
-- único statement (um bloco DO) que acaba SEMPRE num RAISE EXCEPTION: nada pode ficar gravado. GERADO por
-- scripts/compose-developer-viewer-reads-rehearsal.mjs a partir de head.sql + a migração + mid.sql + o rollback + tail.sql — não editar à mão; um teste
-- (developer-viewer-reads-rehearsal.test.ts) falha se divergir.
--
-- O que prova, tabela a tabela (13), como a pessoa que o Viewer realmente é — um platform admin, SEM ser membro das orgs que está a ver:
--   ANTES   o admin vê 0 linhas das orgs onde não é membro (o defeito: ecrã em branco, sem erro);
--   DEPOIS  vê exactamente as mesmas linhas que o dono da base vê nessas orgs (nem uma a mais, nem a menos);
--   sempre  um utilizador que NÃO é admin continua a ver 0 linhas das orgs onde não é membro (nada vazou), e o admin não consegue alterar nem apagar
--           nenhuma linha dessas orgs (a política nova só lê);
--   ROLLBACK volta ao ANTES.
-- Para correr: colar o ficheiro inteiro numa chamada execute_sql (Supabase MCP) ou em psql. A resposta é um ERRO que começa por "REHEARSAL_RESULT".
do $rehearsal$
declare
  v_tables text[] := array['cap_table_entries', 'funding_rounds', 'roadmap_events', 'roadmap_categories', 'company_roadmap_milestones', 'org_axis_classifications',
    'rejection_codes', 'interaction_documents', 'interaction_edits', 'entity_reopen_snapshots', 'sherlock_next_snoozes', 'review_clarifications', 'investor_deal_signals'];
  t text; v_admin uuid; v_member uuid; v_admin_orgs uuid[]; v_member_orgs uuid[];
  v_total bigint; v_seen bigint; v_n bigint; v_m bigint; v_with_data int := 0;
  v_out text; v_pass int; v_fail int;
begin
  create temp table zz_res (seq serial primary key, name text, expected text, got text, mode text);

  create function pg_temp.zz_check(p_name text, p_expected text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, p_expected, p_got, 'exact'); end $f$;

  create function pg_temp.zz_info(p_name text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, null, p_got, 'info'); end $f$;

  -- rows of orgs the person is NOT a member of, as the database owner sees them (RLS does not apply)
  create function pg_temp.zz_foreign_total(p_tbl text, p_orgs uuid[]) returns bigint language plpgsql as $f$
  declare n bigint;
  begin execute format('select count(*) from public.%I where org_id <> all ($1)', p_tbl) into n using p_orgs; return n; end $f$;

  -- the same rows, as that person sees them through the browser's session (authenticated role + their JWT subject): Row Level Security decides
  create function pg_temp.zz_foreign_seen(p_uid uuid, p_tbl text, p_orgs uuid[]) returns bigint language plpgsql as $f$
  declare n bigint;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    execute 'set local role authenticated';
    execute format('select count(*) from public.%I where org_id <> all ($1)', p_tbl) into n using p_orgs;
    execute 'reset role';
    return n;
  end $f$;

  -- what that person could change in orgs they are NOT a member of: rows an UPDATE and a DELETE reach under their session (0 and 0 when no policy gives
  -- them a write path). Only foreign rows are ever touched — their own org's rows are theirs to change, and the first run of this rehearsal counted those
  -- too (8 "updated" cap-table rows were the admin's OWN org). The whole thing is one DO statement that ends in RAISE EXCEPTION, so nothing it does persists.
  create function pg_temp.zz_writes(p_uid uuid, p_tbl text, p_orgs uuid[]) returns text language plpgsql as $f$
  declare u bigint; d bigint;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    execute 'set local role authenticated';
    execute format('with x as (update public.%I set org_id = org_id where org_id <> all ($1) returning 1) select count(*) from x', p_tbl) into u using p_orgs;
    execute format('with x as (delete from public.%I where org_id <> all ($1) returning 1) select count(*) from x', p_tbl) into d using p_orgs;
    execute 'reset role';
    return u || ' updated / ' || d || ' deleted';
  end $f$;

  create function pg_temp.zz_dev_policy(p_tbl text) returns text language sql as $f$
    select coalesce(string_agg(polname::text || ' [' || polcmd::text || ']', ', '), 'none')
      from pg_policy where polrelid = ('public.' || p_tbl)::regclass and polname = p_tbl || '_ablute_qa_read'
  $f$;

  -- 0. the two people the rehearsal speaks as
  select user_id into v_admin from public.platform_admins order by user_id limit 1;
  select m.user_id into v_member from public.org_members m
    where not exists (select 1 from public.platform_admins a where a.user_id = m.user_id) order by m.user_id limit 1;
  if v_admin is null or v_member is null then
    raise exception E'REHEARSAL_RESULT pass=0 fail=1\nFAIL fixtures :: expected [a platform admin and a plain org member] got [admin=%, member=%]', v_admin, v_member;
  end if;
  select coalesce(array_agg(org_id), '{}') into v_admin_orgs from public.org_members where user_id = v_admin;
  select coalesce(array_agg(org_id), '{}') into v_member_orgs from public.org_members where user_id = v_member;
  perform pg_temp.zz_info('P0 the admin is a member of / the plain member is a member of (orgs)', cardinality(v_admin_orgs) || ' / ' || cardinality(v_member_orgs));

  -- 1. BEFORE the migration: the defect, measured
  foreach t in array v_tables loop
    v_total := pg_temp.zz_foreign_total(t, v_admin_orgs);
    if v_total > 0 then v_with_data := v_with_data + 1; end if;
    perform pg_temp.zz_check('A1 before: ' || t || ' — the admin sees 0 of the ' || v_total || ' rows of orgs they are not a member of (a blank card)', '0', pg_temp.zz_foreign_seen(v_admin, t, v_admin_orgs)::text);
    perform pg_temp.zz_check('A1 before: ' || t || ' — no developer policy yet', 'none', pg_temp.zz_dev_policy(t));
  end loop;
  perform pg_temp.zz_info('A0 tables (of 13) that have rows in orgs the admin is not a member of — the ones where the difference is visible', v_with_data::text);

  -- 2. THE MIGRATION
  -- >>> MIGRATION (verbatim) >>>
