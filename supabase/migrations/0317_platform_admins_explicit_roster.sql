-- Prompt 576 §3a — the back-office entry gate becomes one explicit table,
-- not a table plus a domain guess.
--
-- `platform_admins` and `is_platform_admin()` already existed (0002); 0050
-- added a `%@ablute.pt` fallback to `is_platform_admin()` so a confirmed
-- @ablute.pt account never needed a row in the table. That fallback is what
-- this migration removes — not because it broke anything, but because it
-- means the actual admin roster is split across two places (a table you can
-- read, and an email pattern you can't list), and because it can't grant
-- `sherlockdeal.com@gmail.com` back-office access without also handing it to
-- every future @ablute.pt address, which is a company domain, not a curated
-- admin list.
--
-- Checked before writing this (2026-09-05): both existing platform_admins
-- rows (nunomarujo@ablute.pt, alexandrameira@ablute.pt) already exist with
-- role='admin' — this migration adds neither of them for real, the INSERT
-- below is a documented no-op for anyone already there. Nobody currently
-- reaching the back-office only through the domain fallback loses access,
-- because there was nobody: every confirmed @ablute.pt account already has
-- an explicit row (provision-org upserts one on signup, per 0050's own
-- header). sherlockdeal.com@gmail.com does not, and is the one account this
-- migration actually adds.

-- §1 — backfill safety net, matching 0050's own reasoning: if provision-org's
-- swallowed-exception upsert ever silently failed for a confirmed @ablute.pt
-- account, this closes that gap one last time before the domain fallback
-- that used to cover it is removed below.
insert into public.platform_admins (user_id, role)
select u.id, 'admin'
from auth.users u
where u.email_confirmed_at is not null
  and lower(u.email) like '%@ablute.pt'
on conflict (user_id) do nothing;

-- §2 — the one account this migration actually grants. Sherlock Deal is its
-- own real customer org (its own founder account, unrelated to this), and
-- this same address is being given back-office + Metrics access as an
-- operator account too — an explicit row here, not a second domain rule.
insert into public.platform_admins (user_id, role)
select u.id, 'admin'
from auth.users u
where lower(u.email) = 'sherlockdeal.com@gmail.com'
on conflict (user_id) do nothing;

-- §3 — is_platform_admin() drops the domain fallback. The table is now the
-- entire answer to "who is a platform admin" — §1/§2 above are what make
-- this safe to do in the same migration rather than a follow-up.
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- §4 — is_ablute_developer() becomes a thin alias rather than being dropped:
-- ~40 call sites across migrations 0051/0086/0088/0094/0116/0119/0121/0134/
-- 0139/0144/0154/0166/0170-0172/0305/0311 (RLS policies and inline
-- `v_exempt := public.is_ablute_developer()` checks) call it by name and
-- expect a no-arg boolean. Redefining the body here means every one of them
-- picks up the table-only check with no edits and no chance of missing one —
-- the exact same "redefine the function, not ~16 policies" reasoning 0050
-- itself already used for the opposite change.
create or replace function public.is_ablute_developer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin();
$$;
