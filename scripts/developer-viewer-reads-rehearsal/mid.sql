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
