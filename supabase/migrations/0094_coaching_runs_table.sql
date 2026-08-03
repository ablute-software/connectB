-- Prompt 99 §4 — "Treinar" coaching Q&A session history. Same shape/RLS
-- pattern as review_runs: SELECT-only policies (org member or @ablute.pt
-- QA), no client-side INSERT policy — writes go through a service-role API
-- route, same as review_runs' insert pattern.
create table public.coaching_runs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  questions jsonb not null default '[]'::jsonb,
  answers jsonb not null default '[]'::jsonb,
  feedback jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.coaching_runs enable row level security;

create policy coaching_runs_select on public.coaching_runs
  for select using (is_org_member(org_id));

create policy coaching_runs_ablute_qa_read on public.coaching_runs
  for select using (is_ablute_developer());
