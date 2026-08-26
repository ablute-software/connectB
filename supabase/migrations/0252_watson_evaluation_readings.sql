-- Prompt 394 §4.4 — Watson evaluation-support history. Today every "Get
-- Watson's opinion" click is ephemeral: the result lives only in useState in
-- the browser tab, never persisted (Prompt 349's own design for Chamber 1 —
-- private, on-demand). Nuno now wants a history of past readings, so this
-- adds the one thing that was missing: a durable per-(investor, startup)
-- log of what Watson said and when, so a later click can show "last read
-- Tue 14:02 — open that one, or ask for a new opinion?" and a "History"
-- view inside the results popup.
--
-- Same RLS posture as investor_feedback_shares (0229) / every other
-- investor-private table in this domain: no policy for authenticated/anon
-- at all (RLS enabled with an empty policy set is a hard deny for every
-- role except one with rolbypassrls) — the app only ever reads/writes this
-- through service-role API routes, which already scope every query to
-- `resolveActiveInvestorMember`'s own investor_member_id. Never visible to
-- the founder, never to a colleague at the same fund.
create table if not exists watson_evaluation_readings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  investor_member_id uuid not null references matchdeal_investor_members(id) on delete cascade,
  insights jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists watson_evaluation_readings_lookup_idx
  on watson_evaluation_readings (investor_member_id, org_id, created_at desc);
alter table watson_evaluation_readings enable row level security;

comment on table watson_evaluation_readings is
  'Prompt 394 §4.4 — Watson evaluation-support history, one row per generated (not re-read) opinion. Investor-private: no RLS policy for any client role, service-role routes only.';
