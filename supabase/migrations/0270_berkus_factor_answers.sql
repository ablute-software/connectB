-- Prompt 428 §A — Berkus Method Simplified/Detailed: per-factor investor
-- judgment, same ownership/RLS pattern as bars_answers (0260) — owner
-- select/insert/update, current-state (not append-only; history lives in
-- evaluation_snapshots, same as it already does for Berkus today).
--
-- factor uses Berkus' own vocabulary (sound_idea/prototype/team/
-- relationships/sales — the stable internal keys the app already uses,
-- see investor_berkus_estimates' *_eur columns), not BARS' axis names —
-- the two only partially overlap (Team factor <-> team axis; Sound Idea
-- factor <-> market+product axes; Prototype factor <-> technology axis;
-- Relationships/Sales have no BARS axis at all).
--
-- level allows 0 (unlike bars_answers' 1-5): Berkus' own reference docs
-- treat "Level 0 — no demonstrated risk reduction" as an optional, real,
-- selectable answer (=EUR 0), distinct from null (not yet answered) or
-- skipped=true (explicit "not enough evidence to judge"). Same
-- null+skipped=false / skipped=true / real-level trichotomy bars_answers
-- already uses, just with 0 added to the selectable range.
create table public.berkus_factor_answers (
  id uuid primary key default gen_random_uuid(),
  investor_member_id uuid not null references public.matchdeal_investor_members(id) on delete cascade,
  startup_org_id uuid not null references public.orgs(id) on delete cascade,
  factor text not null check (factor in ('sound_idea', 'prototype', 'team', 'relationships', 'sales')),
  level int check (level between 0 and 5),
  skipped boolean not null default false,
  -- Same {kind, id?, text?}[] shape bars_answers.evidence_refs already uses
  -- (src/lib/bars-types.ts EvidenceKind) — one shared vocabulary, not a
  -- parallel one.
  evidence_refs jsonb not null default '[]',
  note text,
  updated_at timestamptz not null default now(),
  unique (investor_member_id, startup_org_id, factor)
);
create index berkus_factor_answers_member_idx on public.berkus_factor_answers (investor_member_id);

alter table public.berkus_factor_answers enable row level security;
create policy berkus_factor_answers_owner_select on public.berkus_factor_answers for select
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy berkus_factor_answers_owner_insert on public.berkus_factor_answers for insert
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));
create policy berkus_factor_answers_owner_update on public.berkus_factor_answers for update
  using (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()))
  with check (investor_member_id in (select id from public.matchdeal_investor_members where user_id = auth.uid()));

-- Prompt 428 §C — calibration lives alongside the existing per-factor EUR
-- columns on investor_berkus_estimates (0158): this table is already "the
-- investor's current Berkus state for this startup," calibration is just
-- more of that same state. The five *_eur columns stop being hand-typed
-- (the old raw sliders) and become a CALCULATED cache — level x this
-- calibration's illustrative value for that level, under whichever mode
-- last saved — written on every POST purely so the existing Compare
-- enrichment (EvaluationToolsPanel.tsx's berkusTotal, reads these columns
-- directly) keeps working with zero changes of its own. Default matches
-- the Classic/Reference calibration both source documents use (EUR 500k
-- per factor, EUR 2.5M ceiling across all five).
alter table public.investor_berkus_estimates
  add column calibration_ref_eur int not null default 500000 check (calibration_ref_eur between 1 and 10000000),
  add column calibration_note text;
