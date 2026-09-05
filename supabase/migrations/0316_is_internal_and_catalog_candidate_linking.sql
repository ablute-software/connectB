-- Prompt 570 §A + §D.1/§D.2 — foundations for the back-office queues.
--
-- ============================================================
-- §A — is_internal
-- ============================================================
-- A fourth column in a family whose first three each cost a prompt this week,
-- every time for the same reason: the name said what it was, never what it was
-- not. is_test looked like a discovery switch and also disabled the monthly
-- delivery and the automation rules (563). discovery_excluded_reason looked
-- like it served both sides of the market, and the investor half lived in a
-- different table (568). moderation_status looked like it closed the account
-- and closed only the login (571 exists entirely because of that).
--
-- So this one arrives with its boundaries written down, and the comment is
-- part of the change rather than decoration.
alter table public.orgs
  add column if not exists is_internal boolean not null default false;

alter table public.matchdeal_investor_members
  add column if not exists is_internal boolean not null default false;

comment on column public.orgs.is_internal is
  'Internal team account. Read ONLY by back-office review queues (hide-by-default). Does NOT disable automations (that is is_test), does NOT hide from discovery (that is discovery_excluded_reason / moderation_status), does NOT block login. is_internal means: what this account produces does not need back-office review — we produced it.';

comment on column public.matchdeal_investor_members.is_internal is
  'Internal team account. Read ONLY by back-office review queues (hide-by-default). Does NOT disable automations (that is is_test), does NOT hide from discovery (that is discovery_excluded_reason / moderation_status), does NOT block login. is_internal means: what this account produces does not need back-office review — we produced it.';

-- Every account that exists today is ours: 14 orgs, 6 investor memberships,
-- and 12 auth users who are all team or testers. External testers
-- (carladias96@gmail.com, daquinta.app@gmail.com) are included on purpose —
-- the back-office toggle is how they get reclassified, not a rule here that
-- would have to guess. On a fresh replay this is a no-op, since there are no
-- rows yet.
update public.orgs set is_internal = true where is_internal = false;
update public.matchdeal_investor_members set is_internal = true where is_internal = false;

-- ============================================================
-- §D.1 — two new review states
-- ============================================================
-- catalog_review_status is free text with a CHECK (verified: pending |
-- promoted | merged | dismissed), so the constraint is what needs widening.
alter table public.entities drop constraint if exists entities_catalog_review_status_check;
alter table public.entities add constraint entities_catalog_review_status_check
  check (catalog_review_status = any (array[
    'pending'::text, 'promoted'::text, 'merged'::text, 'dismissed'::text,
    -- Prompt 570 §D: the candidate IS this catalog row (exact domain match) —
    -- recorded without anyone clicking, and never queued for review.
    'linked'::text,
    -- Same name, different or missing domain. Still a human decision, but a
    -- decision between two named things rather than a blank review.
    'probable_match'::text
  ]));

-- ============================================================
-- §D.2 — entities.catalog_id
-- ============================================================
-- The prompt said not to duplicate a link that already exists, and to check
-- catalog_deliveries first. Checked, and the answer is genuinely mixed:
-- 749 of the 751 pending manual candidates ALREADY have exactly one
-- catalog_deliveries row pointing at a catalog_entities row. So for almost all
-- of them the correspondence is, in fact, already recorded somewhere.
--
-- It is still the wrong place to keep it, for one reason that decides it:
-- catalog_deliveries is an EVENT ("this catalog row was delivered to this org
-- as this entity"), and the reconcile needs a CORRESPONDENCE ("this manual
-- entity is that catalog row"). Writing new links into catalog_deliveries
-- would fabricate delivery events that never happened — and deliveries are
-- read by quota, by the monthly delivery, and by the founder's own pipeline.
-- A reconciliation job must not be able to hand someone an investor.
--
-- So: a column for the correspondence, and the reconcile SEEDS it from the
-- delivery rows where they already exist rather than recomputing what is
-- already known. The existing link is used, as asked; it is just not extended.
alter table public.entities
  add column if not exists catalog_id uuid references public.catalog_entities(id) on delete set null;

comment on column public.entities.catalog_id is
  'The catalog_entities row this entity corresponds to, when known. A correspondence, not a delivery: catalog_deliveries records that a catalog row was DELIVERED to an org, and must never be written by reconciliation. Set by the catalog-candidates reconcile (Prompt 570 §D) and seeded from existing deliveries.';

create index if not exists entities_catalog_id_idx on public.entities (catalog_id) where catalog_id is not null;
