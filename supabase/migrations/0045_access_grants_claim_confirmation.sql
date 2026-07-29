-- Grant Access rebuild (prompt 33 part 2) — access_grants delta, confirmed
-- 2026-07-29. FOR REVIEW ONLY, not applied — Nuno confirms the file before
-- anyone runs it (same pattern as 0041-0044).
--
-- Decision 1: NO status enum. access_grants has never had one — every other
-- state (revoked, NDA acceptance, expiry) is already a nullable timestamp.
-- Status is derived, not stored: see grantStatus() in
-- src/lib/access-grants.ts (same pattern as benefitStillActive /
-- isRedemptionCurrentlyActive from the promo-code fix). This migration adds
-- only the raw facts; nothing here computes "pending_confirmation" itself.
--
-- Backward compatibility, by construction: `invited_email` is null for
-- every grant that exists today (all of them — this column is brand new)
-- and for every grant a founder creates by hand going forward. The derived
-- status treats "invited_email is null" as never pending — only a grant
-- actually created through the new founder-invite flow can ever be
-- pending_confirmation. No backfill needed, no existing grant changes
-- behaviour.
alter table access_grants
  add column invited_email text,
  add column invited_name text,
  add column confirmed_at timestamptz,
  add column self_verified boolean not null default false;

comment on column access_grants.invited_email is
  'Set only by the founder "+ Invite someone new" flow. Null for every grant created before this column existed and for every grant a founder creates by hand — those are never pending_confirmation, see grantStatus() in src/lib/access-grants.ts.';
comment on column access_grants.confirmed_at is
  'Set once the invitee clicks "Confirm" on the Is-this-you screen. Null + invited_email set = pending_confirmation (no document access). Never set for grants without invited_email (they were never pending in the first place).';
comment on column access_grants.self_verified is
  'True once the invitee has confirmed their own identity (see confirmed_at) — the strongest provenance signal the app has, distinct from anything the founder typed. Read by the contributions-queue submission, not enforced here.';

-- person_id was already nullable (grant_has_grantee already allows
-- grantee_email alone) — no change needed for "person doesn't exist yet at
-- invite time." people.entity_id stays not null (every person needs a home
-- entity) and person_affiliations gets no new column: provenance for a
-- founder-invited person reuses people.data_source ('founder_invite') and
-- person_affiliations.notes, both already free-text columns today — see
-- decision on reuse-before-new-column from the schema proposal message.

-- No RLS change: access_grants' existing policies are unaffected by adding
-- nullable columns. The /api/portal/access route (service-role) is where
-- the pending-confirmation filter actually gets enforced — see the code
-- change proposed alongside this file.
