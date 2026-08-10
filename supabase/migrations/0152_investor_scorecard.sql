-- Prompt 142 Bloco 1 — configurable investor scorecard. PROPOSTA, NAO
-- APLICADA — esta sessao nao aplica as proprias migracoes.
--
-- Per matchdeal_investor_members.id (per SEAT, not per org) — the doc's
-- own default when unconfirmed ("por omissao, nao partilhar"). A colleague
-- at the same fund gets their own independent set of criteria/scores; this
-- is deliberately subjective judgment, not a shared team artifact.
--
-- Two tables, matching the doc exactly:
--   investor_scorecard_criteria — the criteria an investor defines for
--     themselves (label/weight/order). `weight` has no fixed scale (a
--     relative int the investor assigns per-criterion) — it exists so the
--     UI can show a weighted total, not just so it can sit unused.
--   investor_scorecard_scores — one score per (criteria, startup). 0-10
--     scale, chosen since nothing else in this app scores 0-100 for a
--     human-entered subjective judgment (matchScore, the objective engine
--     score, is explicitly out of scope per the doc's own "fora de
--     ambito" — this table never feeds it, and this scale keeps that
--     visually obvious too).
--
-- RLS scopes both tables to the OWNING investor's own auth.uid() via
-- matchdeal_investor_members.user_id — never another seat at the same
-- fund, matching the doc's point 4. The app itself reads/writes these
-- through service-role API routes (the established investor-portal
-- pattern — see /api/portal/interest-level, /api/portal/pipeline), so RLS
-- here is defense in depth, same posture as every other table in this
-- schema, not the primary enforcement path.

create table public.investor_scorecard_criteria (
  id uuid primary key default gen_random_uuid(),
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  label text not null,
  weight int not null default 1 check (weight >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index investor_scorecard_criteria_member_idx on public.investor_scorecard_criteria (investor_member_id, sort_order);

create table public.investor_scorecard_scores (
  id uuid primary key default gen_random_uuid(),
  criteria_id uuid not null references public.investor_scorecard_criteria(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  score int not null check (score between 0 and 10),
  note text,
  updated_at timestamptz not null default now(),
  unique (criteria_id, startup_org_id)
);
create index investor_scorecard_scores_org_idx on public.investor_scorecard_scores (startup_org_id);

alter table public.investor_scorecard_criteria enable row level security;
alter table public.investor_scorecard_scores enable row level security;

create policy investor_scorecard_criteria_owner on public.investor_scorecard_criteria for all
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()))
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));

create policy investor_scorecard_scores_owner on public.investor_scorecard_scores for all
  using (exists (
    select 1 from public.investor_scorecard_criteria c
    join public.matchdeal_investor_members m on m.id = c.investor_member_id
    where c.id = investor_scorecard_scores.criteria_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.investor_scorecard_criteria c
    join public.matchdeal_investor_members m on m.id = c.investor_member_id
    where c.id = investor_scorecard_scores.criteria_id and m.user_id = auth.uid()
  ));
