-- Prompt 911 (follow-up, 13/10/2026) — the failure registry also records the passwordless LOGIN email (investor magic link / code,
-- guest preview, /pair): same Auth SMTP, same outage, so the same registry. One new allowed value for `action`: 'login'.
--
-- APPLIED to production on 13/10/2026 (pre-authorised: it only widens a check on the table 20261013100100 created), after a dry
-- run inside a transaction that always rolls back: 'login' accepted, an unknown action still refused, nothing persisted.

alter table public.auth_email_failures drop constraint auth_email_failures_action_chk;
alter table public.auth_email_failures add constraint auth_email_failures_action_chk
  check (action in ('signup', 'resend_code', 'recover', 'invite_signup', 'signup_already_registered', 'login'));
