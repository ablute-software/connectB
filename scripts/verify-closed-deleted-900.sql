-- Prompt 900 — ensaio da migração 20261013160000_closed_deleted_accounts.sql contra os DADOS REAIS de produção,
-- numa transacção que nunca fecha com commit.
--
-- COMO FUNCIONA (e porque não pode deixar rasto): isto é UM único statement (um bloco DO). Dentro dele corre, por esta ordem:
--   1. cópias fiéis das duas funções de porta COMO ESTÃO HOJE em produção (tiradas de pg_get_functiondef em runtime —
--      nunca copiadas à mão), para comparar velho contra novo;
--   2. a migração, textualmente (a secção entre as linhas "-- >>> MIGRATION" e "-- <<< MIGRATION" é uma cópia exacta do ficheiro
--      supabase/migrations/20261013160000_closed_deleted_accounts.sql; src/lib/closed-accounts-rehearsal.test.ts falha se divergirem);
--   3. a comparação velho/novo para TODOS os utilizadores de produção;
--   4. o caso real (alexandrameira.ablute@gmail.com / Caramel Biscuit), os quatro casos de C e as recusas de B;
--   5. um RAISE EXCEPTION final, que desfaz TUDO (migração incluída) e leva o resultado na mensagem de erro.
-- Um só statement + excepção final = atómico e revertido por construção, qualquer que seja o cliente que o corra.
--
-- Para correr: colar o ficheiro inteiro numa chamada execute_sql (Supabase MCP) ou em psql. A resposta é um ERRO que começa por
-- "REHEARSAL_RESULT": cada linha é PASS/FAIL/INFO com o esperado e o obtido. Nada fica gravado.
do $rehearsal$
declare
  v_alex   constant uuid := 'd3375dde-a76f-4930-92de-af0f6651a850';
  v_org uuid; v_orgname text; v_admin uuid; v_nonadmin uuid; v_inc uuid;
  v_got text; v_json jsonb; v_n int; v_n2 int; v_email text;
  v_d uuid; v_dname text; v_act uuid; v_u2 uuid;
  v_su uuid; v_so uuid; v_sf uuid;
  r record;
  v_total int := 0; v_diffs jsonb := '[]'::jsonb; v_dist text;
  v_old text; v_new text; v_old2 boolean; v_new2 boolean; v_hat boolean; v_unexplained int := 0;
  v_susp uuid; v_plain uuid; v_auth_alex text; v_auth_susp text; v_auth_plain text; v_auth_ctl text;
  v_out text; v_pass int; v_fail int;
begin
  create temp table zz_res (seq serial primary key, name text, expected text, got text, mode text);
  create temp table zz_dist (state text);

  create function pg_temp.zz_as(p_uid uuid) returns void language plpgsql as $f$
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
  end $f$;

  create function pg_temp.zz_check(p_name text, p_expected text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, p_expected, p_got, 'exact'); end $f$;

  create function pg_temp.zz_check_like(p_name text, p_prefix text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, p_prefix, p_got, 'prefix'); end $f$;

  create function pg_temp.zz_info(p_name text, p_got text) returns void language plpgsql as $f$
  begin insert into zz_res(name, expected, got, mode) values (p_name, null, p_got, 'info'); end $f$;

  -- 1. the two door functions exactly as production has them today, under other names
  declare v_def text;
  begin
    select pg_get_functiondef('public.is_account_suspended()'::regprocedure) into v_def;
    execute replace(v_def, 'public.is_account_suspended()', 'public.zz_old_is_account_suspended()');
    select pg_get_functiondef('public.account_access_state()'::regprocedure) into v_def;
    v_def := replace(v_def, 'public.account_access_state()', 'public.zz_old_account_access_state()');
    v_def := replace(v_def, 'public.is_account_suspended()', 'public.zz_old_is_account_suspended()');
    execute v_def;
  end;

  create function pg_temp.zz_door(p_uid uuid) returns text language plpgsql as $f$
  declare o text; n text;
  begin
    perform pg_temp.zz_as(p_uid);
    o := public.zz_old_account_access_state();
    n := public.account_access_state();
    return o || ' -> ' || n;
  end $f$;

  -- >>> MIGRATION (verbatim) >>>
-- Prompt 900 — closed and deleted accounts: a live hat is never trapped by a dead org, and two admin actions to get a person out of one.
--
-- NOT YET APPLIED to production: waiting for Nuno's "sim". Rehearsed against production data inside one DO block that always
-- ends in RAISE EXCEPTION (scripts/verify-closed-deleted-900.sql, which embeds THIS file, so the rehearsal can never drift
-- from what is applied): the real case (alexandrameira.ablute@gmail.com / Caramel Biscuit), the four cases of the rule, and
-- an old-versus-new comparison of the door for EVERY user in production.
--
-- WHY. 30/09/2026: the owner of an ecosystem organisation was invited by e-mail and could not get in. The only org that e-mail
-- is a member of ("Caramel Biscuit") had been DELETED by moderation (orgs.moderation_status = 'deleted'). The block does not
-- come from decideRole: it comes from the door the middleware asks on every page, account_access_state(), which asks
-- is_account_suspended(), which treated a membership in ANY deleted org as a suspension of the whole person — without looking at
-- what else that person is a member of. A deleted startup is a sanction on the PROJECT, not on the person.
--
-- THE RULE (C of the prompt).
--   account_has_live_hat()   a hat that is alive: an active membership of an ecosystem organisation that is not closed
--                            (has_active_incubator_membership(), the one SQL definition from I-01 — reused, not copied), or an
--                            active seat in an investor firm that is neither deleted nor under an active suspension.
--   is_account_suspended()   a SANCTION (an org or a firm that is suspended, inside its window) blocks the whole person, whatever
--                            else they hold — exactly as before. A DELETED org or firm blocks only a person who has NO live hat left.
--   account_access_state()   'closed' (an account its OWNER closed) likewise stops trapping a person who holds a live hat.
--                            'blocked' (blocked_emails) is untouched and still comes first: that list is a security decision.
--   Nothing changes for anybody who has no live hat: for them the new functions answer exactly what the old ones did (the
--   rehearsal proves it for every user in production).
--   Not counted as a live hat: an invitation that has not been accepted, and a second startup org (the app supports one org per
--   user — resolveRoleSignals reads it with maybeSingle()).
--
-- THE TWO ACTIONS (B of the prompt), each atomic with its audit rows, SECURITY DEFINER, executable by service_role only (the
-- back-office routes call them after requirePlatformAdmin(); the actor must ALSO be a platform admin in the database):
--   moderation_reopen_org(org, reason, actor)           deleted -> active, quarantine and suspension clocks cleared; a row in
--                                                       account_moderation_actions (action 'reopen') and one in admin_audit_log.
--                                                       Refused: not deleted · also closed · retention window ended · a member in a
--                                                       GDPR erasure · a member's e-mail on blocked_emails.
--   moderation_release_org_member(org, user, reason, actor)  deletes the person's org_members row in a closed or deleted org so the
--                                                       e-mail can be used in another capacity; auth.users and blocked_emails are
--                                                       never touched. Same refusals except "not deleted" (a closed org qualifies), plus
--                                                       one: an account its OWNER closed while the owner's reopen window (purge_after,
--                                                       Prompt 602) is still open — reopening it with nobody inside would be worse.
--                                                       NOTE the existing trigger trg_orgs_close_when_last_member_removed: removing
--                                                       the LAST member of an org calls close_org() — closed_at, the platform
--                                                       suspension, the MatchDeal profile suspension and the revoked access grants.
--                                                       That is the product's own rule and it is kept; the result says when it fired,
--                                                       and closed_reason = 'last_member_deleted' / closed_by = the actor are recorded
--                                                       (close_org() leaves the reason empty, and nothing else ever writes that value).
--
-- "In a GDPR erasure" has no org-level record in this schema (gdpr_requests is per person and today empty; erase_gdpr_person erases
-- the contacts a founder holds, never an org). It is read as: a request of kind 'erase', pending or resolved as erased, that names one
-- of the org's members (by user id or by e-mail).
--
-- ADDITIVE except for the two replaced functions (CREATE OR REPLACE keeps their grants: anon and authenticated must keep executing
-- them — the middleware calls account_access_state() for every signed-in request) and one widened CHECK (a new value, 'reopen').

-- 1. moderation history can say "reopen"
alter table public.account_moderation_actions
  drop constraint if exists account_moderation_actions_action_check;
alter table public.account_moderation_actions
  add constraint account_moderation_actions_action_check
  check (action in ('suspend', 'undo', 'delete', 'reopen'));

-- 2. the signal
create or replace function public.account_has_live_hat()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_active_incubator_membership()
      or exists (
        select 1
          from public.matchdeal_investor_members mim
          join public.catalog_entities ce on ce.id = mim.catalog_entity_id
         where mim.user_id = auth.uid()
           and mim.status = 'active'
           and ce.moderation_status <> 'deleted'
           and not (ce.moderation_status = 'suspended'
                    and (ce.moderation_suspended_until is null or ce.moderation_suspended_until > now()))
      );
$$;

-- 3. the door
create or replace function public.is_account_suspended()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    -- A sanction blocks the whole person, whatever else they hold (unchanged).
    exists (
      select 1 from public.org_members om
        join public.orgs o on o.id = om.org_id
       where om.user_id = auth.uid()
         and o.moderation_status = 'suspended'
         and (o.moderation_suspended_until is null or o.moderation_suspended_until > now())
    )
    or exists (
      select 1 from public.matchdeal_investor_members mim
        join public.catalog_entities ce on ce.id = mim.catalog_entity_id
       where mim.user_id = auth.uid() and mim.status = 'active'
         and ce.moderation_status = 'suspended'
         and (ce.moderation_suspended_until is null or ce.moderation_suspended_until > now())
    )
    -- A DELETED project blocks only a person who has no live hat left (Prompt 900).
    or (
      (
        exists (
          select 1 from public.org_members om
            join public.orgs o on o.id = om.org_id
           where om.user_id = auth.uid() and o.moderation_status = 'deleted'
        )
        or exists (
          select 1 from public.matchdeal_investor_members mim
            join public.catalog_entities ce on ce.id = mim.catalog_entity_id
           where mim.user_id = auth.uid() and mim.status = 'active' and ce.moderation_status = 'deleted'
        )
      )
      and not public.account_has_live_hat()
    );
$$;

create or replace function public.account_access_state()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when exists (
      select 1 from public.blocked_emails be
        join auth.users u on lower(u.email) = be.email
       where u.id = auth.uid()
    ) then 'blocked'
    -- An account its owner closed traps a person only while they have nowhere else to go (Prompt 900).
    when exists (
      select 1 from public.org_members m
        join public.orgs o on o.id = m.org_id
       where m.user_id = auth.uid() and o.closed_at is not null and o.closed_reason = 'owner'
    ) and not public.account_has_live_hat() then 'closed'
    when public.is_account_suspended() then 'suspended'
    else 'active'
  end;
$$;

-- 4. what an action may not touch
create or replace function public.org_in_gdpr_erasure(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
      from public.org_members m
      join auth.users u on u.id = m.user_id
      join public.gdpr_requests g
        on g.kind = 'erase'
       and (g.status = 'pending' or (g.status = 'resolved' and g.resolution_method = 'erased'))
       and (g.claimant_user_id = m.user_id or lower(btrim(g.claimant_email)) = lower(btrim(u.email)))
     where m.org_id = p_org_id
  );
$$;

create or replace function public.org_has_blocked_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
      from public.org_members m
      join auth.users u on u.id = m.user_id
      join public.blocked_emails b on b.email = lower(btrim(u.email))
     where m.org_id = p_org_id
  );
$$;

-- 5. Reopen account
create or replace function public.moderation_reopen_org(p_org_id uuid, p_reason text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_org public.orgs%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_actor is null or not exists (select 1 from public.platform_admins pa where pa.user_id = p_actor) then
    raise exception 'platform admin only' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'a reason is required to reopen an account';
  end if;

  select * into v_org from public.orgs where id = p_org_id for update;
  if not found then
    raise exception 'no org with that id';
  end if;
  if v_org.moderation_status <> 'deleted' then
    raise exception 'only a deleted account can be reopened (its status is %)', v_org.moderation_status;
  end if;
  if v_org.closed_at is not null then
    raise exception 'this account is also closed (since %): reopening its moderation status alone would not bring it back', v_org.closed_at::date;
  end if;
  if v_org.purge_after is not null and v_org.purge_after <= now() then
    raise exception 'the retention window ended on %', v_org.purge_after::date;
  end if;
  if public.org_in_gdpr_erasure(p_org_id) then
    raise exception 'a member of this account is in a GDPR erasure (pending or done): it cannot be reopened';
  end if;
  if public.org_has_blocked_member(p_org_id) then
    raise exception 'a member''s e-mail is on the blocked list: that was decided for security and is managed on its own screen';
  end if;

  update public.orgs
     set moderation_status = 'active', moderation_quarantine_until = null, moderation_suspended_until = null
   where id = p_org_id;

  insert into public.account_moderation_actions (target_type, target_id, action, justification, actor, quarantine_until, bypassed_quarantine)
  values ('org', p_org_id, 'reopen', v_reason, p_actor, null, false);

  insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (p_actor, 'org_moderation_reopened', 'org', p_org_id,
          jsonb_build_object('orgName', v_org.name, 'reason', v_reason, 'previousStatus', 'deleted',
                             'previousQuarantineUntil', v_org.moderation_quarantine_until));

  return jsonb_build_object('orgId', p_org_id, 'orgName', v_org.name, 'status', 'active');
end;
$$;

-- 6. Release email
create or replace function public.moderation_release_org_member(p_org_id uuid, p_user_id uuid, p_reason text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_org public.orgs%rowtype;
  v_member public.org_members%rowtype;
  v_email text;
  v_closed_after timestamptz;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_actor is null or not exists (select 1 from public.platform_admins pa where pa.user_id = p_actor) then
    raise exception 'platform admin only' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'a reason is required to release an e-mail';
  end if;

  select * into v_org from public.orgs where id = p_org_id for update;
  if not found then
    raise exception 'no org with that id';
  end if;
  if v_org.moderation_status <> 'deleted' and v_org.closed_at is null then
    raise exception 'only a closed or deleted account can release a member';
  end if;
  -- The owner's own undo window (Prompt 602): while it is open the account can still be reopened, and a reopened account with
  -- nobody in it would be worse than the closure. After purge_after, or for any other kind of closure, there is nothing to undo.
  if v_org.closed_reason = 'owner' and v_org.purge_after is not null and v_org.purge_after > now() then
    raise exception 'this account was closed by its owner and can still be reopened until %: releasing a member now would leave nothing to reopen', v_org.purge_after::date;
  end if;

  select * into v_member from public.org_members where org_id = p_org_id and user_id = p_user_id;
  if not found then
    raise exception 'that person is not a member of this account';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user_id;

  if public.org_in_gdpr_erasure(p_org_id) then
    raise exception 'a member of this account is in a GDPR erasure (pending or done): nothing is released from it';
  end if;
  if exists (select 1 from public.blocked_emails b where b.email = lower(btrim(coalesce(v_email, '')))) then
    raise exception 'this e-mail is on the blocked list: that was decided for security and is managed on its own screen';
  end if;

  -- Fires trg_orgs_close_when_last_member_removed: if this was the last member, close_org() runs (the product's own rule).
  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
  select o.closed_at into v_closed_after from public.orgs o where o.id = p_org_id;
  -- close_org() stamps closed_at but not WHY; the CHECK on closed_reason has a value for exactly this ('last_member_deleted'),
  -- and nothing else ever writes it. Say it, and by whom, so the Closed & deleted tab can tell how the account ended.
  if v_org.closed_at is null and v_closed_after is not null then
    update public.orgs
       set closed_reason = coalesce(closed_reason, 'last_member_deleted'), closed_by = coalesce(closed_by, p_actor)
     where id = p_org_id;
  end if;

  insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (p_actor, 'org_member_released', 'org', p_org_id,
          jsonb_build_object('orgName', v_org.name, 'userId', p_user_id, 'email', v_email, 'role', v_member.role::text,
                             'reason', v_reason, 'orgModerationStatus', v_org.moderation_status::text,
                             'orgClosedBefore', v_org.closed_at, 'orgClosedAfter', v_closed_after,
                             'closedByThisRelease', v_org.closed_at is null and v_closed_after is not null));

  return jsonb_build_object('orgId', p_org_id, 'userId', p_user_id, 'email', v_email,
                            'orgNowClosed', v_closed_after is not null,
                            'closedByThisRelease', v_org.closed_at is null and v_closed_after is not null);
end;
$$;

-- 7. who may call what: the helpers and the two actions are reachable by the back-office routes (service role) and by nobody else
revoke execute on function public.account_has_live_hat() from public, anon, authenticated;
revoke execute on function public.org_in_gdpr_erasure(uuid) from public, anon, authenticated;
revoke execute on function public.org_has_blocked_member(uuid) from public, anon, authenticated;
revoke execute on function public.moderation_reopen_org(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.moderation_release_org_member(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.account_has_live_hat() to service_role;
grant execute on function public.org_in_gdpr_erasure(uuid) to service_role;
grant execute on function public.org_has_blocked_member(uuid) to service_role;
grant execute on function public.moderation_reopen_org(uuid, text, uuid) to service_role;
grant execute on function public.moderation_release_org_member(uuid, uuid, text, uuid) to service_role;

  -- <<< MIGRATION <<<

  -- 2. THE DIFFERENTIAL: every user in production, old door against new door. Taken BEFORE any scenario touches data.
  for r in select u.id, u.email from auth.users u order by u.created_at loop
    perform pg_temp.zz_as(r.id);
    v_old := public.zz_old_account_access_state();   v_new := public.account_access_state();
    v_old2 := public.zz_old_is_account_suspended();  v_new2 := public.is_account_suspended();
    v_total := v_total + 1;
    insert into zz_dist(state) values (v_new);
    if v_new = 'suspended' and v_old = 'suspended' and v_susp is null then v_susp := r.id; end if;
    if v_new = 'active' and v_old = 'active' and v_plain is null then v_plain := r.id; end if;
    if v_old is distinct from v_new or v_old2 is distinct from v_new2 then
      v_hat := public.account_has_live_hat();
      v_diffs := v_diffs || jsonb_build_object('user', r.email, 'access_state', v_old || ' -> ' || v_new, 'is_account_suspended', v_old2::text || ' -> ' || v_new2::text,
        'holds_a_live_hat', v_hat,
        'orgs', (select coalesce(jsonb_agg(o.name || ' [' || o.moderation_status::text || ']'), '[]'::jsonb) from public.org_members m join public.orgs o on o.id = m.org_id where m.user_id = r.id),
        'seats', (select coalesce(jsonb_agg(ce.name), '[]'::jsonb) from public.matchdeal_investor_members mim join public.catalog_entities ce on ce.id = mim.catalog_entity_id where mim.user_id = r.id and mim.status = 'active'));
      if not (v_hat and v_new = 'active' and v_old in ('suspended', 'closed')) then v_unexplained := v_unexplained + 1; end if;
    end if;
  end loop;
  select string_agg(q.state || '=' || q.n, ', ' order by q.state) into v_dist from (select state, count(*) n from zz_dist group by state) q;
  perform pg_temp.zz_info('D0 users in production / their door answer with the NEW functions', v_total || ' users: ' || coalesce(v_dist, '-'));
  perform pg_temp.zz_info('D1 users whose door answer changes with the migration, TODAY (' || jsonb_array_length(v_diffs) || ')', v_diffs::text);
  perform pg_temp.zz_check('D1 every one of them changes only from blocked to let-in, and only because they hold a live hat (nobody else moves)', '0', v_unexplained::text);

  -- 2b. THE PATH THE MIDDLEWARE REALLY TAKES: the user's own session, i.e. role 'authenticated'. The new helper is revoked from that
  -- role on purpose and is reached only through the two SECURITY DEFINER functions; if that did not work, every signed-in page
  -- request would raise, and the middleware fails OPEN on an error - the door would silently stop blocking anybody. Proved here, with
  -- a control that shows the role switch is real (the helper itself is refused to 'authenticated').
  perform pg_temp.zz_as('d3375dde-a76f-4930-92de-af0f6651a850'::uuid);
  execute 'set local role authenticated';
  v_auth_alex := public.account_access_state();
  execute 'reset role';
  perform pg_temp.zz_as(v_susp);
  execute 'set local role authenticated';
  v_auth_susp := public.account_access_state() || '/' || public.is_account_suspended()::text;
  execute 'reset role';
  perform pg_temp.zz_as(v_plain);
  execute 'set local role authenticated';
  v_auth_plain := public.account_access_state() || '/' || public.is_account_suspended()::text;
  begin perform public.account_has_live_hat(); v_auth_ctl := 'NO ERROR'; exception when insufficient_privilege then v_auth_ctl := sqlstate; end;
  execute 'reset role';
  perform pg_temp.zz_check('D2 AS ROLE authenticated (the middleware path): the case that changes', 'active', v_auth_alex);
  perform pg_temp.zz_check('D2 AS ROLE authenticated: a user who is blocked today is still blocked (state/is_account_suspended)', 'suspended/true', v_auth_susp);
  perform pg_temp.zz_check('D2 AS ROLE authenticated: an ordinary user is still let in', 'active/false', v_auth_plain);
  perform pg_temp.zz_check('D2 control: as authenticated the helper itself is refused (so the three lines above really ran as that role)', '42501', v_auth_ctl);

  -- 3. THE REAL CASE: alexandrameira.ablute@gmail.com / Caramel Biscuit
  select m.org_id, o.name into v_org, v_orgname from public.org_members m join public.orgs o on o.id = m.org_id where m.user_id = v_alex;
  if v_org is null then raise exception 'rehearsal precondition failed: the user is no longer a member of any org'; end if;
  select pa.user_id into v_admin from public.platform_admins pa order by pa.user_id limit 1;
  select u.id into v_nonadmin from auth.users u where not exists (select 1 from public.platform_admins pa where pa.user_id = u.id) order by u.created_at limit 1;
  select i.id into v_inc from public.incubators i
   where i.closed_at is null and not exists (select 1 from public.incubator_members x where x.incubator_id = i.id and x.user_id = v_alex)
   order by i.created_at limit 1;
  select u.email into v_email from auth.users u where u.id = v_alex;
  perform pg_temp.zz_info('R0 the case', v_email || ' · org "' || v_orgname || '" · members of that org: ' ||
    (select count(*) from public.org_members where org_id = v_org) || ' · e-mail confirmed: ' ||
    (select (u.email_confirmed_at is not null)::text from auth.users u where u.id = v_alex) || ' · on blocked_emails: ' ||
    (select (count(*) > 0)::text from public.blocked_emails b where b.email = lower(btrim(v_email))));
  perform pg_temp.zz_check('R0 the org: moderation_status | closed_at', 'deleted|', (select o.moderation_status::text || '|' || coalesce(o.closed_at::text, '') from public.orgs o where o.id = v_org));
  perform pg_temp.zz_info('R1 her other hats in production today', 'investor seats: ' || coalesce((select string_agg(ce.name || ' (' || mim.status || ')', ', ') from public.matchdeal_investor_members mim join public.catalog_entities ce on ce.id = mim.catalog_entity_id where mim.user_id = v_alex), 'none') ||
    ' · ecosystem memberships: ' || coalesce((select string_agg(i.name || ' (' || im.status || ')', ', ') from public.incubator_members im join public.incubators i on i.id = im.incubator_id where im.user_id = v_alex), 'none'));
  perform pg_temp.zz_check('R1 AS IT IS TODAY: deleted org + the investor seat she already holds: door old -> new', 'suspended -> active', pg_temp.zz_door(v_alex));
  -- from here on, study the other hats ONE AT A TIME: set her seat aside inside this transaction
  update public.matchdeal_investor_members set status = 'revoked' where user_id = v_alex;
  perform pg_temp.zz_check('R1b deleted org and no other hat: door old -> new  [C: deleted only -> blocked as today]', 'suspended -> suspended', pg_temp.zz_door(v_alex));

  -- the owner invite is accepted: she becomes an ACTIVE OWNER of an ecosystem organisation
  insert into public.incubator_members (incubator_id, user_id, role, status, accepted_at) values (v_inc, v_alex, 'owner', 'active', now());
  perform pg_temp.zz_as(v_alex);
  perform pg_temp.zz_check('R2 has_active_incubator_membership() as her', 'true', public.has_active_incubator_membership()::text);
  perform pg_temp.zz_check('R2 account_has_live_hat() as her', 'true', public.account_has_live_hat()::text);
  perform pg_temp.zz_check('R2 deleted org + active ecosystem membership: door old -> new  [C: deleted+incubator -> in]', 'suspended -> active', pg_temp.zz_door(v_alex));

  -- a SUSPENSION is a sanction on the person: it still blocks, whatever else she holds
  update public.orgs set moderation_status = 'suspended', moderation_suspended_until = null where id = v_org;
  perform pg_temp.zz_check('R3 suspended (no end date) + ecosystem: door old -> new  [C: suspended+incubator -> blocked]', 'suspended -> suspended', pg_temp.zz_door(v_alex));
  update public.orgs set moderation_suspended_until = now() + interval '7 days' where id = v_org;
  perform pg_temp.zz_check('R3 suspended (until next week) + ecosystem', 'suspended -> suspended', pg_temp.zz_door(v_alex));
  update public.orgs set moderation_suspended_until = now() - interval '1 day' where id = v_org;
  perform pg_temp.zz_check('R3 a suspension that already ended + ecosystem (unchanged by the migration)', 'active -> active', pg_temp.zz_door(v_alex));
  update public.orgs set moderation_status = 'deleted', moderation_suspended_until = null where id = v_org;

  -- what is NOT a live hat
  update public.incubator_members set status = 'invited', accepted_at = null where incubator_id = v_inc and user_id = v_alex;
  perform pg_temp.zz_check('R4 invitation not accepted yet is not a hat', 'suspended -> suspended', pg_temp.zz_door(v_alex));
  update public.incubator_members set status = 'active', accepted_at = now() where incubator_id = v_inc and user_id = v_alex;
  update public.incubators set closed_at = now() where id = v_inc;
  perform pg_temp.zz_check('R4 a CLOSED ecosystem organisation is not a hat', 'suspended -> suspended', pg_temp.zz_door(v_alex));
  update public.incubators set closed_at = null where id = v_inc;
  perform pg_temp.zz_check('R4 (control) the ecosystem organisation open again', 'suspended -> active', pg_temp.zz_door(v_alex));

  -- an e-mail on blocked_emails is blocked, whatever else she holds (a security decision; this migration does not touch it)
  insert into public.blocked_emails(email, reason, blocked_by) values (lower(btrim(v_email)), 'rehearsal', v_admin);
  perform pg_temp.zz_check('R5 on blocked_emails + live hat', 'blocked -> blocked', pg_temp.zz_door(v_alex));
  delete from public.blocked_emails where reason = 'rehearsal' and email = lower(btrim(v_email));

  -- an account its OWNER closed: the third state, 'closed'
  update public.orgs set closed_at = now(), closed_reason = 'owner', purge_after = now() + interval '30 days' where id = v_org;
  perform pg_temp.zz_check('R6 closed by its owner + ecosystem hat: door old -> new (a live hat is not trapped by it)', 'closed -> active', pg_temp.zz_door(v_alex));
  delete from public.incubator_members where incubator_id = v_inc and user_id = v_alex;
  perform pg_temp.zz_check('R6 closed by its owner, no other hat: unchanged', 'closed -> closed', pg_temp.zz_door(v_alex));
  update public.orgs set closed_at = null, closed_reason = null, purge_after = null where id = v_org;

  -- RELEASE EMAIL, as the back-office would do it
  select count(*) into v_n from public.blocked_emails;
  select count(*) into v_n2 from auth.users where id = v_alex;
  begin perform public.moderation_release_org_member(v_org, v_alex, 'rehearsal', v_nonadmin); v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('L0 a caller that is not a platform admin is refused', '42501', v_got);
  begin perform public.moderation_release_org_member(v_org, v_alex, '   ', v_admin); v_got := 'NO ERROR';
  exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check('L0 a blank reason is refused', 'a reason is required to release an e-mail', v_got);

  v_json := public.moderation_release_org_member(v_org, v_alex, 'Rehearsal: the owner invite of an ecosystem organisation needs this e-mail free', v_admin);
  perform pg_temp.zz_info('L1 function result', v_json::text);
  perform pg_temp.zz_check('L1 the membership row is gone', '0', (select count(*)::text from public.org_members where org_id = v_org and user_id = v_alex));
  perform pg_temp.zz_check('L1 the auth.users row is untouched', v_n2::text, (select count(*)::text from auth.users where id = v_alex));
  perform pg_temp.zz_check('L1 blocked_emails is untouched', v_n::text, (select count(*)::text from public.blocked_emails));
  perform pg_temp.zz_check('L1 she was the only member, so the existing trigger closed the org: closedByThisRelease | orgNowClosed', 'true|true', (v_json->>'closedByThisRelease') || '|' || (v_json->>'orgNowClosed'));
  perform pg_temp.zz_check('L1 the org: moderation_status | closed_at set | closed_reason | closed_by is the actor', 'deleted|true|last_member_deleted|true',
    (select o.moderation_status::text || '|' || (o.closed_at is not null)::text || '|' || coalesce(o.closed_reason, '') || '|' || (o.closed_by = v_admin)::text from public.orgs o where o.id = v_org));
  perform pg_temp.zz_check('L1 one audit row, with the e-mail, the role and the reason', '1|owner|true',
    (select count(*)::text || '|' || coalesce(max(a.detail->>'role'), '') || '|' || (max(a.detail->>'reason') like 'Rehearsal:%')::text from public.admin_audit_log a where a.action = 'org_member_released' and a.subject_id = v_org));
  perform pg_temp.zz_check('L1 door for her now, no other hat', 'active -> active', pg_temp.zz_door(v_alex));
  begin perform public.moderation_release_org_member(v_org, v_alex, 'again', v_admin); v_got := 'NO ERROR';
  exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('L1 releasing the same person twice is refused', 'that person is not a member of this account', v_got);
  insert into public.incubator_members (incubator_id, user_id, role, status, accepted_at) values (v_inc, v_alex, 'owner', 'active', now());
  perform pg_temp.zz_check('L1 (and with the ecosystem membership she has accepted since) the door', 'active -> active', pg_temp.zz_door(v_alex));
  delete from public.incubator_members where incubator_id = v_inc and user_id = v_alex;

  -- 4. REOPEN ACCOUNT
  select o.id, o.name into v_d, v_dname from public.orgs o
   where o.moderation_status = 'deleted' and o.closed_at is null and o.id <> v_org and (o.purge_after is null or o.purge_after > now())
     and exists (select 1 from public.org_members m where m.org_id = o.id)
     and not public.org_in_gdpr_erasure(o.id) and not public.org_has_blocked_member(o.id)
   order by o.created_at limit 1;
  if v_d is null then
    select o.id, o.name into v_d, v_dname from public.orgs o
     where o.moderation_status = 'active' and o.closed_at is null and o.id <> v_org and exists (select 1 from public.org_members m where m.org_id = o.id)
     order by o.created_at limit 1;
    update public.orgs set moderation_status = 'deleted' where id = v_d;
    perform pg_temp.zz_info('O0 note', 'no deleted org with members was left to use as it is: an active one was deleted inside this transaction');
  end if;
  perform pg_temp.zz_info('O0 org used for Reopen', v_dname || ' · members ' || (select count(*) from public.org_members where org_id = v_d));
  update public.orgs set moderation_quarantine_until = now() + interval '5 days', moderation_suspended_until = now() + interval '5 days' where id = v_d;
  select m.user_id into v_u2 from public.org_members m where m.org_id = v_d order by m.user_id limit 1;

  begin perform public.moderation_reopen_org(v_d, 'rehearsal', v_nonadmin); v_got := 'NO ERROR';
  exception when others then v_got := sqlstate; end;
  perform pg_temp.zz_check('O0 a caller that is not a platform admin is refused', '42501', v_got);
  begin perform public.moderation_reopen_org(v_d, '', v_admin); v_got := 'NO ERROR';
  exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check('O0 a blank reason is refused', 'a reason is required to reopen an account', v_got);

  -- the refusals, each against a deleted org that would otherwise qualify
  update public.orgs set closed_at = now() where id = v_d;
  begin perform public.moderation_reopen_org(v_d, 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('O2 also closed: refused', 'this account is also closed', v_got);
  update public.orgs set closed_at = null where id = v_d;

  update public.orgs set purge_after = now() - interval '1 day' where id = v_d;
  begin perform public.moderation_reopen_org(v_d, 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('O3 retention window ended: refused', 'the retention window ended', v_got);
  update public.orgs set purge_after = null where id = v_d;

  insert into public.gdpr_requests(claimant_email, claimant_user_id, kind, status, due_at) select u.email, u.id, 'erase', 'pending', now() + interval '30 days' from auth.users u where u.id = v_u2;
  begin perform public.moderation_reopen_org(v_d, 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('O4 a member is in a GDPR erasure (pending): refused', 'a member of this account is in a GDPR erasure', v_got);
  update public.gdpr_requests set status = 'resolved', resolution_method = 'erased', resolved_at = now() where claimant_user_id = v_u2;
  begin perform public.moderation_reopen_org(v_d, 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('O4 a member is in a GDPR erasure (done): refused', 'a member of this account is in a GDPR erasure', v_got);
  update public.gdpr_requests set status = 'resolved', resolution_method = 'rectified' where claimant_user_id = v_u2;
  perform pg_temp.zz_check('O4 (control) an erasure that was only resolved another way does not count', 'false', public.org_in_gdpr_erasure(v_d)::text);
  update public.gdpr_requests set kind = 'access', status = 'pending', resolution_method = null where claimant_user_id = v_u2;
  perform pg_temp.zz_check('O4 (control) a pending request of another kind does not count', 'false', public.org_in_gdpr_erasure(v_d)::text);
  delete from public.gdpr_requests where claimant_user_id = v_u2;

  insert into public.blocked_emails(email, reason, blocked_by) select lower(btrim(u.email)), 'rehearsal', v_admin from auth.users u where u.id = v_u2;
  begin perform public.moderation_reopen_org(v_d, 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('O5 a member e-mail is on blocked_emails: refused', 'a member''s e-mail is on the blocked list', v_got);
  delete from public.blocked_emails where reason = 'rehearsal';

  select o.id into v_act from public.orgs o where o.moderation_status = 'active' and o.closed_at is null and o.id <> v_d and exists (select 1 from public.org_members m where m.org_id = o.id) order by o.created_at limit 1;
  begin perform public.moderation_reopen_org(v_act, 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('O6 an active org: refused', 'only a deleted account can be reopened (its status is active)', v_got);
  update public.orgs set moderation_status = 'suspended' where id = v_act;
  begin perform public.moderation_reopen_org(v_act, 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('O6 a suspended org: refused (that is undo, not reopen)', 'only a deleted account can be reopened (its status is suspended)', v_got);
  update public.orgs set moderation_status = 'active' where id = v_act;

  -- the success path
  perform pg_temp.zz_as(v_u2);
  perform pg_temp.zz_info('O1 before: the door for one member of that org (new functions)', public.account_access_state());
  v_json := public.moderation_reopen_org(v_d, 'Rehearsal: reopening to prove the path', v_admin);
  perform pg_temp.zz_info('O1 function result', v_json::text);
  perform pg_temp.zz_check('O1 org after: moderation_status | quarantine | suspended_until', 'active||',
    (select o.moderation_status::text || '|' || coalesce(o.moderation_quarantine_until::text, '') || '|' || coalesce(o.moderation_suspended_until::text, '') from public.orgs o where o.id = v_d));
  perform pg_temp.zz_check('O1 one row in the moderation history, action reopen, with the reason', '1|true',
    (select count(*)::text || '|' || (max(a.justification) like 'Rehearsal:%')::text from public.account_moderation_actions a where a.target_id = v_d and a.action = 'reopen'));
  perform pg_temp.zz_check('O1 one audit row (org_moderation_reopened), with the previous status', '1|deleted',
    (select count(*)::text || '|' || coalesce(max(a.detail->>'previousStatus'), '') from public.admin_audit_log a where a.action = 'org_moderation_reopened' and a.subject_id = v_d));
  perform pg_temp.zz_as(v_u2);
  perform pg_temp.zz_check('O1 the door for that member afterwards', 'active', public.account_access_state());
  begin perform public.moderation_reopen_org(v_d, 'again', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('O1 reopening twice is refused (it is not deleted any more)', 'only a deleted account can be reopened', v_got);

  -- 5. RELEASE: the refusals and the cases the real one did not cover
  update public.orgs set moderation_status = 'deleted' where id = v_d;
  begin perform public.moderation_release_org_member(v_act, (select m.user_id from public.org_members m where m.org_id = v_act limit 1), 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('X1 an active org: refused', 'only a closed or deleted account can release a member', v_got);
  begin perform public.moderation_release_org_member(v_d, gen_random_uuid(), 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('X2 someone who is not a member: refused', 'that person is not a member of this account', v_got);

  update public.orgs set closed_at = now(), closed_reason = 'owner', purge_after = now() + interval '20 days' where id = v_d;
  begin perform public.moderation_release_org_member(v_d, v_u2, 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('X3 closed by its owner, reopen window still open: refused', 'this account was closed by its owner and can still be reopened until', v_got);
  update public.orgs set purge_after = now() - interval '1 day' where id = v_d;

  insert into public.gdpr_requests(claimant_email, claimant_user_id, kind, status, due_at) select u.email, u.id, 'erase', 'pending', now() + interval '30 days' from auth.users u where u.id = v_u2;
  begin perform public.moderation_release_org_member(v_d, v_u2, 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('X4 a member is in a GDPR erasure: refused', 'a member of this account is in a GDPR erasure', v_got);
  delete from public.gdpr_requests where claimant_user_id = v_u2;

  insert into public.blocked_emails(email, reason, blocked_by) select lower(btrim(u.email)), 'rehearsal', v_admin from auth.users u where u.id = v_u2;
  begin perform public.moderation_release_org_member(v_d, v_u2, 'rehearsal', v_admin); v_got := 'NO ERROR'; exception when others then v_got := sqlerrm; end;
  perform pg_temp.zz_check_like('X5 the e-mail is on blocked_emails: refused', 'this e-mail is on the blocked list', v_got);
  delete from public.blocked_emails where reason = 'rehearsal';
  perform pg_temp.zz_check('X5 (nothing was removed by the refusals)', '1', (select count(*)::text from public.org_members where org_id = v_d and user_id = v_u2));

  -- an account the owner closed, whose window has ended: allowed, and it was already closed so nothing new is closed
  v_json := public.moderation_release_org_member(v_d, v_u2, 'Rehearsal: closed by owner, window ended', v_admin);
  perform pg_temp.zz_check('X6 owner-closed with the window ended: allowed; closedByThisRelease', 'false', v_json->>'closedByThisRelease');

  -- not the last member: the org is not closed by the release
  update public.orgs set closed_at = null, closed_reason = null, purge_after = null where id = v_d;
  insert into public.org_members(org_id, user_id, role) select v_d, u.id, 'member'::public.org_role from auth.users u
   where not exists (select 1 from public.org_members m where m.user_id = u.id) and u.id <> v_alex order by u.created_at limit 2;
  select count(*) into v_n from public.org_members where org_id = v_d;
  perform pg_temp.zz_info('X7 members of the org now', v_n::text);
  v_json := public.moderation_release_org_member(v_d, (select m.user_id from public.org_members m where m.org_id = v_d order by m.user_id limit 1), 'Rehearsal: one of several', v_admin);
  perform pg_temp.zz_check('X7 not the last member: closedByThisRelease | orgNowClosed', 'false|false', (v_json->>'closedByThisRelease') || '|' || (v_json->>'orgNowClosed'));
  perform pg_temp.zz_check('X7 not the last member: the org stays deleted and open (nothing else changes)', 'deleted|', (select o.moderation_status::text || '|' || coalesce(o.closed_at::text, '') from public.orgs o where o.id = v_d));

  -- 6. THE OTHER HAT: an investor seat (C: deleted + investor -> in)
  select mim.user_id, om.org_id, mim.catalog_entity_id into v_su, v_so, v_sf
    from public.matchdeal_investor_members mim
    join public.org_members om on om.user_id = mim.user_id
    join public.orgs o on o.id = om.org_id
    join public.catalog_entities ce on ce.id = mim.catalog_entity_id
   where mim.status = 'active' and o.moderation_status = 'active' and o.closed_at is null and ce.moderation_status = 'active'
     and not exists (select 1 from public.incubator_members x join public.incubators i on i.id = x.incubator_id where x.user_id = mim.user_id and x.status = 'active' and i.closed_at is null)
   order by mim.created_at limit 1;
  if v_su is null then
    perform pg_temp.zz_info('S0 investor seat', 'no user with an active investor seat AND a live org without an ecosystem hat: the seat cases were not run');
  else
   begin
    perform pg_temp.zz_check('S0 (control) live org + investor seat', 'active -> active', pg_temp.zz_door(v_su));
    update public.orgs set moderation_status = 'deleted' where id = v_so;
    perform pg_temp.zz_check('S1 deleted org + active investor seat: door old -> new  [C: deleted+investor -> in]', 'suspended -> active', pg_temp.zz_door(v_su));
    update public.catalog_entities set moderation_status = 'suspended', moderation_suspended_until = null where id = v_sf;
    perform pg_temp.zz_check('S2 deleted org + a seat in a SUSPENDED firm: a sanction, still blocked', 'suspended -> suspended', pg_temp.zz_door(v_su));
    update public.catalog_entities set moderation_status = 'deleted', moderation_suspended_until = null where id = v_sf;
    perform pg_temp.zz_check('S3 deleted org + a seat in a DELETED firm: that seat is not a live hat', 'suspended -> suspended', pg_temp.zz_door(v_su));
    update public.catalog_entities set moderation_status = 'active' where id = v_sf;
    update public.matchdeal_investor_members set status = 'revoked' where user_id = v_su and catalog_entity_id = v_sf;
    perform pg_temp.zz_check('S4 deleted org + a REVOKED seat: not a hat', 'suspended -> suspended', pg_temp.zz_door(v_su));
   exception when others then
    perform pg_temp.zz_info('S error (the seat cases did not complete)', sqlerrm);
   end;
  end if;

  -- 7. WHO MAY CALL WHAT
  perform pg_temp.zz_check('P1 anon / authenticated / service_role may execute moderation_reopen_org', 'false|false|true',
    has_function_privilege('anon', 'public.moderation_reopen_org(uuid,text,uuid)', 'execute')::text || '|' ||
    has_function_privilege('authenticated', 'public.moderation_reopen_org(uuid,text,uuid)', 'execute')::text || '|' ||
    has_function_privilege('service_role', 'public.moderation_reopen_org(uuid,text,uuid)', 'execute')::text);
  perform pg_temp.zz_check('P1 anon / authenticated / service_role may execute moderation_release_org_member', 'false|false|true',
    has_function_privilege('anon', 'public.moderation_release_org_member(uuid,uuid,text,uuid)', 'execute')::text || '|' ||
    has_function_privilege('authenticated', 'public.moderation_release_org_member(uuid,uuid,text,uuid)', 'execute')::text || '|' ||
    has_function_privilege('service_role', 'public.moderation_release_org_member(uuid,uuid,text,uuid)', 'execute')::text);
  perform pg_temp.zz_check('P1 anon / authenticated may execute the helpers (account_has_live_hat, org_in_gdpr_erasure, org_has_blocked_member)', 'false|false',
    (has_function_privilege('anon', 'public.account_has_live_hat()', 'execute') or has_function_privilege('anon', 'public.org_in_gdpr_erasure(uuid)', 'execute') or has_function_privilege('anon', 'public.org_has_blocked_member(uuid)', 'execute'))::text || '|' ||
    (has_function_privilege('authenticated', 'public.account_has_live_hat()', 'execute') or has_function_privilege('authenticated', 'public.org_in_gdpr_erasure(uuid)', 'execute') or has_function_privilege('authenticated', 'public.org_has_blocked_member(uuid)', 'execute'))::text);
  perform pg_temp.zz_check('P2 the middleware still reaches the door: anon / authenticated may execute account_access_state and is_account_suspended', 'true|true|true|true',
    has_function_privilege('anon', 'public.account_access_state()', 'execute')::text || '|' || has_function_privilege('authenticated', 'public.account_access_state()', 'execute')::text || '|' ||
    has_function_privilege('anon', 'public.is_account_suspended()', 'execute')::text || '|' || has_function_privilege('authenticated', 'public.is_account_suspended()', 'execute')::text);
  begin insert into public.account_moderation_actions(target_type, target_id, action, justification, actor) values ('org', v_org, 'bogus', 'x', v_admin); v_got := 'NO ERROR';
  exception when check_violation then v_got := sqlstate; end;
  perform pg_temp.zz_check('P3 the history CHECK still refuses an unknown action (and accepted reopen in O1)', '23514', v_got);

  -- 8. THE ANSWER
  select string_agg(
           case when mode = 'info' then 'INFO ' when (mode = 'exact' and expected is not distinct from got) or (mode = 'prefix' and got like expected || '%') then 'PASS ' else 'FAIL ' end
           || name || case when mode = 'info' then ' :: ' || coalesce(got, '') else ' :: expected [' || coalesce(expected, 'null') || '] got [' || coalesce(got, 'null') || ']' end,
           E'\n' order by seq),
         count(*) filter (where (mode = 'exact' and expected is not distinct from got) or (mode = 'prefix' and got like expected || '%')),
         count(*) filter (where mode <> 'info' and not ((mode = 'exact' and expected is not distinct from got) or (mode = 'prefix' and got like expected || '%')))
    into v_out, v_pass, v_fail from zz_res;
  raise exception E'REHEARSAL_RESULT pass=% fail=%\n%', v_pass, v_fail, v_out;
end
$rehearsal$;
