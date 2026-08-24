-- Prompt 358 Phase 2 — the reconciliation engine's own state. Two tables:
--
-- gap_reconciliations: one row per (accepted, otherwise-undocumented) claim,
-- upserted on every reconciliation pass. This is CURRENT STATE, not history
-- — a claim has exactly one reconciliation verdict at a time, same reasoning
-- as company_claims itself (Prompt 358 Phase 1's convergence invariant: a
-- gap closed must never resurface under a new identity). 'auto_linked'
-- (high confidence — the engine already linked the document itself, via the
-- pre-existing link_claim_document_ref RPC, migration 0208) and 'uncovered'
-- (genuinely nothing matches — G4 is allowed to ask) need no founder action.
-- 'suggested' (medium confidence) is the one-click-confirm state; 'dismissed'
-- is a founder saying "no, that's not it", which must never re-suggest the
-- SAME match again (see confirmed_status filter in reconciliation.ts).
--
-- gap_questions: the ledger Phase 2.2 needs — every question actually shown
-- to the founder, keyed by (org_id, gap_key) so "the exact same question for
-- the same claim must never be asked twice" is an invariant the DATABASE
-- enforces (unique index), not something answer/route.ts has to remember to
-- check. answered_at/disposition let the backoffice engine-health metric
-- (Phase 3.3) compute "resolved by reconciliation vs resolved by question"
-- and "repeated-question rate" from real numbers.
create table if not exists gap_reconciliations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  claim_id uuid not null references company_claims(id) on delete cascade,
  run_hash text not null,
  confidence text not null check (confidence in ('high', 'medium', 'none')),
  matched_document_id uuid references documents(id) on delete set null,
  evidence_quote text,
  reasoning text,
  status text not null default 'pending' check (status in ('auto_linked', 'suggested', 'uncovered', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (claim_id)
);

create index if not exists gap_reconciliations_org_idx on gap_reconciliations(org_id);

alter table gap_reconciliations enable row level security;

drop policy if exists gap_reconciliations_org_members on gap_reconciliations;
create policy gap_reconciliations_org_members on gap_reconciliations
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table gap_reconciliations is
  'Prompt 358 Phase 2 — AI reconciliation verdict per claim, current state only. One row per claim, upserted on each pass.';

create table if not exists gap_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  claim_id uuid references company_claims(id) on delete set null,
  gap_key text not null,
  rule text not null,
  question_text text not null,
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  disposition text,
  created_at timestamptz not null default now()
);

create index if not exists gap_questions_org_idx on gap_questions(org_id);
create unique index if not exists gap_questions_org_gapkey_idx on gap_questions(org_id, gap_key);

alter table gap_questions enable row level security;

drop policy if exists gap_questions_org_members on gap_questions;
create policy gap_questions_org_members on gap_questions
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table gap_questions is
  'Prompt 358 Phase 2.2 — every gap question actually shown to a founder. unique(org_id, gap_key) makes "never ask the same question twice" a DB invariant.';
