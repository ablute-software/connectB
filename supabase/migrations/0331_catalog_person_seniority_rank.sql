-- Prompt 583 §C — seniority_rank was null in 3,177/3,177 rows: the
-- campaign researched a firm's Office Manager and Executive Assistant in
-- the same pass as its Founding Partner, at the same €0.30+ cost each.
-- Deterministic (no AI) title -> rank mapping, documented in code per the
-- prompt's own requirement. Ordering inside the CASE matters: more
-- specific exceptions are checked before the general pattern they'd
-- otherwise be swallowed by (e.g. "Venture Partner" before the bare
-- "Partner" check, "General Partner" before "General Counsel" could ever
-- be confused with it via a loose "general" match — it isn't, since the
-- pattern requires "general partner" as a phrase).
create or replace function public.catalog_seniority_rank_from_title(p_title text)
returns int
language sql
immutable
set search_path = public
as $$
  select case
    when p_title is null or btrim(p_title) = '' then null
    -- 1 — the firm's own top decision-makers.
    when p_title ~* '(founding|managing|general)\s+partner' then 1
    -- 3 — "Venture Partner" is a senior-advisor title, not a full partner;
    -- checked before the bare "partner" pattern below on purpose.
    when p_title ~* 'venture partner' then 3
    -- 2 — Partner, Principal, Investment Director.
    when p_title ~* 'partner|principal|investment director' then 2
    -- 3 — Investment Manager, Associate.
    when p_title ~* 'investment manager|associate' then 3
    -- 4 — Analyst.
    when p_title ~* '\yanalyst\y' then 4
    -- 9 — never worth a €0.30 hook-research call: CFO, COO, Legal/
    -- Compliance, IT, Marketing, Platform, Office/Assistant, Board/
    -- Supervisory, Advisor.
    when p_title ~* 'cfo|coo|chief\s+(financial|operating)|legal|compliance|general counsel|\yit\y|information technology|marketing|platform|office manager|executive assistant|\yassistant\y|board|supervisory|\yadvisor\y' then 9
    -- Unmapped — e.g. "Product Lead" (real title seen in production,
    -- 06/09/2026). Left null rather than guessed; surfaced in the
    -- migration's own report below and every future write via the trigger.
    else null
  end;
$$;

-- Applies to every future write too, not just this backfill: the worker's
-- own catalog_person_affiliations upsert has never set seniority_rank
-- (confirmed by reading it), so without this trigger every NEW person
-- would land back at null the day after this migration runs. A trigger
-- keeps title and seniority_rank from ever drifting apart without adding
-- a second place (worker TypeScript) that has to reimplement the same
-- mapping and can silently disagree with it.
create or replace function public.catalog_person_affiliations_set_seniority_rank()
returns trigger
language plpgsql
as $$
begin
  new.seniority_rank := public.catalog_seniority_rank_from_title(new.title);
  return new;
end;
$$;

drop trigger if exists trg_catalog_person_affiliations_seniority_rank on public.catalog_person_affiliations;
create trigger trg_catalog_person_affiliations_seniority_rank
  before insert or update of title on public.catalog_person_affiliations
  for each row execute function public.catalog_person_affiliations_set_seniority_rank();

update public.catalog_person_affiliations
  set seniority_rank = public.catalog_seniority_rank_from_title(title)
  where seniority_rank is null;
