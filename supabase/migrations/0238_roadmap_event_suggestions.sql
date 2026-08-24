-- Prompt 359 Block D — "Suggest events" memory. unique(org_id, signature)
-- is what makes "dispensada não volta a aparecer" a DB invariant rather
-- than something the AI pass has to remember on its own — same discipline
-- as gap_reconciliations/gap_questions (Prompt 358 Phase 2). signature is a
-- stable key over the candidate's own title+date (not a random id), so the
-- SAME real-world fact proposed again on a later pass upserts onto the same
-- row instead of duplicating.
create table if not exists roadmap_event_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  signature text not null,
  title text not null,
  date date not null,
  date_precision text not null default 'approx' check (date_precision in ('exact', 'approx', 'quarter')),
  category_label text,
  document_id uuid references documents(id) on delete set null,
  reasoning text,
  status text not null default 'pending' check (status in ('pending', 'added', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, signature)
);

create index if not exists roadmap_event_suggestions_org_idx on roadmap_event_suggestions(org_id, status);

alter table roadmap_event_suggestions enable row level security;

drop policy if exists roadmap_event_suggestions_org_members on roadmap_event_suggestions;
create policy roadmap_event_suggestions_org_members on roadmap_event_suggestions
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table roadmap_event_suggestions is
  'Prompt 359 Block D — AI-proposed roadmap events, one-click add/ignore. unique(org_id, signature) makes "dismissed never resuggested" a DB invariant.';
