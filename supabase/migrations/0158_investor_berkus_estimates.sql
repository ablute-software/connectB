-- Prompt 164 C — Berkus Method estimates. PROPOSTA, NAO APLICADA — esta
-- sessao nao aplica as proprias migracoes.
--
-- One row per (investor seat, startup org): the five classic Berkus risk
-- factors, each capped at €500,000 (European ceiling per the reference
-- doc's own instruction — not the classic US $500k). All five default 0 so
-- a partially-filled estimate is representable without nulls.
--
-- Same ownership model and RLS pattern as investor_scorecard_criteria
-- (0152): per SEAT (matchdeal_investor_members.id), never shared across a
-- fund's seats — this is deliberately the investor's own private judgment,
-- and the app reads/writes it through service-role API routes with their
-- own ownership checks (the established investor-portal pattern); RLS here
-- is defense in depth.
--
-- Deliberately NOT read by anything else: no feed into matchScore, no
-- startup-facing surface, no platform aggregate — the legal-side framing
-- ("private investor judgment, never an official platform valuation")
-- depends on this staying isolated, so any future reader needs its own
-- explicit sign-off, not a quiet join.

create table public.investor_berkus_estimates (
  id uuid primary key default gen_random_uuid(),
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  sound_idea_eur int not null default 0 check (sound_idea_eur between 0 and 500000),
  prototype_eur int not null default 0 check (prototype_eur between 0 and 500000),
  team_eur int not null default 0 check (team_eur between 0 and 500000),
  relationships_eur int not null default 0 check (relationships_eur between 0 and 500000),
  sales_eur int not null default 0 check (sales_eur between 0 and 500000),
  updated_at timestamptz not null default now(),
  unique (investor_member_id, startup_org_id)
);
create index investor_berkus_estimates_member_idx on public.investor_berkus_estimates (investor_member_id);

alter table public.investor_berkus_estimates enable row level security;

create policy investor_berkus_estimates_owner on public.investor_berkus_estimates for all
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()))
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
