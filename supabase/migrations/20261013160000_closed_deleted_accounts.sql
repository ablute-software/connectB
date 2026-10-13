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
