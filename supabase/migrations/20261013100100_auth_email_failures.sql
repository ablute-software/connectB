-- Prompt 911 — the registry of FAILED authentication emails (sign-up code / confirmation, password recovery).
--
-- APPLIED to production on 13/10/2026 (pre-authorised: additive), after a dry run inside a transaction that always rolls
-- back: service_role could insert, read and delete; the action check refused an unknown action; anon and authenticated
-- were refused; nothing persisted.
--
-- Why. From 12/10/2026 10:11 UTC the Supabase Auth SMTP (Resend) refused every message ("550 The sherlockdeal.com
-- domain is not verified") and the app showed `{}`. Nobody inside the product knew for a day: the only trace was in
-- Supabase's Auth logs, which keep one day. Four people were turned away (and who they were had to be dug out of those
-- logs). This table is the product's own memory of it: every failure to send a sign-up or recovery email is written
-- here (email, action, error, time) and is read in Backoffice -> Email delivery, so the next failure is seen the same day.
--
-- What it is not. It is not an `email_send_log` (that one records the platform's own Resend sends). Here the sender is
-- Supabase Auth through its SMTP, or the 6-digit-code routes; the app only learns of a failure from the error that came
-- back.
--
-- Personal data. The email address of a person who could not register is personal data: it is kept for 90 days only
-- (the writer removes older rows each time it writes) and read by platform administrators only.
--
-- Additive: one new table, no change to any existing object.
--
-- No policies on purpose: RLS on + no policy = no access for anon/authenticated. Only the service role (our routes)
-- reaches it, like auth_code_state.

create table if not exists public.auth_email_failures (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  email         text        not null,   -- lower-cased by the writer
  action        text        not null,   -- signup | resend_code | recover | invite_signup | signup_already_registered
  source        text        not null default 'server',   -- server = a route of ours saw it; browser = the page reported it
  http_status   integer,
  error_code    text,                   -- e.g. unexpected_failure, over_email_send_rate_limit
  error_message text,                   -- the provider's text, truncated by the writer
  constraint auth_email_failures_action_chk check (action in ('signup', 'resend_code', 'recover', 'invite_signup', 'signup_already_registered')),
  constraint auth_email_failures_source_chk check (source in ('server', 'browser'))
);

create index if not exists auth_email_failures_created_idx on public.auth_email_failures (created_at desc);

alter table public.auth_email_failures enable row level security;

revoke all on public.auth_email_failures from public, anon, authenticated;
grant select, insert, delete on public.auth_email_failures to service_role;
