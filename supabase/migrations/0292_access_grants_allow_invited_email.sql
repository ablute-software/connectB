-- Prompt 532 — the release blocker: "Don't know who yet? Invite by email"
-- has NEVER once persisted a grant, in the entire life of the product.
--
-- Root cause, confirmed against production before writing this:
--
--   access_grants had, since 0001_init.sql, the constraint
--     grant_has_grantee CHECK (person_id IS NOT NULL OR grantee_email IS NOT NULL)
--
--   and the ad-hoc external-invite flow (submitAdHocEmailGrant) writes
--     person_id    = null   -- nobody in the CRM yet, that is the whole point
--     grantee_email= null
--     invited_email= the recipient's address
--     invited_name = optional
--
--   so every single one of those inserts was rejected by Postgres. The
--   evidence is not circumstantial: a count over production found 98 rows
--   carrying invited_email and ALL 98 of them also carry a person_id (they
--   came through the entity-invite path, which creates a people row first
--   and therefore satisfies the constraint). Rows with invited_email and
--   person_id IS NULL: ZERO. Not one ad-hoc email invite has ever landed.
--
-- WHY THE INVARIANT IS WRONG, not the flow.
--
-- The constraint encodes "a grant must have a grantee". That intent is
-- right and is KEPT. What it got wrong is the set of columns that can carry
-- a grantee: migration 0045 later introduced invited_email as a third,
-- equally legitimate way to identify one — a recipient who has been sent
-- access but has not yet confirmed who they are. The constraint was never
-- widened to match, so the schema has contradicted the data model since
-- 0045 and the failure only ever surfaced at runtime.
--
-- The three columns stay semantically DISTINCT (this is deliberate, and is
-- why the fix is not the one-liner `grantee_email = invited_email`):
--
--   person_id     — a known person in this org's CRM.
--   grantee_email — a confirmed/live grantee identity by address.
--   invited_email — an EXTERNAL INVITEE, pending confirmation. Pairs with
--                   confirmed_at/self_verified; grantStatus() reads exactly
--                   this pair to return 'pending_confirmation'.
--
-- Copying invited_email into grantee_email to satisfy the old constraint
-- would have promoted every unconfirmed invitee into a fake confirmed
-- grantee, silently corrupting grantStatus(), the guest-preview gate in
-- /api/guest/[token] (which filters on confirmed_at IS NULL) and the
-- guest → registered investor resolution. The invariant is widened instead.
--
-- Nothing is loosened: a row with all three null is still rejected, exactly
-- as before. `grant_has_scope` is untouched.
alter table access_grants drop constraint if exists grant_has_grantee;

alter table access_grants add constraint grant_has_grantee check (
  person_id is not null
  or grantee_email is not null
  or invited_email is not null
);

comment on constraint grant_has_grantee on access_grants is
  'A grant must identify a grantee in one of three ways: person_id (known CRM person), grantee_email (confirmed grantee), or invited_email (external invitee pending confirmation, migration 0045). Widened in 0292 — the original 0001 form omitted invited_email, which silently rejected every "Invite by email" grant from the day 0045 shipped.';
