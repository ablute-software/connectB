
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
