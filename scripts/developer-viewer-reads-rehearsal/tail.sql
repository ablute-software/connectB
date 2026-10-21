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
