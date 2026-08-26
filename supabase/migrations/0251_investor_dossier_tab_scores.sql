-- Prompt 388 §C.2 — "cada um (About SWOT Roadmap Clarifications Round Market
-- Team) tem a sua avaliação" (Nuno's own words, verbatim): the SAME
-- criteria an investor already defines in investor_scorecard_criteria get a
-- SEPARATE, independent score per dossier tab — scoring "Technology" a 5
-- while reading SWOT never pre-fills Roadmap's own copy of "Technology",
-- which starts unscored (never 0) there. unique(criteria_id, tab,
-- startup_org_id) is what makes "independent per tab" a DB invariant, same
-- discipline as investor_scorecard_scores' own unique(criteria_id,
-- startup_org_id) before it. score is nullable-by-omission (a row simply
-- doesn't exist until the investor rates that criterion on that tab) —
-- "por avaliar" is the absence of a row, never a stored 0.
--
-- RLS mirrors investor_scorecard_scores exactly: owner = whoever created
-- the criterion, via investor_scorecard_criteria -> matchdeal_investor_members
-- -> auth.uid(). Same defense-in-depth posture as that table (the app reads/
-- writes through service-role API routes; RLS here is the second layer,
-- not the primary enforcement path).
create table public.investor_dossier_tab_scores (
  id uuid primary key default gen_random_uuid(),
  criteria_id uuid not null references public.investor_scorecard_criteria(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  tab text not null check (tab in ('about', 'swot', 'roadmap', 'clarifications', 'round', 'market', 'team')),
  score smallint check (score between 0 and 10),
  note text,
  updated_at timestamptz not null default now(),
  unique (criteria_id, tab, startup_org_id)
);
create index investor_dossier_tab_scores_org_idx on public.investor_dossier_tab_scores (startup_org_id);
create index investor_dossier_tab_scores_criteria_idx on public.investor_dossier_tab_scores (criteria_id);

alter table public.investor_dossier_tab_scores enable row level security;

create policy investor_dossier_tab_scores_owner on public.investor_dossier_tab_scores for all
  using (exists (
    select 1 from public.investor_scorecard_criteria c
    join public.matchdeal_investor_members m on m.id = c.investor_member_id
    where c.id = investor_dossier_tab_scores.criteria_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.investor_scorecard_criteria c
    join public.matchdeal_investor_members m on m.id = c.investor_member_id
    where c.id = investor_dossier_tab_scores.criteria_id and m.user_id = auth.uid()
  ));

comment on table public.investor_dossier_tab_scores is
  'Prompt 388 §C.2 — per-(criteria, dossier tab, startup) investor-private score. Independent per tab by design; unrated is the absence of a row, never a stored 0.';
