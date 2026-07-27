-- Investor landing lead capture (/signup?as=investor) — replaces the
-- placeholder "ask a founder" panel with a real request-access form.
--
-- RLS modelled on the REAL support_tickets policy (0036), confirmed live via
-- REST before writing this — not assumed from the migration file alone:
-- `for all using (is_platform_admin())` blocks anon SELECT (returns empty,
-- not an error) AND anon INSERT (401, RLS violation). There is no public
-- insert policy on support_tickets at all; the public /api/support/submit
-- route writes through the service role, never as the anon client. This
-- migration follows that exact shape rather than the "insert público com
-- rate limit" pattern first suggested, because that isn't actually what the
-- support system does — same lockdown, same service-role-writes-instead
-- pattern, same separate rate-limit table.

create table investor_access_requests (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  email text not null,
  firm_name text,
  note text,
  source text not null default 'investor_landing_signup',
  contacted_at timestamptz,
  contacted_by text
);

-- Same anti-spam shape as support_rate_limit (0036): one row per POST
-- attempt, keyed by IP, counted over the last hour by the route before it
-- accepts a submission. Nothing else ever reads this table.
create table investor_access_request_rate_limit (
  id uuid primary key default uuid_generate_v4(),
  ip text not null,
  created_at timestamptz not null default now()
);

alter table investor_access_requests enable row level security;
alter table investor_access_request_rate_limit enable row level security;

create policy investor_access_requests_platform_admin on investor_access_requests for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy investor_access_request_rate_limit_platform_admin on investor_access_request_rate_limit for all
  using (is_platform_admin()) with check (is_platform_admin());

create index on investor_access_requests (created_at);
create index on investor_access_requests (contacted_at);
create index on investor_access_request_rate_limit (ip, created_at);
