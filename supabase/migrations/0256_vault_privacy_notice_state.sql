-- Prompt 404 §A (supersedes 403 §A's org-scoped design with a per-USER
-- one — "de outro modo um pode ser informado e os outros não"). Same
-- shape 403 §A.1 specified verbatim: one row per user, own RLS, no
-- service-role route needed (404 §A.1 drops 403's dedicated-route
-- suggestion in favour of reading/writing directly via browserClient()).
-- Copied pattern from 0043_onboarding_state.sql, kept as its own table
-- rather than folded into that engine: onboarding_state is a deliberate
-- lifetime-budget-of-3, once-each mechanism (its own content.ts and
-- tests enforce that) — this notice is recurring by design (403 §A.2),
-- which would break that guarantee for the other two items.
create table vault_privacy_notice_state (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  first_shown_at  timestamptz,
  last_shown_at   timestamptz
);
alter table vault_privacy_notice_state enable row level security;
create policy vault_privacy_notice_state_own on vault_privacy_notice_state for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
