-- Prompt 168 §A — per-bullet clarifications on a Review run. A founder can
-- respond to any single bullet (any of the 6 categories) with a short note
-- — "still valid, but here's the context" — without editing the AI's own
-- output. item_text is a verbatim COPY of the bullet at clarification time
-- (not a live join to review_runs.report), so it stays stable even if a
-- later run reorders or rewrites that category — both for the founder's own
-- reading and as grounding context fed back to the AI on future runs
-- (§E, /api/review/investability).
--
-- RLS: "mesma politica org-scoped de company_facts" (Nuno's own spec,
-- confirmed against 0020_company_canon.sql) — full CRUD for any org member,
-- not read-only-plus-service-role like review_runs itself. Writes go
-- directly through the browser client (ClarificationBullet.tsx), no custom
-- API route, same pattern as company_facts everywhere else in this
-- codebase. The investor-facing read (portal/startup/[orgId]/route.ts) is a
-- DIFFERENT user with no org membership here, so that route reads through
-- the service role instead, same as review_runs.
--
-- PROPOSTA, NAO APLICADA — esta sessao nao aplica as proprias migracoes
-- (same discipline as 0158/0159).
create table public.review_clarifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  review_run_id uuid not null references public.review_runs(id) on delete cascade,
  category text not null check (category in ('strengths','weaknesses','opportunities','threats','risks','recommendations')),
  item_index int not null,
  item_text text not null,
  clarification_text text not null,
  visible_to_investors boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_run_id, category, item_index)
);
create index review_clarifications_org_idx on public.review_clarifications (org_id, created_at);

alter table public.review_clarifications enable row level security;
create policy review_clarifications_all on public.review_clarifications for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));
