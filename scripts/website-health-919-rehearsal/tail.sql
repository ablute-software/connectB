  -- <<< MIGRATION <<<

  -- 1. the structure
  select count(*) into v_n from information_schema.columns where table_schema = 'public' and table_name = 'org_website_audits';
  perform pg_temp.zz_check('M1 org_website_audits has its 16 columns', '16', v_n::text);
  perform pg_temp.zz_check('M2 orgs.website_score_visible is boolean, not null, default false', 'boolean | NO | false',
    (select data_type || ' | ' || is_nullable || ' | ' || column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'orgs' and column_name = 'website_score_visible'));
  perform pg_temp.zz_check('M2 and every existing org starts with it OFF', '0', (select count(*) from public.orgs where website_score_visible)::text);
  perform pg_temp.zz_check('M2 no org was added or lost', v_orgs_before::text, (select count(*) from public.orgs)::text);
  perform pg_temp.zz_check('O1 no policy was added to orgs', v_org_policies_before::text, (select count(*) from pg_policy where polrelid = 'public.orgs'::regclass)::text);
  perform pg_temp.zz_check('I1 the (org, fetched_at) index exists', '1',
    (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'org_website_audits' and indexname = 'org_website_audits_org_fetched_idx')::text);
  perform pg_temp.zz_check('R4 RLS is on and the table has exactly one policy', 'true | 1',
    (select relrowsecurity::text from pg_class where oid = 'public.org_website_audits'::regclass) || ' | '
    || (select count(*) from pg_policy where polrelid = 'public.org_website_audits'::regclass)::text);

  -- fixtures: an org with a website, a second org, one member of the first (a user who has no org yet) and someone who is NOT its member
  insert into public.orgs (name, plan, website) values ('zz-test-919-org', 'idea', 'https://example.com') returning id into v_org;
  insert into public.orgs (name, plan) values ('zz-test-919-other', 'idea') returning id into v_org2;
  select u.id into v_user from auth.users u where not exists (select 1 from public.org_members m where m.user_id = u.id) order by u.created_at limit 1;
  select u.id into v_other from auth.users u where u.id is distinct from v_user order by u.created_at desc limit 1;

  -- 2. what the table itself refuses (as the database owner: these are CHECKs, not permissions)
  begin
    insert into public.org_website_audits (org_id, url, strategy) values (v_org, 'https://example.com', 'tablet'); v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('C1 an unknown strategy is refused', '23514', v_got);
  begin
    insert into public.org_website_audits (org_id, url, strategy, score_seo) values (v_org, 'https://example.com', 'mobile', 101); v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('C2 a score above 100 is refused', '23514', v_got);
  begin
    insert into public.org_website_audits (org_id, url, strategy, score_performance) values (v_org, 'https://example.com', 'mobile', -1); v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('C3 a negative score is refused', '23514', v_got);
  begin
    insert into public.org_website_audits (org_id, url, strategy, lcp_ms) values (v_org, 'https://example.com', 'mobile', -5); v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('C4 a negative load time is refused', '23514', v_got);
  begin
    insert into public.org_website_audits (org_id, url, strategy, audits) values (v_org, 'https://example.com', 'mobile', jsonb_build_object('blob', repeat('a', 61000))); v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('C5 an audits blob over 60 KB (anything near a whole Lighthouse report) is refused', '23514', v_got);
  begin
    insert into public.org_website_audits (org_id, url, strategy) values (v_org, 'https://example.com/' || repeat('a', 2001), 'mobile'); v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('C6 a url over 2000 characters is refused', '23514', v_got);
  begin
    insert into public.org_website_audits (org_id, url, strategy, summary) values (v_org, 'https://example.com', 'mobile', repeat('a', 20001)); v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('C7 a summary over 20000 characters is refused', '23514', v_got);
  begin
    insert into public.org_website_audits (org_id, url, strategy, audits) values (v_org, 'https://example.com', 'desktop', '{"error": {"kind": "unreachable"}}'); v_got := 'OK';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('C8 a FAILED analysis (null scores, audits = {"error": ...}) is accepted', 'OK', v_got);
  delete from public.org_website_audits where org_id = v_org;
  insert into public.org_website_audits (org_id, url, strategy, score_performance, score_seo, score_accessibility, score_best_practices, lcp_ms, cls, inp_ms, audits)
    values (v_org, 'https://example.com', 'mobile', 61, 85, 82, 96, 1243, 0.0011, 180, '{"items": [{"id": "image-alt", "title": "Image elements do not have [alt] attributes"}]}');
  perform pg_temp.zz_check('C9 a complete analysis is accepted and starts with no summary', 'true',
    (select (summary is null and summary_model is null and summary_credits is null and score_best_practices = 96)::text from public.org_website_audits where org_id = v_org));

  -- 3. deleting an org takes its analyses with it
  insert into public.org_website_audits (org_id, url, strategy) values (v_org2, 'https://example.org', 'mobile');
  delete from public.orgs where id = v_org2;
  perform pg_temp.zz_check('D1 an org deleted takes its analyses with it (ON DELETE CASCADE)', '0', (select count(*) from public.org_website_audits where org_id = v_org2)::text);

  -- 4. the action the wallet meters
  perform pg_temp.zz_check('A1 ai_actions has website_summary: cost, enabled, category', '2|true|client',
    (select credit_cost || '|' || enabled || '|' || category from public.ai_actions where key = 'website_summary'));
  perform pg_temp.zz_check('A1 exactly one row was added to ai_actions', (v_actions_before + 1)::text, (select count(*) from public.ai_actions)::text);

  if v_user is null then
    perform pg_temp.zz_info('W fixtures', 'no user without an org was left to be a member of the zz-test fixture: the wallet and the access cases were not run');
  else
    insert into public.org_members (org_id, user_id, role) values (v_org, v_user, 'owner');

    -- 5. the charge, as the founder's own session (the path the route takes)
    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    select 'ok=' || c.ok || ' used=' || c.used || ' limit=' || c.monthly_limit || ' remaining=' || c.remaining into v_got from public.charge_ai_action(v_org, 'website_summary') c;
    execute 'reset role';
    perform pg_temp.zz_check('W1 a summary charges 2 credits against an Elementary wallet (80)', 'ok=true used=2 limit=80 remaining=78', v_got);

    update public.orgs set ai_credits_used_this_period = 79 where id = v_org;
    execute 'set local role authenticated';
    select 'ok=' || c.ok || ' used=' || c.used || ' refused=' || (c.reason like 'AI credits limit reached%')::text into v_got from public.charge_ai_action(v_org, 'website_summary') c;
    execute 'reset role';
    perform pg_temp.zz_check('W2 with 1 credit left (79 of 80) the wallet REFUSES, charges nothing, and says why', 'ok=false used=79 refused=true', v_got);

    -- 6. who can read and who can write
    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    select count(*)::text into v_got from public.org_website_audits;
    execute 'reset role';
    perform pg_temp.zz_check('R1 a member of the org reads its analysis (and only that: the fixture row)', '1', v_got);

    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    begin insert into public.org_website_audits (org_id, url, strategy) values (v_org, 'https://example.com', 'desktop'); v_got := 'NO ERROR'; exception when others then v_got := sqlstate; end;
    execute 'reset role';
    perform pg_temp.zz_check('R2 a member cannot INSERT an analysis (only the service role writes: no scores can be made up from a browser)', '42501', v_got);

    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    begin update public.org_website_audits set score_seo = 100 where org_id = v_org; v_got := 'NO ERROR'; exception when others then v_got := sqlstate; end;
    execute 'reset role';
    perform pg_temp.zz_check('R2 ...nor UPDATE one', '42501', v_got);

    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    begin delete from public.org_website_audits where org_id = v_org; v_got := 'NO ERROR'; exception when others then v_got := sqlstate; end;
    execute 'reset role';
    perform pg_temp.zz_check('R2 ...nor DELETE one', '42501', v_got);

    if v_other is not null then
      perform pg_temp.zz_as(v_other);
      execute 'set local role authenticated';
      select count(*)::text into v_got from public.org_website_audits where org_id = v_org;
      execute 'reset role';
      perform pg_temp.zz_check('R3 someone who is NOT a member of the org (an investor, another startup) reads nothing', '0', v_got);
    end if;
  end if;

  execute 'set local role anon';
  begin perform 1 from public.org_website_audits limit 1; v_got := 'NO ERROR'; exception when others then v_got := sqlstate; end;
  execute 'reset role';
  perform pg_temp.zz_check('R3 a signed-out visitor (anon) is refused outright', '42501', v_got);

  -- 7. what an owner of the day-one data should know
  perform pg_temp.zz_info('R5 orgs that could run the check on day one (a website on file): all / real (not test, not internal)', v_orgs_with_site || ' / ' || v_orgs_with_site_real);

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
