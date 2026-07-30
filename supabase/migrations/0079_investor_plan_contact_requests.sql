-- PLAN-02/03 — Private Detective (4th investor plan, no fixed price) lead
-- capture. Same shape as investor_access_requests (0039), confirmed as the
-- real pattern this codebase uses for public lead forms: no public insert
-- policy — the public route (/api/plan/private-detective) writes through
-- the service role, never the anon client — plus a dedicated per-form rate
-- limit table, same as every other public form here.
create table investor_plan_contact_requests (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  email text not null,
  investor_type text not null,
  firm_name text not null,
  message text not null,
  firm_website text,
  linkedin text,
  -- New -> Under review -> Contacted -> Proposal sent -> Converted -> Closed
  -- (spec's own state list, verbatim).
  status text not null default 'new'
    check (status in ('new', 'under_review', 'contacted', 'proposal_sent', 'converted', 'closed')),
  internal_notes text,
  source text not null default 'landing_investors',
  updated_at timestamptz not null default now()
);

create table investor_plan_contact_rate_limit (
  id uuid primary key default uuid_generate_v4(),
  ip text not null,
  created_at timestamptz not null default now()
);

alter table investor_plan_contact_requests enable row level security;
alter table investor_plan_contact_rate_limit enable row level security;

create policy investor_plan_contact_requests_platform_admin on investor_plan_contact_requests for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy investor_plan_contact_rate_limit_platform_admin on investor_plan_contact_rate_limit for all
  using (is_platform_admin()) with check (is_platform_admin());

create index on investor_plan_contact_requests (created_at);
create index on investor_plan_contact_requests (status);
create index on investor_plan_contact_rate_limit (ip, created_at);
