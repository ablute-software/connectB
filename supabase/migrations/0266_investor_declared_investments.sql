-- Prompt 421 §C — an investor's self-declared history of past investments.
-- Framed to the investor as value exchange ("helps Sherlock match you with
-- better-fit startups, gives founders more confidence in your profile"),
-- never mandatory. Scoped to the FIRM (catalog_entity_id), not the
-- individual person typing it in: a real investment is made by the firm,
-- and this is meant to feed reopen-signals.ts's newInvestmentsSince the
-- same way investor_investments (migration 0201, market-researched) does —
-- that engine keys investments by the investor's catalog id, so a
-- per-member-only table would silently split one firm's declared history
-- across however many colleagues happen to be signed up. RLS is "any
-- active member of this firm", not "only the row's own creator" — the
-- prompt's own "own-only" is read as "own FIRM, never another firm's",
-- matching every other firm-shared row in this schema (matchdeal_profiles
-- itself works the same way).
create table public.investor_declared_investments (
  id uuid primary key default gen_random_uuid(),
  catalog_entity_id uuid not null references public.catalog_entities(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  company_name text not null,
  sector text,
  invested_at date,
  round_type text,
  amount_eur bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index investor_declared_investments_catalog_idx on public.investor_declared_investments (catalog_entity_id);

alter table public.investor_declared_investments enable row level security;
create policy investor_declared_investments_own_firm on public.investor_declared_investments for all
  using (catalog_entity_id in (
    select catalog_entity_id from public.matchdeal_investor_members where user_id = auth.uid() and status = 'active'
  ))
  with check (catalog_entity_id in (
    select catalog_entity_id from public.matchdeal_investor_members where user_id = auth.uid() and status = 'active'
  ));
