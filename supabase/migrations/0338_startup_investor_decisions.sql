-- Prompt 852 §A — the OTHER direction of "no".
--
-- Until now the product modelled exactly one: the investor's. The pass form
-- asks "Why did they pass?", writes an `interactions` row with
-- classification='pass', sets the entity to 'passed', and that feeds
-- passReasonAlert ("3+ passes for the same reason — the pitch may be the
-- problem"), the reawakening prefilter and the Dashboard.
--
-- Nuno is adding the founder's own: "we met them before and they were not
-- aligned", "the treatment was poor". A different act, by a different party,
-- with different consequences — so a first-class record, NOT a new value
-- inside the existing one. The two must never be mixed: a founder's own
-- "not a fit for us" must not inflate the pass-pattern alert that exists to
-- tell the founder their PITCH is the problem, must not read anywhere as an
-- investor rejection, and must not appear as a prior "no" the reawakening
-- engine argues against.
--
-- Consequently this table is deliberately inert with respect to everything
-- else: recording a row here writes NO `interactions` row, does NOT touch
-- entities.status, and creates NO rejection_code. The only behaviour it has
-- is the one the Pipeline gives it (the row leaves the active list and is
-- reachable through the Passed view) and the back-office Insight tab.
--
-- Naming note, because the collision is real and confusing: the existing
-- EntityFrozenState value 'not_a_fit' (hard_filter_status =
-- 'resolved_not_a_fit', migration 0195) is the PLATFORM's hard filter
-- resolving a thesis mismatch, and its pill already reads "Not a fit".
-- This is a different thing, always labelled "Not a fit for us" — the
-- founder's own decision, with the founder's own words attached.
create table if not exists startup_investor_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  -- The founder's own pipeline row, which is what they act on.
  entity_id uuid not null references entities(id) on delete cascade,
  -- Nullable, resolved via catalog_deliveries at write time, so the
  -- back-office can group by the REAL firm even across orgs. Null when the
  -- entity was created by hand and never came from the catalog.
  catalog_entity_id uuid references catalog_entities(id) on delete set null,
  -- One value today. A column, not a boolean, because there will be others.
  decision text not null check (decision in ('not_a_fit')),
  -- The same vocabulary the other direction uses (PASS_REASON_CATEGORIES,
  -- relationship.ts), so the back-office can compare like with like.
  -- Optional: a founder is not required to categorise their own decision.
  reason_category text check (reason_category in (
    'valuation', 'check_size', 'geography', 'stage_too_early',
    'thesis_mismatch', 'team', 'traction', 'other'
  )),
  -- Required, and capped at the same 220 characters as the pass reason and
  -- the reopen note (§D) — one limit across all three, enforced here and not
  -- only in the form.
  note text not null check (char_length(note) <= 220 and char_length(btrim(note)) > 0),
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  -- The choice is reversible, because things change. Reverting never deletes
  -- anything: the row stays, struck through, so the history is honest.
  reverted_at timestamptz,
  reverted_by uuid references auth.users(id),
  -- The note is editable and we must know by whom.
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- One LIVE decision per investor per startup; reverting frees it, so the
-- founder can record a new one later without the old row being rewritten.
create unique index if not exists startup_investor_decisions_live_uniq
  on startup_investor_decisions (org_id, entity_id) where reverted_at is null;
create index if not exists startup_investor_decisions_org_idx on startup_investor_decisions (org_id);
create index if not exists startup_investor_decisions_entity_idx on startup_investor_decisions (entity_id);
create index if not exists startup_investor_decisions_catalog_idx on startup_investor_decisions (catalog_entity_id);
create index if not exists startup_investor_decisions_decided_at_idx on startup_investor_decisions (decided_at desc);

alter table startup_investor_decisions enable row level security;

-- Select for the org's own members — the founder must be able to read what
-- their team recorded. Every WRITE goes through /api/company/investor-decisions
-- with the service role, which is where the `investor_decisions` capability
-- (org-permissions.ts) is enforced: same posture as every other admin
-- mutation in this schema, and the reason there is no insert/update policy.
create policy startup_investor_decisions_org_member on startup_investor_decisions for select
  using (is_org_member(org_id));
create policy startup_investor_decisions_admin on startup_investor_decisions for select
  using (is_platform_admin());

comment on table startup_investor_decisions is
  'Prompt 852 §A — the startup''s own "not a fit for us" against an investor. Never an investor pass: excluded from passReasonAlert, from entities.status, and from rejection_codes by construction. Back-office only, never surfaced to any investor.';
