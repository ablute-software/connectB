-- Investor Workspace Fase 3 (prompt 56) — Q&A, round updates, soft commit.
-- Three new tables, all following the same pattern as investor_ticket_signals
-- (migration 0055): investors are never org_members, so there is no
-- investor-facing RLS policy on any of these — every investor read/write
-- goes through a service-role portal route, which applies the same
-- is_ablute_developer() QA no-write guard document_views/ticket-signal use.
-- RLS here only grants the founder's own org read/write.
--
-- Schema choice for Q&A (Bloco 1 point 5): a NEW table, not a `contributions`
-- row with a new `kind`. contributions is the AI-composer's fact-grounding
-- model — confirmed/superseded claims about the company, with its own
-- lifecycle (confirm, supersede, category taxonomy) that the AI composer
-- and Review & Optimization ranking both depend on. A Q&A thread has a
-- completely different lifecycle (asked -> answered -> optionally promoted
-- to FAQ, with per-question read/notify state) that doesn't fit that
-- model — folding it in would mean either polluting contributions' kind
-- enum with something AI grounding should never treat as a "fact," or
-- growing contributions extra nullable columns (question/answer/is_faq)
-- that only ever apply to one kind. A dedicated table is the smaller,
-- clearer change.
create table portal_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  asked_by_email text not null,
  question text not null,
  answer text,
  answered_at timestamptz,
  answered_by uuid references auth.users(id),
  is_faq boolean not null default false,
  created_at timestamptz not null default now()
);
alter table portal_questions enable row level security;
create policy portal_questions_org_members on portal_questions for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));
create index on portal_questions (org_id, created_at desc);

-- Bloco 2 — round updates. Founder-authored, markdown body, feed order =
-- created_at desc. No edit history table: an update is a point-in-time
-- announcement, not a fact needing supersession.
create table round_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table round_updates enable row level security;
create policy round_updates_org_members on round_updates for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));
create index on round_updates (org_id, created_at desc);

-- Bloco 3 — soft commit. A concrete amount, explicitly non-binding (the
-- portal UI must say so, not this schema). confirmed_by_founder gates
-- whether it counts toward the round progress bar — recommended rule per
-- the prompt (founder confirms each one manually before it counts, so the
-- founder controls what the bar shows rather than every investor's
-- self-reported figure landing there automatically).
--
-- Relationship-stage integration (Bloco 3 point 2): deliberately NOT a new
-- RelationshipStage enum value. soft_committed is a flag/badge layered on
-- top of the existing stage machine (STAGE_ORDER in relationship.ts),
-- surfaced in the pipeline UI, rather than a 7th stage threaded through
-- every place STAGE_ORDER/STAGE_LABEL is consumed — smaller blast radius,
-- and a soft commit is orthogonal to "how far the conversation has
-- progressed" (an investor can soft-commit at 'diligence' or 'decision').
create table investor_soft_commits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  investor_email text not null,
  amount_eur numeric not null check (amount_eur > 0),
  confirmed_by_founder boolean not null default false,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table investor_soft_commits enable row level security;
create policy investor_soft_commits_org_members on investor_soft_commits for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));
create index on investor_soft_commits (org_id, created_at desc);
