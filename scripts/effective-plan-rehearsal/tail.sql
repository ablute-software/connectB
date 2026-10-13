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

  -- 7b. THE WAY BACK. The rollback script (generated from the migration itself, embedded verbatim) run on top of the migration, in the same
  -- transaction: it must restore both wallet functions to production's old text byte for byte, keep their grants, and leave no effective_plan().
  -- A rollback that has never run is a hope, not a rollback.
  -- >>> ROLLBACK (verbatim) >>>
  -- <<< ROLLBACK <<<
  perform pg_temp.zz_check('R1 after the rollback script both wallet functions are byte-for-byte production''s old text again', 'true|true',
    (pg_get_functiondef('public.ai_wallet_status(uuid,text)'::regprocedure) = v_old_def_status)::text || '|' ||
    (pg_get_functiondef('public.charge_ai_action(uuid,text)'::regprocedure) = v_old_def_charge)::text);
  perform pg_temp.zz_check('R1 their grants are still the old ones', 'true|true',
    ((select p.proacl::text from pg_proc p where p.oid = 'public.ai_wallet_status(uuid,text)'::regprocedure) = v_old_acl_status)::text || '|' ||
    ((select p.proacl::text from pg_proc p where p.oid = 'public.charge_ai_action(uuid,text)'::regprocedure) = v_old_acl_charge)::text);
  perform pg_temp.zz_check('R1 effective_plan() is gone', '0',
    (select count(*) from pg_proc p where p.proname = 'effective_plan' and p.pronamespace = 'public'::regnamespace)::text);

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
