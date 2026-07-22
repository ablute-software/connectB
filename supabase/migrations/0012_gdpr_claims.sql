-- IRM_SPEC §5 — investor self-claim (LinkedIn) + GDPR/RGPD, non-OAuth parts.
-- profile_claims is written but stays inert until LinkedIn OAuth is actually
-- configured (see NEXT_PUBLIC_LINKEDIN_OAUTH_ENABLED) — a claim requires a
-- verified LinkedIn identity to compute match_score against, which doesn't
-- exist yet. gdpr_requests does NOT need OAuth: a data-subject request is
-- valid however it arrives, so it gets a real, working public entry point
-- now (/privacy-request) instead of waiting on the claim flow.
--
-- person_id is nullable on both tables: a claimant may not resolve to an
-- exact person row (people aren't a shared cross-org identity yet, unlike
-- catalog_entities — see DECISIONS.md), so back-office may need to link it
-- manually after the fact.

create type claim_status as enum ('pending', 'approved', 'rejected');
create type gdpr_kind as enum ('rectify', 'erase');
create type gdpr_status as enum ('pending', 'resolved', 'rejected');

create table profile_claims (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid references people(id) on delete cascade,
  claimant_email text not null,
  claimant_user_id uuid references auth.users(id),
  linkedin_payload jsonb,
  match_score numeric check (match_score is null or (match_score between 0 and 1)),
  status claim_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table profile_claims enable row level security;
create policy profile_claims_platform_admin on profile_claims for all
  using (is_platform_admin()) with check (is_platform_admin());
create index on profile_claims (person_id);
create index on profile_claims (status);

create table gdpr_requests (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid references people(id) on delete cascade,
  claimant_name text,
  claimant_email text not null,
  claimant_user_id uuid references auth.users(id),
  kind gdpr_kind not null,
  details text,
  status gdpr_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table gdpr_requests enable row level security;
create policy gdpr_requests_platform_admin on gdpr_requests for all
  using (is_platform_admin()) with check (is_platform_admin());
create index on gdpr_requests (status);
create index on gdpr_requests (created_at);
