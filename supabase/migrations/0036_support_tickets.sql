-- Contact & Support — support_tickets/support_ticket_events (back-office
-- "Assistência ao Cliente") + support_rate_limit (anti-spam for the public
-- submit route). Same pattern as gdpr_requests (0012): RLS locks every
-- table to platform_admins only; the public submit route never writes as
-- the client, always through the service role in /api/support/submit.
--
-- Two deviations from the literal spec, called out explicitly:
--   1. uuid_generate_v4() instead of gen_random_uuid() — matches every other
--      table in this schema (uuid-ossp, enabled in 0001_init.sql), not a
--      new choice.
--   2. Added support_tickets.context (nullable) — the founder-app entry
--      point has an optional "What screen were you on?" field with nowhere
--      else to live; folding it into `message` would make it un-queryable.

create table support_tickets (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('landing','landing_investors','founder_app','investor_portal')),
  org_id uuid references orgs(id),          -- null se veio da landing pública
  user_id uuid references auth.users(id),   -- null se anónimo
  name text not null,
  email text not null,
  category text not null check (category in ('question','problem','billing','data_correction','claim_profile','other')),
  subject text not null,
  message text not null,
  context text,                             -- "What screen were you on?" (founder_app only)
  status text not null default 'new' check (status in ('new','open','waiting_user','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to text,
  last_activity_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz
);

create table support_ticket_events (
  id uuid primary key default uuid_generate_v4(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  created_at timestamptz not null default now(),
  author text not null,                     -- 'admin' | 'system' | email do requerente
  kind text not null check (kind in ('note','reply','status_change','email_sent')),
  body text
);

-- Anti-spam rate limit for /api/support/submit — one row per POST attempt
-- (honeypot hits included, so a bot retrying still burns its budget), keyed
-- by IP. The route counts rows in the last hour before accepting a
-- submission; nothing else ever reads this table.
create table support_rate_limit (
  id uuid primary key default uuid_generate_v4(),
  ip text not null,
  created_at timestamptz not null default now()
);

alter table support_tickets enable row level security;
alter table support_ticket_events enable row level security;
alter table support_rate_limit enable row level security;

create policy support_tickets_platform_admin on support_tickets for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy support_ticket_events_platform_admin on support_ticket_events for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy support_rate_limit_platform_admin on support_rate_limit for all
  using (is_platform_admin()) with check (is_platform_admin());

create index on support_tickets (status, created_at);
create index on support_tickets (org_id);
create index on support_tickets (last_activity_at);
create index on support_ticket_events (ticket_id, created_at);
create index on support_rate_limit (ip, created_at);
