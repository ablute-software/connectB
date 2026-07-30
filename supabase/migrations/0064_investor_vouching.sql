-- Investor identity verification, Fase B (prompt 64), Bloco 3 — vouching.
-- Only piece of Fase B that needs new schema: Bloco 1's three trust levels
-- were already fully computed in Fase A (investor-identity.ts); Bloco 2's
-- "a pending/self-declared soft commit doesn't auto-count" was already
-- true of EVERY soft commit since Prompt 56 (confirmed_by_founder starts
-- false unconditionally, migration 0059) — nothing to change there.
--
-- One row per reference request, target identified by email (the requester
-- names someone they know is already Verified on the platform — there's no
-- investor directory to browse). voucher_user_id/voucher_catalog_entity_id
-- stay null until the target signs in and confirms through their OWN
-- session — never an anonymous/open form, per the prompt's own
-- non-negotiable. requester_catalog_entity_id is captured at request time
-- so a later change to the requester's own linked entity can't retroactively
-- alter what a past vouch was actually for.
create table investor_vouches (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_catalog_entity_id uuid not null references catalog_entities(id),
  target_email text not null,
  token text not null unique,
  status text not null default 'pending' check (status = any (array['pending','confirmed','expired','revoked'])),
  voucher_user_id uuid references auth.users(id),
  voucher_catalog_entity_id uuid references catalog_entities(id),
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days')
);
alter table investor_vouches enable row level security;
create index on investor_vouches (requester_user_id);
create index on investor_vouches (token);

-- Non-destructive by construction: computeIdentityStatus (investor-identity.ts)
-- ORs a vouch-count signal onto the existing verified/pending logic — it
-- never writes to domain_verified or catalog_entities.verification_status,
-- so a vouch-driven "Verified" badge can never overwrite or be confused
-- with an official document/domain verification, and nothing here touches
-- investor_soft_commits.confirmed_by_founder (already unconditionally
-- manual — see header above).
