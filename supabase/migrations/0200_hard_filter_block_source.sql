-- Prompt 285 §3 — cross-org fraud aggregation. Platform-wide action now
-- requires 3+ independent orgs each with a *confirmed* entity_fraud_flags
-- row for the same catalog_id (see the written proposal in this prompt),
-- not a single admin's checkbox alone — that manual path
-- (fraud-flags/[id]/resolve/route.ts's suspendCatalogEntity) stays exactly
-- as it is, unchanged, a human veto available on one single report.
--
-- This column exists so HardFilterBanner can tell the two ways an entity
-- ends up hard_filter_status='resolved_blocked' apart: 'self_report' is
-- the existing, only path today (this org's own founder filed the
-- report — the banner's "Reported by you" text is true). 'platform_action'
-- is new: an org whose founder never reported anything, but whose
-- entities row got blocked because enough OTHER independent orgs
-- confirmed the same catalog entity. Without this column the banner would
-- keep saying "Reported by you" on a report that org never filed.
--
-- Nullable, no default: every pre-existing resolved_blocked row predates
-- this column and has no value — the application code treats a missing
-- value the same as 'self_report' (the only thing that could have set
-- resolved_blocked before this migration).
alter table public.entities
  add column if not exists hard_filter_block_source text
    check (hard_filter_block_source in ('self_report', 'platform_action'));
