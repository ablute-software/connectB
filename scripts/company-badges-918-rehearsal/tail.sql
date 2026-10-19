  -- <<< MIGRATION <<<

  -- 1. the columns, the backfill, the table's own refusals
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'company_badges' and column_name in ('source_url', 'source_title', 'source_found_by', 'logo_url', 'kind', 'updated_at');
  perform pg_temp.zz_check('M1 the six new columns exist', '6', v_n::text);

  perform pg_temp.zz_check('M2 no verified badge without a source is left', '0',
    (select count(*) from public.company_badges where verification_status = 'verified' and (source_url is null or btrim(source_url) = ''))::text);
  perform pg_temp.zz_check('M2 every badge that WAS verified (none has a source) is demoted, with the note the prompt names, no date',
    v_verified_before::text,
    (select count(*) from public.company_badges where verification_status = 'unverified' and verification_note = 'Re-verify to attach a public source' and verified_at is null)::text);
  select coalesce(string_agg(id::text || ':' || verification_status || ':' || coalesce(verification_note, ''), ',' order by id), '') into v_untouched_after
    from public.company_badges where verification_status <> 'verified' and verification_note is distinct from 'Re-verify to attach a public source';
  perform pg_temp.zz_check('M2 the backfill touched NOTHING else: every badge that was not verified is exactly as it was', 'true', (v_untouched_after = v_untouched_before)::text);
  perform pg_temp.zz_check('M2 and no row was added or lost', v_total_before::text, (select count(*) from public.company_badges)::text);

  -- fixture: an org with one member who is not in any other org (the same way the other rehearsals find one)
  insert into public.orgs (name, plan) values ('zz-test-918-org', 'idea') returning id into v_org;
  select u.id into v_user from auth.users u where not exists (select 1 from public.org_members m where m.user_id = u.id) order by u.created_at limit 1;

  begin
    insert into public.company_badges (org_id, name, verification_status, verified_at) values (v_org, 'zz-test-918 verified without source', 'verified', now());
    v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('M3 the table refuses a verified badge with no source (CHECK)', '23514', v_got);
  begin
    insert into public.company_badges (org_id, name, verification_status, source_url) values (v_org, 'zz-test-918 verified without date', 'verified', 'https://example.org/a');
    v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('M3 ...and a verified badge with no verification date', '23514', v_got);
  begin
    insert into public.company_badges (org_id, name, verification_status, source_url, verified_at) values (v_org, 'zz-test-918 verified', 'verified', 'https://example.org/a', now());
    v_got := 'OK';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('M3 ...but accepts one with a source and a date', 'OK', v_got);
  begin insert into public.company_badges (org_id, name, kind) values (v_org, 'zz-test-918 bad kind', 'trophy'); v_got := 'NO ERROR'; exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('M3 an unknown kind is refused', '23514', v_got);
  begin insert into public.company_badges (org_id, name, source_found_by) values (v_org, 'zz-test-918 bad finder', 'admin'); v_got := 'NO ERROR'; exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('M3 an unknown source_found_by is refused', '23514', v_got);
  begin insert into public.company_badges (org_id, name, source_url) values (v_org, 'zz-test-918 long url', 'https://example.org/' || repeat('a', 2001)); v_got := 'NO ERROR'; exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('M3 a source link over 2000 characters is refused', '23514', v_got);
  insert into public.company_badges (org_id, name, updated_at) values (v_org, 'zz-test-918 default kind', '2000-01-01') returning id into v_b;
  perform pg_temp.zz_check('M3 the default kind is award, the default status unverified',
    'award | unverified', (select kind || ' | ' || verification_status from public.company_badges where id = v_b));
  update public.company_badges set description = 'touch' where id = v_b;
  perform pg_temp.zz_check('U1 updated_at moves on every update (it was set to 2000-01-01 on insert)', 'true', (select (updated_at > timestamptz '2001-01-01')::text from public.company_badges where id = v_b));
  delete from public.company_badges where org_id = v_org;

  -- 2. the action the wallet meters
  perform pg_temp.zz_check('A1 ai_actions has badge_verification: cost, enabled, category', '5|true|client',
    (select credit_cost || '|' || enabled || '|' || category from public.ai_actions where key = 'badge_verification'));
  perform pg_temp.zz_check('A1 exactly one row was added to ai_actions', (v_actions_before + 1)::text, (select count(*) from public.ai_actions)::text);

  -- 3. the charge, as the founder's own session (the path the route takes)
  if v_user is null then
    perform pg_temp.zz_info('W fixtures', 'no user without an org was left to be a member of the zz-test fixture: the wallet and guard cases were not run');
  else
    insert into public.org_members (org_id, user_id, role) values (v_org, v_user, 'owner');
    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    select 'ok=' || c.ok || ' used=' || c.used || ' limit=' || c.monthly_limit || ' remaining=' || c.remaining into v_got from public.charge_ai_action(v_org, 'badge_verification') c;
    execute 'reset role';
    perform pg_temp.zz_check('W1 a verification charges 5 credits against an Elementary wallet (80)', 'ok=true used=5 limit=80 remaining=75', v_got);

    update public.orgs set ai_credits_used_this_period = 77 where id = v_org;
    execute 'set local role authenticated';
    select 'ok=' || c.ok || ' used=' || c.used || ' refused=' || (c.reason like 'AI credits limit reached%')::text into v_got from public.charge_ai_action(v_org, 'badge_verification') c;
    execute 'reset role';
    perform pg_temp.zz_check('W2 with 3 credits left (77 of 80) the wallet REFUSES, charges nothing, and says why', 'ok=false used=77 refused=true', v_got);

    -- 4. the guard: the verdict is writable only by the service role and the database owner
    -- a) an end-user INSERT claiming to be verified starts unverified; the link is kept and is the founder's
    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    insert into public.company_badges (org_id, name, year, verification_status, verification_note, verified_at, source_url, source_title, source_found_by, logo_url)
    values (v_org, 'zz-test-918 self-verified', 2023, 'verified', 'trust me', now(), 'https://example.org/award', 'T', 'sherlock', 'https://example.org/logo.png') returning id into v_b;
    execute 'reset role';
    perform pg_temp.zz_check('G1 a founder INSERT that claims "verified" starts unverified: no note, no date, no found title or logo; the link stays, marked founder',
      'unverified | note=∅ | verified_at=false | src=https://example.org/award | by=founder | title=∅ | logo=∅', pg_temp.zz_state(v_b));

    -- b) the service role (our routes) may write the verdict
    perform pg_temp.zz_service();
    update public.company_badges set verification_status = 'verified', verification_note = 'Confirmed: winner', verified_at = now(), source_url = 'https://altice.pt/premios/2023',
           source_title = 'Altice winners', source_found_by = 'sherlock', logo_url = 'https://cdn.altice.pt/logo.png' where id = v_b;
    perform pg_temp.zz_check('G2 the service role can record a verdict (status, note, date, source, title, finder, logo)',
      'verified | note=Confirmed: winner | verified_at=true | src=https://altice.pt/premios/2023 | by=sherlock | title=Altice winners | logo=https://cdn.altice.pt/logo.png', pg_temp.zz_state(v_b));
    v_got := pg_temp.zz_state(v_b);

    -- c) an end-user UPDATE cannot touch the verdict
    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    update public.company_badges set verification_status = 'unverified', verification_note = 'hacked', verified_at = null, source_title = 'X', logo_url = 'https://evil.example/p.png', source_found_by = 'founder' where id = v_b;
    execute 'reset role';
    perform pg_temp.zz_check('G3 an end-user UPDATE of the verdict columns changes nothing (silently, by design)', v_got, pg_temp.zz_state(v_b));

    insert into public.company_badges (org_id, name) values (v_org, 'zz-test-918 unverified one') returning id into v_b2;
    execute 'set local role authenticated';
    update public.company_badges set verification_status = 'verified', verified_at = now() where id = v_b2;
    execute 'reset role';
    perform pg_temp.zz_check('G4 a founder cannot promote his own badge to verified', 'unverified', (select verification_status from public.company_badges where id = v_b2));

    -- d) editing what does NOT belong to the verdict leaves it alone
    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    update public.company_badges set description = 'a new description', kind = 'programme' where id = v_b;
    execute 'reset role';
    perform pg_temp.zz_check('G5 editing the description or the kind of a verified badge keeps it verified', 'verified', (select verification_status from public.company_badges where id = v_b));

    -- e) editing the name, the year or the source sends it back to unverified
    execute 'set local role authenticated';
    update public.company_badges set name = 'zz-test-918 renamed' where id = v_b;
    execute 'reset role';
    perform pg_temp.zz_check('G6 renaming a verified badge sends it back to unverified (note says why; found title and logo cleared; the source and who found it stay)',
      'unverified | note=Edited — verify again to show it to investors | verified_at=false | src=https://altice.pt/premios/2023 | by=sherlock | title=∅ | logo=∅', pg_temp.zz_state(v_b));

    perform pg_temp.zz_service();
    update public.company_badges set verification_status = 'verified', verification_note = 'Confirmed again', verified_at = now(), source_title = 'Altice winners', logo_url = 'https://cdn.altice.pt/logo.png' where id = v_b;
    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    update public.company_badges set year = 2024 where id = v_b;
    execute 'reset role';
    perform pg_temp.zz_check('G7 changing the year does the same', 'unverified', (select verification_status from public.company_badges where id = v_b));

    perform pg_temp.zz_service();
    update public.company_badges set verification_status = 'verified', verification_note = 'Confirmed again', verified_at = now(), source_title = 'Altice winners' where id = v_b;
    perform pg_temp.zz_as(v_user);
    execute 'set local role authenticated';
    update public.company_badges set source_url = 'https://noticias.sapo.pt/n/1' where id = v_b;
    execute 'reset role';
    perform pg_temp.zz_check('G8 changing the source does the same, and now the founder is who found it',
      'unverified | note=Edited — verify again to show it to investors | verified_at=false | src=https://noticias.sapo.pt/n/1 | by=founder | title=∅ | logo=∅', pg_temp.zz_state(v_b));

    -- f) the database owner (migrations, the SQL editor, no JWT) is not constrained
    perform set_config('request.jwt.claims', '', true);
    update public.company_badges set verification_status = 'verified', verification_note = 'set by the owner', verified_at = now() where id = v_b;
    perform pg_temp.zz_check('G9 the database owner is not constrained by the guard', 'verified', (select verification_status from public.company_badges where id = v_b));

  end if;

  -- 5. what is left unchanged, and what an investor will see on day one
  perform pg_temp.zz_check('R1 the RLS policy on company_badges is exactly the one it was (members, all commands)', '1',
    (select count(*) from pg_policy where polrelid = 'public.company_badges'::regclass)::text);
  perform pg_temp.zz_info('R2 badges an investor would see right after this migration (verified + source + date), zz fixtures excluded',
    (select count(*) from public.company_badges b join public.orgs o on o.id = b.org_id
      where b.verification_status = 'verified' and b.source_url is not null and b.verified_at is not null and o.name not like 'zz-test-918%')::text);

  -- 6. THE ANSWER
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
