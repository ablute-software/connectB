-- Prompt 347 — "Track & Evaluate" mode on the investor dossier.
--
-- investor_doc_scores mirrors investor_scorecard_scores' own shape and RLS
-- exactly (migration 0152): per SEAT (matchdeal_investor_members.id, not per
-- org — a colleague at the same fund scores independently), never visible to
-- the founder (root privacy rule: the mere existence of a rating is
-- observation about the founder, not just its value). No founder-facing
-- route ever queries this table.
create table public.investor_doc_scores (
  id uuid primary key default gen_random_uuid(),
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  score int not null check (score between 0 and 10),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (investor_member_id, document_id)
);
create index investor_doc_scores_org_idx on public.investor_doc_scores (startup_org_id);
create index investor_doc_scores_doc_idx on public.investor_doc_scores (document_id);

alter table public.investor_doc_scores enable row level security;

create policy investor_doc_scores_owner on public.investor_doc_scores for all
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()))
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));

-- Track & Evaluate mode's own remembered default — "a preference simples",
-- one boolean per investor seat, applied as the toggle's initial state on
-- every dossier visit (the investor can still flip it per visit; this just
-- avoids re-toggling every time for someone who always wants it on).
alter table public.matchdeal_investor_members
  add column if not exists track_evaluate_default boolean not null default false;
