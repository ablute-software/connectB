-- Prompt 330 §B — Pipeline's "Partners & colleagues" panel needs a third
-- invite path: a founder who already personally knows someone with a real
-- Sherlock Deal account (ex-colleagues, accelerator batchmates not yet a
-- formal group in the product) but has no automatically-verifiable
-- shared_investor/shared_group/referral signal to point to.
--
-- Deliberately NOT a bypass of Prompt 316's "no open people search — every
-- connection starts from verified, shared context" rule: the other three
-- context_kind values stay exactly as strict as before (an automatic,
-- app-computed signal, no human justification needed). This new value
-- trades that automatic signal for a REQUIRED, RECEIVER-VISIBLE human
-- explanation instead — `message` was already not-null on this table; here
-- it's the founder's own account of how they know this person, shown to the
-- recipient before they ever accept, exactly like every other invite.
alter table network_invites drop constraint if exists network_invites_context_kind_check;
alter table network_invites add constraint network_invites_context_kind_check
  check (context_kind in ('shared_investor', 'shared_group', 'referral', 'direct_known'));

-- Email -> org lookup, for "does an account already exist for this email".
-- The JS admin SDK has no getUserByEmail (only getUserById/listUsers), and
-- an unbounded listUsers() scan was explicitly declined for this exact
-- reason elsewhere in this codebase (deal-messages.ts's own
-- founderMessageEligibleFirms comment) — auth.users.email IS indexed and
-- directly queryable in SQL, so a narrow SECURITY DEFINER function reading
-- ONLY that one indexed lookup (never returning anything beyond org id/
-- name) is the bounded alternative. Locked to service_role only: this must
-- never be callable by an ordinary authenticated user, who could otherwise
-- use it to enumerate which emails have accounts.
create or replace function public.find_org_by_member_email(p_email text)
returns table(org_id uuid, org_name text)
language sql
security definer
set search_path = public
as $$
  select o.id, o.name
  from auth.users u
  join org_members om on om.user_id = u.id
  join orgs o on o.id = om.org_id
  where lower(u.email) = lower(p_email)
  limit 1;
$$;

revoke all on function public.find_org_by_member_email(text) from public;
revoke all on function public.find_org_by_member_email(text) from anon;
revoke all on function public.find_org_by_member_email(text) from authenticated;
grant execute on function public.find_org_by_member_email(text) to service_role;
