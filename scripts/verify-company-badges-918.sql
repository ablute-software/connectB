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
-- Prompt 918 — badges & awards: only the verified ones reach the investor, each with a public source and a logo; the verification is
-- charged. (Prompt 326 created the table in 0219_company_badges.sql; this adds to it.)
--
-- NOT YET APPLIED to production: waiting for Nuno's "sim". Rehearsed against production data inside ONE DO statement that always ends in
-- RAISE EXCEPTION (scripts/verify-company-badges-918.sql, which embeds THIS file verbatim, so the rehearsal can never drift from what is
-- applied).
--
-- WHAT IT DOES
--   1. Columns: source_url, source_title, source_found_by ('founder' | 'sherlock'), logo_url, kind (award | certification | programme |
--      recognition), updated_at. (verified_at already exists, from 0219.)
--   2. Backfill: a badge that is `verified` but has no source goes back to `unverified` with the note 'Re-verify to attach a public source'
--      — from now on "verified" means "there is a public page to point at". Today that is ONE row (listed in the report: Mob2is,
--      "Altice Innovation Awards", verified 14/10 on a note that says the company was a finalist). Nothing else in the table changes.
--   3. The table refuses what the rule forbids: a `verified` row without a source and a date cannot exist (CHECK), and the kind, the
--      source_found_by and the lengths are checked.
--   4. A guard trigger. company_badges' RLS policy lets any member of the org write ANY column through PostgREST with their own session
--      (Prompt 326 designed it for a form, not for a verdict), so a founder could mark a badge "verified" from the browser console and
--      the investor would see it. The trigger makes the verdict's own columns — status, note, date, found title, found logo, who found the
--      source — writable only by the service role (our routes) and by the database owner (migrations, the SQL editor): for an end-user
--      session they are forced back to what they were (an INSERT starts unverified), and an edit of the name, the year or the source of a
--      badge already ruled on sends it back to unverified. Silent by design: a client that sends the whole row unchanged keeps working.
--   5. updated_at is touched on every update.
--   6. ai_actions gets 'badge_verification' (5 credits) so charge_ai_action() can meter it and Backoffice > AI credits & plans shows and edits it
--      like every other action. ON CONFLICT DO NOTHING: a row someone already edited is never overwritten.
--
-- Additive except for the backfill (one row) and the three CHECKs, which the backfill is ordered to satisfy.

-- 1. columns
alter table public.company_badges
  add column if not exists source_url text,
  add column if not exists source_title text,
  add column if not exists source_found_by text,
  add column if not exists logo_url text,
  add column if not exists kind text not null default 'award',
  add column if not exists updated_at timestamptz not null default now();

-- 2. backfill — BEFORE the CHECK that would refuse these rows
update public.company_badges
   set verification_status = 'unverified', verified_at = null, verification_note = 'Re-verify to attach a public source'
 where verification_status = 'verified' and (source_url is null or btrim(source_url) = '');

-- 3. what the table itself refuses
alter table public.company_badges drop constraint if exists company_badges_kind_check;
alter table public.company_badges add constraint company_badges_kind_check
  check (kind in ('award', 'certification', 'programme', 'recognition'));
alter table public.company_badges drop constraint if exists company_badges_source_found_by_check;
alter table public.company_badges add constraint company_badges_source_found_by_check
  check (source_found_by is null or source_found_by in ('founder', 'sherlock'));
alter table public.company_badges drop constraint if exists company_badges_source_lengths_check;
alter table public.company_badges add constraint company_badges_source_lengths_check
  check ((source_url is null or char_length(source_url) <= 2000)
     and (logo_url is null or char_length(logo_url) <= 2000)
     and (source_title is null or char_length(source_title) <= 300));
alter table public.company_badges drop constraint if exists company_badges_verified_has_source_check;
alter table public.company_badges add constraint company_badges_verified_has_source_check
  check (verification_status <> 'verified' or (source_url is not null and btrim(source_url) <> '' and verified_at is not null));

-- 4. the guard: the verdict is written only by the service role and the database owner
-- SECURITY INVOKER on purpose (the default): the function reads only the row and auth.role(), so it needs no owner privileges — and a
-- SECURITY DEFINER function in `public` shows up in the Supabase advisor as executable by anon/authenticated (0028/0029), one more warning
-- for something that has nothing to protect. (Triggers fire without an EXECUTE check on the firing role; the rehearsal proves it as `authenticated`.)
create or replace function public.company_badges_protect_verification()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Only an end-user session (the founder's own browser talking to PostgREST) is constrained. Our routes run as the service role;
  -- migrations and the SQL editor run as the database owner, with no JWT at all.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'unverified';
    new.verification_note := null;
    new.verified_at := null;
    new.source_title := null;
    new.logo_url := null;
    new.source_found_by := case when new.source_url is null then null else 'founder' end;
    return new;
  end if;

  if new.name is distinct from old.name or new.year is distinct from old.year or new.source_url is distinct from old.source_url then
    -- what was verified was THIS name, THIS year, THIS source: change one and the old verdict no longer describes the page
    if old.verification_status <> 'unverified' then
      new.verification_status := 'unverified';
      new.verification_note := 'Edited — verify again to show it to investors';
      new.verified_at := null;
    else
      new.verification_status := old.verification_status;
      new.verification_note := old.verification_note;
      new.verified_at := old.verified_at;
    end if;
    new.source_title := null;
    new.logo_url := null;
    -- who found the source changes only when the source itself did
    new.source_found_by := case
      when new.source_url is not distinct from old.source_url then old.source_found_by
      when new.source_url is null then null
      else 'founder'
    end;
  else
    new.verification_status := old.verification_status;
    new.verification_note := old.verification_note;
    new.verified_at := old.verified_at;
    new.source_found_by := old.source_found_by;
    new.source_title := old.source_title;
    new.logo_url := old.logo_url;
  end if;
  return new;
end;
$$;

drop trigger if exists company_badges_protect_verification on public.company_badges;
create trigger company_badges_protect_verification
  before insert or update on public.company_badges
  for each row execute function public.company_badges_protect_verification();

-- 5. updated_at (fires after the guard: triggers run in name order)
drop trigger if exists company_badges_touch on public.company_badges;
create trigger company_badges_touch
  before update on public.company_badges
  for each row execute function public.touch_updated_at();

-- 6. the action the wallet meters
insert into public.ai_actions (key, label, category, credit_cost, needs_confirmation, enabled)
values ('badge_verification', 'Badge verification — public-source check', 'client', 5, false, true)
on conflict (key) do nothing;
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
