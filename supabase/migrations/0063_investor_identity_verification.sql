-- Investor identity verification, Fase A (prompt 63). Three states, computed
-- at read time rather than stored redundantly, to avoid the sync-drift risk
-- of a stored "identity_status" column that could disagree with the data it
-- summarizes:
--   verified              = matchdeal_investor_members.domain_verified is true
--                            OR the linked catalog_entities row is
--                            verification_status='verified'
--   pending_verification  = linked to a catalog entity, neither of the above
--   self_declared_individual = matchdeal_profiles.self_declared_individual
-- This is computed in src/lib/investor-identity.ts, not persisted — the only
-- new persisted facts are below.

-- 1. domain_verified — per-membership fact, distinct from the catalog
-- entity's own verification_status: an investor's email domain matching the
-- firm's site is proof about THIS PERSON's affiliation, not about whether
-- the firm itself has been reviewed. Set true only when
-- checkInvestorDomainMatch()/isAutoEligible() passed at link time — reused
-- exactly as-is (Prompt 41), not reimplemented.
alter table matchdeal_investor_members
  add column if not exists domain_verified boolean not null default false;

-- 2. Business Angel self-declaration (Bloco 4). ack_version records which
-- placeholder legal text revision was shown/accepted, so a future swap to
-- real reviewed copy never misrepresents what an earlier investor actually
-- agreed to — re-prompt on version bump, don't silently reinterpret history.
alter table matchdeal_profiles
  add column if not exists self_declared_individual boolean not null default false,
  add column if not exists self_declared_at timestamptz,
  add column if not exists self_declared_ack_version text;

-- 3. Attribution for "my firm isn't listed" (Bloco 1) — who proposed a new
-- catalog_entities row, so backoffice review has context. Kept separate
-- from investor_submissions (0002_catalog.sql): that table's org_id is
-- required and scoped to a FOUNDER acting on behalf of their own org: an
-- investor proposing their own firm isn't tied to any org at all, so reusing
-- it would mean a fake/borrowed org_id — a smaller, honest table instead.
create table investor_added_entities (
  id uuid primary key default gen_random_uuid(),
  catalog_entity_id uuid not null unique references catalog_entities(id) on delete cascade,
  added_by_user_id uuid not null references auth.users(id),
  added_by_email text not null,
  created_at timestamptz not null default now()
);
alter table investor_added_entities enable row level security;
create policy investor_added_entities_admin on investor_added_entities for all
  using (is_platform_admin()) with check (is_platform_admin());

-- 4. Verification document upload + review queue (Bloco 3). Mirrors the
-- nda-upload pattern (client uploads to Storage, this table records the
-- pointer + review state) rather than a bespoke mechanism.
create table investor_verification_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  investor_email text not null,
  catalog_entity_id uuid not null references catalog_entities(id),
  storage_path text not null,
  file_name text not null,
  status text not null default 'pending_review' check (status = any (array['pending_review','approved','rejected'])),
  reviewer_notes text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table investor_verification_documents enable row level security;
create policy investor_verification_documents_admin on investor_verification_documents for all
  using (is_platform_admin()) with check (is_platform_admin());
create index on investor_verification_documents (catalog_entity_id);

-- 5. The @ablute.pt QA pseudo-profile (Bloco 2) — a single fixed catalog
-- row, clearly marked, pre-verified (it's an internal fixture, not a real
-- trust question), so QA sessions never search/match against real catalog
-- entities and never create a fictional "real-looking" VC. catalog_status
-- 'demo' already excludes it from the same places seeded demo rows are
-- excluded from; verification_status 'verified' keeps it out of the
-- Submissions/pending-review backoffice queues.
insert into catalog_entities (name, website, type, verification_status, source, catalog_status)
select 'ablute_ — Internal QA', null, 'vc', 'verified', 'ablute_internal_qa', 'demo'
where not exists (select 1 from catalog_entities where name = 'ablute_ — Internal QA');
