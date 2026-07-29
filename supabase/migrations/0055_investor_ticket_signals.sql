-- Investor Workspace Fase 1 — Zona 2 ticket selector (prompt 54).
--
-- Append-only by design, never UPDATE: the founder wants to see the
-- evolution of an investor's stated ticket range over time ("indicou
-- ticket €25k–€50k a 29/07... depois €50k–€100k a 05/08"), not just the
-- latest value overwriting the last. "Current" is derived by ordering
-- (org_id, investor_email) rows by created_at desc and taking the first —
-- no separate "is_current" flag to keep in sync.
--
-- person_id is nullable and NOT the primary key of "who this is" —
-- investor_email is, matching access_grants' own grantee_email pattern.
-- A person row may not exist yet (this could be the first real signal from
-- an email that only ever had a founder-invited people row, or none at
-- all) — never block capturing the signal on that.
--
-- No client-facing write policy: the investor is never an org_member, so
-- (same reasoning as document_views, access_grants) this is written by a
-- new service-role route (/api/portal/ticket-signal), which must apply the
-- same is_ablute_developer() QA no-write guard as /api/portal/view from
-- its first line of code, not bolted on after.
create table investor_ticket_signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  person_id uuid references people(id),
  investor_email text not null,
  range_min_eur int,
  range_max_eur int,       -- null = open-ended ("€100k+")
  range_label text not null,  -- "€25k–€50k", "€100k+", or the free "outro" text
  created_at timestamptz not null default now()
);

alter table investor_ticket_signals enable row level security;

-- Read-only for the founder's own org — this is signal ABOUT investors,
-- not something an investor's own session ever reads back (the portal
-- write route uses service-role, bypassing RLS entirely for the insert).
create policy investor_ticket_signals_org_members on investor_ticket_signals for select
  using (is_org_member(org_id));

create index on investor_ticket_signals (org_id, investor_email, created_at desc);
