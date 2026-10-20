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
-- Developer Viewer (20/10/2026, Nuno): "Cap table shows no data in ablute_ — I know it has data and it was not displayed. The same with Photos & media and
-- MatchDeal." In a Developer Viewer session the signed-in person is a developer (a platform admin) who is NOT a member of the org on screen, and the
-- founder workspace reads many tables DIRECTLY from the browser (store-supabase.tsx's loadAll, and a few cards), so Row Level Security decides what comes
-- back. A table whose only policy is `is_org_member(org_id)` answers ZERO rows to the developer — no error, just a blank card.
--
-- Migration 0051 gave developers a read-only policy (`<table>_ablute_qa_read … for select using (is_ablute_developer())`) for the tables that existed then,
-- and 0119 closed eight more by querying production. This closes the thirteen that were added after them and that the browser reads — found twice, by two
-- independent routes that agree: by querying pg_policy on production for every table the store loads (20/10/2026), and by walking the source for every
-- `.from('<table>')` in a client file (src/lib/developer-viewer-rls.test.ts, which now fails when a table is added without this policy).
--
--   cap_table_entries · funding_rounds (Previous funding) · roadmap_events · roadmap_categories · company_roadmap_milestones (Roadmap) ·
--   org_axis_classifications · rejection_codes · interaction_documents · interaction_edits · entity_reopen_snapshots · sherlock_next_snoozes ·
--   review_clarifications (Facts & Clarifications) · investor_deal_signals (the ticket-signal card)
--
-- READ-ONLY, ADDITIVE, and nothing existing is touched: one brand-new `for select` policy per table, exactly the 0051 shape (policies of a table are OR-ed, so
-- a member's access is unchanged and a developer gains only SELECT). Nothing here lets a developer insert, update or delete a founder's row; the Developer
-- Viewer's own write block (viewer-write-gate, assertNotViewer, the frame) stays what stops a click.
--
-- WHAT IT EXPOSES, said plainly: a platform admin can now read any org's cap table, previous funding, roadmap and the few small tables above through the
-- browser — the same reach they already have over its documents, interactions, people and team (0051). The admins ARE the support team (platform_admins);
-- the Viewer exists so they can see what a founder sees. No credentials or tokens live in any of these tables (the ones 0119 deliberately kept out —
-- email_connections, matchdeal_pairing_tokens, vault_data_room_pins — are not touched).
--
-- Applied to production only after Nuno's explicit "sim" (DECISIONS.md, 20/10/2026). Rehearsed beforehand against production data in one DO statement that
-- always ends in RAISE EXCEPTION (scripts/verify-developer-viewer-reads.sql, which embeds THIS file verbatim); rollback in scripts/rollback-developer-viewer-reads.sql.
drop policy if exists cap_table_entries_ablute_qa_read on public.cap_table_entries;
create policy cap_table_entries_ablute_qa_read on public.cap_table_entries for select using (public.is_ablute_developer());

drop policy if exists funding_rounds_ablute_qa_read on public.funding_rounds;
create policy funding_rounds_ablute_qa_read on public.funding_rounds for select using (public.is_ablute_developer());

drop policy if exists roadmap_events_ablute_qa_read on public.roadmap_events;
create policy roadmap_events_ablute_qa_read on public.roadmap_events for select using (public.is_ablute_developer());

drop policy if exists roadmap_categories_ablute_qa_read on public.roadmap_categories;
create policy roadmap_categories_ablute_qa_read on public.roadmap_categories for select using (public.is_ablute_developer());

drop policy if exists company_roadmap_milestones_ablute_qa_read on public.company_roadmap_milestones;
create policy company_roadmap_milestones_ablute_qa_read on public.company_roadmap_milestones for select using (public.is_ablute_developer());

drop policy if exists org_axis_classifications_ablute_qa_read on public.org_axis_classifications;
create policy org_axis_classifications_ablute_qa_read on public.org_axis_classifications for select using (public.is_ablute_developer());

drop policy if exists rejection_codes_ablute_qa_read on public.rejection_codes;
create policy rejection_codes_ablute_qa_read on public.rejection_codes for select using (public.is_ablute_developer());

drop policy if exists interaction_documents_ablute_qa_read on public.interaction_documents;
create policy interaction_documents_ablute_qa_read on public.interaction_documents for select using (public.is_ablute_developer());

drop policy if exists interaction_edits_ablute_qa_read on public.interaction_edits;
create policy interaction_edits_ablute_qa_read on public.interaction_edits for select using (public.is_ablute_developer());

drop policy if exists entity_reopen_snapshots_ablute_qa_read on public.entity_reopen_snapshots;
create policy entity_reopen_snapshots_ablute_qa_read on public.entity_reopen_snapshots for select using (public.is_ablute_developer());

drop policy if exists sherlock_next_snoozes_ablute_qa_read on public.sherlock_next_snoozes;
create policy sherlock_next_snoozes_ablute_qa_read on public.sherlock_next_snoozes for select using (public.is_ablute_developer());

drop policy if exists review_clarifications_ablute_qa_read on public.review_clarifications;
create policy review_clarifications_ablute_qa_read on public.review_clarifications for select using (public.is_ablute_developer());

drop policy if exists investor_deal_signals_ablute_qa_read on public.investor_deal_signals;
create policy investor_deal_signals_ablute_qa_read on public.investor_deal_signals for select using (public.is_ablute_developer());
  -- <<< MIGRATION <<<

  -- 3. AFTER the migration
  foreach t in array v_tables loop
    v_total := pg_temp.zz_foreign_total(t, v_admin_orgs);
    v_seen := pg_temp.zz_foreign_seen(v_admin, t, v_admin_orgs);
    perform pg_temp.zz_check('B1 after: ' || t || ' — the admin sees EXACTLY the rows the database owner sees in orgs they are not a member of', v_total::text, v_seen::text);
    perform pg_temp.zz_check('B2 after: ' || t || ' — the policy is read-only (select) and has the 0051 name', t || '_ablute_qa_read [r]', pg_temp.zz_dev_policy(t));
    perform pg_temp.zz_check('B3 after: ' || t || ' — a plain member of other orgs still sees NONE of the rows of orgs they do not belong to', '0', pg_temp.zz_foreign_seen(v_member, t, v_member_orgs)::text);
    perform pg_temp.zz_check('B4 after: ' || t || ' — the admin still cannot change or delete a row of an org they are not a member of (the policy only reads)', '0 updated / 0 deleted', pg_temp.zz_writes(v_admin, t, v_admin_orgs));
  end loop;

  -- 4. nothing else moved: a member's own org is read exactly as before (policies are OR-ed; this one only ever adds the developer)
  select count(*) into v_n from pg_policy where polrelid = 'public.cap_table_entries'::regclass;
  perform pg_temp.zz_check('C1 cap_table_entries now has exactly two policies: the member policy it always had, and the new developer one', '2', v_n::text);
  select count(*) into v_n from pg_policy where polrelid = 'public.cap_table_entries'::regclass and polname = 'cap_table_entries_all' and polcmd = '*';
  perform pg_temp.zz_check('C1 …and the member policy is untouched (for all, is_org_member)', '1', v_n::text);

  -- 5. the rollback, on top of the migration, in the same transaction
  -- >>> ROLLBACK (verbatim) >>>
-- Rollback of 20261020110000_developer_viewer_reads_more_tables.sql. Rehearsed on top of the migration, in the same never-committing transaction, by
-- scripts/verify-developer-viewer-reads.sql, which embeds THIS file verbatim.
--
-- WHAT IT COSTS: the Developer Viewer goes back to showing a blank Cap table, Previous funding, Roadmap, Facts & Clarifications… for an org the developer
-- is not a member of. Nothing else changes: a founder's own access never depended on these policies.
drop policy if exists investor_deal_signals_ablute_qa_read on public.investor_deal_signals;
drop policy if exists review_clarifications_ablute_qa_read on public.review_clarifications;
drop policy if exists sherlock_next_snoozes_ablute_qa_read on public.sherlock_next_snoozes;
drop policy if exists entity_reopen_snapshots_ablute_qa_read on public.entity_reopen_snapshots;
drop policy if exists interaction_edits_ablute_qa_read on public.interaction_edits;
drop policy if exists interaction_documents_ablute_qa_read on public.interaction_documents;
drop policy if exists rejection_codes_ablute_qa_read on public.rejection_codes;
drop policy if exists org_axis_classifications_ablute_qa_read on public.org_axis_classifications;
drop policy if exists company_roadmap_milestones_ablute_qa_read on public.company_roadmap_milestones;
drop policy if exists roadmap_categories_ablute_qa_read on public.roadmap_categories;
drop policy if exists roadmap_events_ablute_qa_read on public.roadmap_events;
drop policy if exists funding_rounds_ablute_qa_read on public.funding_rounds;
drop policy if exists cap_table_entries_ablute_qa_read on public.cap_table_entries;
  -- <<< ROLLBACK <<<

  -- 6. back to the defect: the rollback undoes it all
  foreach t in array v_tables loop
    perform pg_temp.zz_check('D1 after the undo script: ' || t || ' — no developer policy, and the admin is back to 0 rows of orgs they are not a member of', 'none | 0',
      pg_temp.zz_dev_policy(t) || ' | ' || pg_temp.zz_foreign_seen(v_admin, t, v_admin_orgs));
  end loop;
  select count(*) into v_n from pg_policy where polrelid = 'public.cap_table_entries'::regclass;
  perform pg_temp.zz_check('D2 after the undo script cap_table_entries has just its own member policy again', '1', v_n::text);

  -- 7. THE ANSWER
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
