-- Prompt 350 §B — two more per-deal, editable-any-time investor signals next
-- to the ticket range: "Considering: Leading/Following/Both" and "Type of
-- investment" (multi-select, same instruments taxonomy as
-- matchdeal_profiles.instruments/RoundCard — never a second parallel list).
--
-- Sibling table to investor_ticket_signals, same shape and same convention
-- (append-only insert, "current" = latest row per org_id+investor_email,
-- never an UPDATE) — investor_ticket_signals's own migration 0055 documents
-- this as deliberate: the founder benefits from the evolution over time, not
-- just the latest value. A sibling table rather than extending
-- investor_ticket_signals itself: the ticket range and these two signals are
-- edited independently (the UI lets you set one without resubmitting the
-- other), so forcing them into one row would mean either always writing all
-- three together or nullable-overwriting fields the caller didn't touch.
create table investor_deal_signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  person_id uuid references people(id),
  investor_email text not null,
  considering text check (considering = any (array['lead', 'co_lead', 'both'])),
  instruments text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

alter table investor_deal_signals enable row level security;

-- Read-only for the founder's own org — same posture as
-- investor_ticket_signals: this is signal ABOUT investors, not something an
-- investor's own session reads back (the write route uses service-role,
-- bypassing RLS entirely for the insert).
create policy investor_deal_signals_org_members on investor_deal_signals for select
  using (is_org_member(org_id));

create index on investor_deal_signals (org_id, investor_email, created_at desc);
