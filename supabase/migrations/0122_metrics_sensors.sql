-- Prompt 124 §4/§5 — the instrumentation sensors (C1-C4; C5 is already
-- covered, see note below). PROPOSE ONLY — not applied.

-- D10 — one generic events table (event_type + meta jsonb) rather than a
-- table per event, per the prompt's own default: this pattern comfortably
-- carries the next ten events without ten migrations. Alternative
-- (dedicated tables per event) rejected for maintenance cost, per the
-- prompt's own §5.
create table if not exists public.app_events (
  id uuid primary key default uuid_generate_v4(),
  event_type text not null,
  org_id uuid references public.orgs(id) on delete cascade,
  user_id uuid references auth.users(id),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists app_events_type_ts_idx on public.app_events (event_type, created_at);
create index if not exists app_events_org_ts_idx on public.app_events (org_id, created_at);

alter table public.app_events enable row level security;
create policy app_events_developer_read on public.app_events
  for select using (public.is_ablute_developer());
-- Writes go through service-role API routes only (page-view/document-view
-- endpoints below) — no insert policy needed for any authenticated role.

-- C1 — acquisition_source at signup (field + UTM). Written once, at
-- provision-org time, behind a capability probe — never retroactively for
-- orgs that predate this column (they stay null, honestly "unknown", not
-- backfilled with a guess).
--
-- Root-cause note: the dashboard's Growth & Revenue tab (acquisitionBreakdown,
-- backoffice-metrics.ts) doesn't read this column at all — it reads
-- analytics_events.acquisition_source, populated by the ALREADY-LIVE
-- orgs_registered_event trigger (migration 0072's log_org_registered()),
-- which has never set that field (hence every org showing "Unknown"). This
-- migration also extends that trigger to copy new.acquisition_source
-- through, so a value captured on the SAME orgs insert that fires it
-- reaches analytics_events in the same transaction — no second write path.
alter table public.orgs
  add column if not exists acquisition_source text,
  add column if not exists acquisition_source_detail text;

create or replace function public.log_org_registered() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into analytics_events (
    organization_id, organization_type, plan_at_event_time, country_at_event_time, sector_at_event_time,
    event_type, acquisition_source
  ) values (
    new.id, 'startup', new.plan, new.country, new.sector, 'org_registered', new.acquisition_source
  );
  return new;
end; $$;

-- C4 — MET-06's 7 investor-source categories (SherlockDeal_Metricas_
-- BackOffice_V1 §9.4: Sherlock curated pipeline, MatchDeal, match
-- conquistado, adicionado manualmente, bulk import, contacto já conhecido
-- pela startup, convite do investidor à startup). Today's check constraint
-- (migration 0042) only allows 3 values. This expands to 6:
--   'catalog'         = Sherlock curated pipeline (unchanged)
--   'match_deal'      = match conquistado — a real mutual match (unchanged,
--                       already the "hotter provenance" signal per Prompt 73)
--   'manual'          = adicionado manualmente (unchanged)
--   'bulk_import'     = bulk import (NEW)
--   'known_contact'   = contacto já conhecido pela startup (NEW)
--   'investor_invite' = convite do investidor à startup (NEW)
-- FLAGGED, not resolved: the spec's 7th category, "MatchDeal" as a value
-- DISTINCT from "match conquistado", isn't added here — no code path was
-- found where an entity gets created from MatchDeal exposure without
-- also being a confirmed mutual match (P73: entities are only created on
-- match, never on a bare swipe), so it's unclear what a 7th, separate
-- "MatchDeal" value would represent that 'match_deal' doesn't already
-- capture. Needs Nuno's read before inventing a slug for it.
alter table public.entities drop constraint if exists entities_source_check;
alter table public.entities add constraint entities_source_check
  check (source in ('catalog', 'manual', 'match_deal', 'bulk_import', 'known_contact', 'investor_invite'));

-- Capability probe for the constraint expansion above — a plain column
-- select can't see check-constraint values, and a live insert+rollback
-- probe would need a real org_id (FK) to even attempt, which is worse than
-- this: read-only introspection of the constraint's own definition text.
create or replace function public.entities_source_expanded() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pg_constraint
    where conname = 'entities_source_check' and pg_get_constraintdef(oid) like '%bulk_import%'
  );
$$;
grant execute on function public.entities_source_expanded() to authenticated;

-- C5 note (no schema change here): stage-transition history is NOT a gap —
-- migration 0072's log_entity_status_change() trigger already writes a
-- 'pipeline_stage_reached' analytics_events row on every entities.status
-- update, live since 2026-07-30 (HistoricalDataNotice.tsx), and a DB
-- trigger can't be bypassed by a forgotten call site the way an app-level
-- log call could. The dashboard's own "current stage only" caveat is about
-- history BEFORE that date, which cannot be recovered retroactively by
-- definition — not an instrumentation gap to fix, an honest disclosure to
-- keep. Duplicating this into app_events would fragment one indicator
-- across two tables, which Section 13.2's own rule argues against.
