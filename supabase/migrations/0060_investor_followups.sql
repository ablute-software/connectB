-- Investor Workspace Agenda + Today (prompt 59) — the only new schema this
-- prompt needs. Meetings reuse matchdeal_meeting_proposals (no parallel
-- meetings system, per the prompt's own instruction); round-close deadlines
-- read straight off orgs.round_target_close_date; Q&A answers read
-- portal_questions (0059). Only "investor creates a manual reminder from a
-- startup card" has nothing to reuse.
--
-- Private to the investor who created it — unlike investor_ticket_signals/
-- investor_soft_commits (deliberately founder-visible signals), a follow-up
-- reminder is the investor's own to-do, not a signal to surface to the
-- founder. So: RLS enabled, but no org-member policy grants founder access
-- either — service-role portal routes are the only way in or out, same
-- trust boundary as every other portal write path.
create table investor_followups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  investor_email text not null,
  note text,
  remind_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table investor_followups enable row level security;
create index on investor_followups (investor_email, remind_at);
