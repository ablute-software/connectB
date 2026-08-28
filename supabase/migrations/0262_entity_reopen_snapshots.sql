-- Prompt 416 §A — a baseline for "what changed since we passed/parked
-- this investor". The "+ Set reopen trigger" box (Vega Ventures, passed 8
-- years ago) reads like Sherlock's own answer to "why reopen", but it's
-- just the founder's free text — this table is the real baseline a future
-- engine (src/lib/reopen-signals.ts, same prompt) compares the investor's
-- CURRENT state against. One row per transition, never upserted: a
-- re-pass after reopening gets its own fresh row, so the drift comparison
-- always measures from the MOST RECENT pass/park, not the first ever.
--
-- Capture point is the store's own setEntityStatus (store-demo.tsx /
-- store-supabase.tsx), not a UI call site — see this prompt's own §A.2 for
-- why. Entities already passed/parked before this migration have no row
-- here; the engine treats that as "no baseline", never "nothing changed"
-- (§A.3 — no invented history).
create table public.entity_reopen_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  captured_at timestamptz not null default now(),
  reason text not null check (reason in ('passed', 'dormant')),
  -- What catalog_entities had for this investor AT THIS MOMENT, resolved
  -- via catalog_deliveries (exact) or a fuzzy domain/name match
  -- (entity-catalog-prefill.ts's matchEntityToCatalog — same fallback it
  -- already uses) when no delivery record exists. Falls back to the org's
  -- own entities.sectors/stage_min/stage_max when neither resolves (e.g. a
  -- manual entity with no catalog counterpart at all) so the row still
  -- records SOMETHING rather than being skipped — catalogDriftSince only
  -- ever fires when a LIVE catalog counterpart also exists today, so a
  -- manual entity's drift check is naturally a no-op either way.
  sectors_at_time text[] not null default '{}',
  stage_min_at_time stage,
  stage_max_at_time stage,
  -- Whether ANY investor_entity_claims row for the matched catalog entity
  -- was approved by this moment — see catalog_entity_claimed_at() below
  -- for why this can't just be a raw client-side read of that table.
  investor_claimed_at_time boolean not null default false,
  -- Count of investor_investments rows for the matched catalog entity at
  -- this moment (that table's read policy is open to any authenticated
  -- user — migration 0201 — so this one IS a plain client-side count).
  investment_count_at_time int not null default 0
);

create index entity_reopen_snapshots_entity_idx on public.entity_reopen_snapshots (entity_id, captured_at desc);

alter table public.entity_reopen_snapshots enable row level security;
-- Same generic org-scoped policy every founder-only CRM table uses
-- (0001_init.sql's own policy loop) — this is the founder's own pipeline
-- history, not investor-visible, so the root privacy rule's concern
-- (founder-private data reaching an investor surface) doesn't apply to
-- WHO can read it, only to where the engine that reads it is ever allowed
-- to output to (enforced in reopen-signals.ts's own callers, not here).
create policy entity_reopen_snapshots_all on public.entity_reopen_snapshots for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- investor_entity_claims (migration 0145) is RLS'd to the claimant only
-- (claimant_user_id = auth.uid()) — deliberately, since a claim carries an
-- evidence jsonb blob and an email that are nobody else's business. A
-- founder deciding whether an investor's profile is "claimed" has a
-- legitimate need for the ANSWER (a timestamp) without any of that detail,
-- the same shape is_org_member()/is_platform_admin() already use
-- everywhere else in this schema for "safe derived fact, not the rows
-- behind it". Returns the EARLIEST approval (the moment the profile FIRST
-- became claimed), or null if never approved for this catalog entity —
-- never the claimant's identity.
create or replace function public.catalog_entity_claimed_at(p_catalog_entity_id uuid)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(resolved_at) from investor_entity_claims
  where catalog_entity_id = p_catalog_entity_id and status = 'approved';
$$;
grant execute on function public.catalog_entity_claimed_at(uuid) to authenticated;
