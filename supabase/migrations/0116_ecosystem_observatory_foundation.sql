-- Prompt 122 Block B (F1) — PROPOSED, NOT APPLIED.
-- The Ecosystem Observatory's data foundation: layer 3 of the 4-layer
-- architecture (raw documents -> structured findings -> aggregates -> data
-- products). This migration is layer 3 only — no free text ever lands here,
-- only numbers and closed categories, and every read is behind a K=8 +
-- dominance>50% anonymity rule enforced inside observatory_query() itself
-- (not left to the caller to remember). Nothing here touches access_grants
-- or the matching engine; every instrumentation call site (see
-- ecosystem-facts.ts) is a read of an event that already happened,
-- best-effort and gated behind ecosystemFactsAvailable() so this entire
-- migration can sit unapplied with zero behavior change anywhere.
--
-- Initial metric_key catalog (methodology_version 1 for all):
--   review_score        — value_numeric = ai_reviews structured report's
--                          0-100 score. source='ai_review'.
--   weakness_prevalence — one row per weakness finding; value_category =
--                          company_facts category (product/traction/team/
--                          positioning/financing/regulatory/market/metrics/
--                          other), value_numeric = severity mapped
--                          low=1/medium=2/high=3. source='ai_review'.
--   risk_prevalence     — same shape as weakness_prevalence, for risks
--                          (and cross_document_review's contradictions,
--                          which carry the same category+severity shape).
--                          source='ai_review'.
--   investor_decision    — value_category = 'interest'|'pass', one row per
--                          decide_investor_relationship() call.
--                          source='funnel'.
--   grant_created        — value_numeric = 1, one row per access_grants
--                          insert. Read-only observation; zero changes to
--                          grant logic. source='funnel'.
--
-- methodology_version increments whenever a metric's DEFINITION changes
-- (e.g. severity re-mapped, score renormalized) — never for a bug fix to
-- how it's captured. Existing rows keep their original version so a
-- snapshot recomputed under a new definition is never silently blended
-- with rows computed under the old one.

create table if not exists public.ecosystem_facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  metric_key text not null,
  value_numeric numeric,
  value_category text,
  source text not null check (source = any (array['ai_review', 'profile', 'funnel', 'document_census'])),
  source_id uuid,
  methodology_version int not null default 1,
  captured_at timestamptz not null default now()
);
create index if not exists ecosystem_facts_metric_captured_idx on public.ecosystem_facts (metric_key, captured_at);
create index if not exists ecosystem_facts_org_metric_idx on public.ecosystem_facts (org_id, metric_key);

alter table public.ecosystem_facts enable row level security;
-- Read: developer only (same is_ablute_developer() check every other
-- developer-only surface uses). Write: NO policy for any authenticated
-- role at all — every insert happens through the service-role client in
-- ecosystem-facts.ts, which bypasses RLS entirely, matching "escrita só
-- service role" literally rather than writing a permissive-looking INSERT
-- policy that's just never exercised by app code.
create policy ecosystem_facts_developer_select on public.ecosystem_facts
  for select using (public.is_ablute_developer());

create table if not exists public.ecosystem_snapshots (
  id uuid primary key default gen_random_uuid(),
  period date not null,
  segment jsonb not null,
  metric_key text not null,
  n int not null,
  p25 numeric,
  p50 numeric,
  p75 numeric,
  share numeric,
  methodology_version int not null,
  unique (period, segment, metric_key)
);
alter table public.ecosystem_snapshots enable row level security;
create policy ecosystem_snapshots_developer_select on public.ecosystem_snapshots
  for select using (public.is_ablute_developer());

-- observatory_query — live aggregation, developer-only, K-anonymous.
-- SECURITY DEFINER because ecosystem_facts' own RLS would otherwise apply
-- to the CALLER's role for every row scanned inside this function too
-- (Postgres RLS is enforced per-query regardless of who defined the
-- function unless SECURITY DEFINER + a fixed search_path is used) — the
-- is_ablute_developer() check below is what actually gates this, not RLS,
-- since the function runs as its owner.
--
-- p_segment shape: {"country": "Portugal", "stage": "seed", "sectors": ["saas","health"]}
-- Any key omitted matches everything for that dimension.
create or replace function public.observatory_query(p_segment jsonb, p_metric text)
returns table (n int, p25 numeric, p50 numeric, p75 numeric, share numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- K-anonymity + dominance thresholds — hard-coded per the spec, intended
  -- to be revisited (not tuned per-call) once real segment volume exists.
  k_threshold constant int := 8;
  dominance_threshold constant numeric := 0.5;
  v_n int;
  v_distinct_orgs int;
  v_max_share numeric;
begin
  if not public.is_ablute_developer() then
    return; -- no row at all — never reveal whether a segment even exists to a non-developer
  end if;

  with segment_orgs as (
    select o.id
    from public.orgs o
    where (p_segment->>'country' is null or o.country = p_segment->>'country')
      and (p_segment->>'stage' is null or o.stage::text = p_segment->>'stage')
      and (
        p_segment->'sectors' is null
        or o.sectors && (select array_agg(x) from jsonb_array_elements_text(p_segment->'sectors') x)
      )
  ),
  segment_facts as (
    select f.org_id, f.value_numeric
    from public.ecosystem_facts f
    join segment_orgs so on so.id = f.org_id
    where f.metric_key = p_metric and f.value_numeric is not null
  ),
  org_counts as (
    select org_id, count(*) as cnt from segment_facts group by org_id
  )
  select
    count(*),
    count(distinct org_id),
    case when count(*) > 0 then (select max(cnt) from org_counts)::numeric / count(*) else 0 end
  into v_n, v_distinct_orgs, v_max_share
  from segment_facts;

  -- Anonymity gate: too few distinct orgs, or one org dominates the rows.
  -- With today's real data this is expected to fire on almost every
  -- segment — that's the correct, honest behavior, not a bug to work around.
  if v_n = 0 or v_distinct_orgs < k_threshold or v_max_share > dominance_threshold then
    return;
  end if;

  return query
  select
    v_n,
    percentile_cont(0.25) within group (order by sf.value_numeric),
    percentile_cont(0.5) within group (order by sf.value_numeric),
    percentile_cont(0.75) within group (order by sf.value_numeric),
    v_max_share
  from (
    select f.value_numeric
    from public.ecosystem_facts f
    join segment_orgs so on so.id = f.org_id
    where f.metric_key = p_metric and f.value_numeric is not null
  ) sf;
end;
$$;

-- observatory_snapshot — idempotent recompute for one period. Manual call
-- only for now (no cron — Hobby-plan crons are daily-max and this doesn't
-- need scheduling yet per the prompt's own instruction not to add one).
-- Segmentation kept intentionally simple for v1 (country x stage pairs
-- that actually have data) — expand to sector-level cuts once real volume
-- justifies the combinatorial growth; this is the "next free" shape to
-- extend, not a final design.
create or replace function public.observatory_snapshot(p_period date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k_threshold constant int := 8;
  dominance_threshold constant numeric := 0.5;
  r record;
begin
  if not public.is_ablute_developer() then
    raise exception 'developer only';
  end if;

  for r in
    select distinct o.country, o.stage::text as stage, f.metric_key
    from public.ecosystem_facts f
    join public.orgs o on o.id = f.org_id
    where f.value_numeric is not null
  loop
    with segment_facts as (
      select f.org_id, f.value_numeric
      from public.ecosystem_facts f
      join public.orgs o on o.id = f.org_id
      where f.metric_key = r.metric_key
        and f.value_numeric is not null
        and o.country is not distinct from r.country
        and o.stage::text is not distinct from r.stage
    ),
    org_counts as (
      select org_id, count(*) as cnt from segment_facts group by org_id
    ),
    stats as (
      select
        count(*) as n,
        count(distinct org_id) as distinct_orgs,
        case when count(*) > 0 then (select max(cnt) from org_counts)::numeric / count(*) else 0 end as max_share,
        percentile_cont(0.25) within group (order by value_numeric) as p25,
        percentile_cont(0.5) within group (order by value_numeric) as p50,
        percentile_cont(0.75) within group (order by value_numeric) as p75
      from segment_facts
    )
    insert into public.ecosystem_snapshots (period, segment, metric_key, n, p25, p50, p75, share, methodology_version)
    select
      p_period,
      jsonb_build_object('country', r.country, 'stage', r.stage),
      r.metric_key,
      s.n,
      case when s.distinct_orgs >= k_threshold and s.max_share <= dominance_threshold then s.p25 else null end,
      case when s.distinct_orgs >= k_threshold and s.max_share <= dominance_threshold then s.p50 else null end,
      case when s.distinct_orgs >= k_threshold and s.max_share <= dominance_threshold then s.p75 else null end,
      s.max_share,
      1
    from stats s
    on conflict (period, segment, metric_key) do update set
      n = excluded.n, p25 = excluded.p25, p50 = excluded.p50, p75 = excluded.p75,
      share = excluded.share, methodology_version = excluded.methodology_version;
  end loop;
end;
$$;
