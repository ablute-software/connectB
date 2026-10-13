-- Prompt 900 — ROLLBACK of migration 20261013160000_closed_deleted_accounts.sql. NOT to be run unless that migration has to be undone.
--
-- The two replaced functions are put back EXACTLY as production had them on 13/10/2026 before the migration was applied (text captured
-- from pg_get_functiondef that day). Both are CREATE OR REPLACE, so their grants (anon, authenticated, service_role may execute) are kept.
-- The new helpers are dropped AFTER the old functions are back (the new account_access_state()/is_account_suspended() reference
-- account_has_live_hat(); the old ones do not).
--
-- The widened CHECK goes back to its three values: it FAILS if a 'reopen' row exists in account_moderation_actions. Reopened accounts keep
-- their status; to undo the CHECK anyway, first decide what to do with those history rows (delete them or recode them), then run the line.
--
-- NOT rolled back: the blocked_emails row for ablutealex@gmail.com (a separate decision, 13/10/2026) — delete it by hand to let that
-- account in.

create or replace function public.account_access_state()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when exists (
      select 1 from public.blocked_emails be
        join auth.users u on lower(u.email) = be.email
       where u.id = auth.uid()
    ) then 'blocked'
    when exists (
      select 1 from public.org_members m
        join public.orgs o on o.id = m.org_id
       where m.user_id = auth.uid() and o.closed_at is not null and o.closed_reason = 'owner'
    ) then 'closed'
    when public.is_account_suspended() then 'suspended'
    else 'active'
  end;
$function$;

create or replace function public.is_account_suspended()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select true from public.org_members om
       join public.orgs o on o.id = om.org_id
      where om.user_id = auth.uid()
        and (o.moderation_status = 'deleted'
             or (o.moderation_status = 'suspended'
                 and (o.moderation_suspended_until is null or o.moderation_suspended_until > now())))
      limit 1),
    (select true from public.matchdeal_investor_members mim
       join public.catalog_entities ce on ce.id = mim.catalog_entity_id
      where mim.user_id = auth.uid() and mim.status = 'active'
        and (ce.moderation_status = 'deleted'
             or (ce.moderation_status = 'suspended'
                 and (ce.moderation_suspended_until is null or ce.moderation_suspended_until > now())))
      limit 1),
    false
  );
$function$;

drop function if exists public.moderation_release_org_member(uuid, uuid, text, uuid);
drop function if exists public.moderation_reopen_org(uuid, text, uuid);
drop function if exists public.org_has_blocked_member(uuid);
drop function if exists public.org_in_gdpr_erasure(uuid);
drop function if exists public.account_has_live_hat();

alter table public.account_moderation_actions drop constraint if exists account_moderation_actions_action_check;
alter table public.account_moderation_actions
  add constraint account_moderation_actions_action_check
  check (action = any (array['suspend'::text, 'undo'::text, 'delete'::text]));
