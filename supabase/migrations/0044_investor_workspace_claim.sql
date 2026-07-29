-- Investor Workspace, Phase -1 (Registry Foundation) + Phase 0 (Identity,
-- Claim & Gate) — prompt 36. PROPOSAL ONLY, not applied (migration-apply is
-- blocked in this environment's auto-mode classifier — a DDL change against
-- a live multi-tenant DB correctly requires an interactive approval this
-- session can't grant itself). Nuno: review this, then apply by hand
-- (Supabase SQL editor or `supabase db push`) before any UI/API code below
-- it gets built — building against a table shape that hasn't been confirmed
-- live would be unverifiable, throwaway work.
--
-- Simplifications made deliberately, flagged per prompt 36's own request
-- ("decide o mínimo necessário, diz-me o que simplificaste e porquê"):
--
-- 1. NO Legal org / Brand / Management company / Fund-vehicle / Office /
--    User hierarchy yet. catalog_entities stays the single claimable unit,
--    exactly as it is today (531 rows, already the Investor Entity
--    Registry per prompt 36 §0). A firm with multiple funds claims the one
--    catalog_entities row that represents it; splitting fund-vehicles out
--    is real work with no Phase-0 use case yet (nothing here needs to
--    distinguish "GP entity" from "Fund III vehicle" to gate D0/D1).
-- 2. entity claim_state simplified to 4 of the source doc's 6 states —
--    dropped 'suspended' and 'merged'. Both are back-office entity-lifecycle
--    actions with no Phase 0 trigger (nothing suspends or merges a catalog
--    row yet); adding the column values now costs nothing, but the states
--    are meaningless until back-office tooling for them exists, so keeping
--    the check constraint tight now and widening it later is cheaper than
--    guessing at unused states today.
-- 3. NIPC/company-registry matching is NOT implemented — catalog_entities
--    has no registry-id column and no source data to populate one. Phase 0
--    claim search matches on name (ilike) and website domain only. Flagged
--    explicitly since prompt 36 §2.1 asked for "nome, domínio, ou NIPC" —
--    NIPC search is a stub that always returns no match until that data
--    exists; documented, not silently dropped.
-- 4. V2/V3 (delegated admin, SCAP organisation-admin) are out of scope per
--    the prompt's own instruction — verification_level is constrained to
--    V0/V1 only; the column allows widening later without a shape change.
-- 5. Anti-abuse (watermarking, disclosure log) is NOT included here — the
--    prompt's own §2.7 says N/A until real sensitive content (Scout Briefs)
--    exists, which it doesn't yet in this repo. Rate limiting on the
--    search/claim endpoints is an application-layer concern (Vercel/edge),
--    not schema, and is left as an implementation note for whoever builds
--    the API routes once this schema is confirmed.

-- ===== Phase -1: Registry Foundation =====

alter table catalog_entities add column claim_state text not null default 'imported_unclaimed'
  check (claim_state in ('imported_unclaimed', 'claim_pending', 'claimed_verified', 'disputed'));
create index on catalog_entities (claim_state);

-- ===== Phase 0: Identity, Claim & Gate =====

-- One row per investor-side user (distinct from orgs/org_members, which are
-- founder-side). Created on first successful personal-account signup via the
-- investor flow, before any claim exists (V0 / D0 — "conta pessoal, sem
-- claim ainda" is a valid, common state, not an edge case).
create table investor_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  verification_level text not null default 'V0' check (verification_level in ('V0', 'V1')),
  claimed_entity_id uuid references catalog_entities(id) on delete set null,
  plan text check (plan in ('boy_scout', 'pro_spotter', 'ace_sleuth')),
  trial_ends_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);
alter table investor_accounts enable row level security;
create policy investor_accounts_own on investor_accounts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The claim itself — one row per attempt, not per investor_accounts row, so
-- a rejected/needs-evidence claim doesn't destroy the audit trail and a
-- user can retry. `catalog_entity_id` null means "propose a new entity"
-- (§2.4's exception path); `proposed_name`/`proposed_evidence_url` are only
-- meaningful in that case.
create table entity_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_entity_id uuid references catalog_entities(id) on delete cascade,
  proposed_name text,
  proposed_evidence_url text,
  email text not null,
  email_domain text not null,
  verification_level text not null check (verification_level in ('V0', 'V1')),
  -- §2.3 cross-check: same email/domain already resolves as a founder
  -- (org_members) — forces manual review regardless of domain match.
  cross_check_conflict boolean not null default false,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected', 'needs_evidence')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz not null default now()
);
create index on entity_claims (status, created_at);
create index on entity_claims (user_id);

alter table entity_claims enable row level security;
create policy entity_claims_own_read on entity_claims for select using (user_id = auth.uid());
create policy entity_claims_own_insert on entity_claims for insert with check (user_id = auth.uid());
-- No update/delete policy for the claimant — only the review console
-- (service-role, same requirePlatformAdmin() pattern as every other
-- back-office mutation in this repo) can move status/reviewed_*.

create index on entity_claims (catalog_entity_id) where catalog_entity_id is not null;

-- Same audit pattern as everything else in this repo (admin_audit_log via
-- logAdminAction) — no new logging mechanism needed for claim
-- approve/reject, it already exists and is reused, not duplicated here.
