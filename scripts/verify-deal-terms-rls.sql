-- Prompt 894 §E — manual RLS verification for deal_terms, deal_terms_sync_
-- interest_trigger, and interactions_create_ask_term_trg.
--
-- RUN FOR REAL against production in a rolled-back transaction, 30/09/2026
-- (this session had a writable connection via the Supabase MCP and Nuno's
-- explicit go-ahead to apply the corrected migration — see DECISIONS.md).
-- Every check below passed, including the two fixture/assertion fixes this
-- same run required (entities' website column, and Check 4's exception
-- handling) — both applied here so the NEXT run of this file doesn't hit
-- the same two snags. Follows this repo's own established pattern (see the
-- user's memory note "migration_verification_via_rollback_transaction" and
-- Prompt 737's own 0A.5/0A.6 claim-simulation): run the whole thing as ONE
-- transaction and ROLLBACK at the end, so nothing here ever lands in real
-- data regardless of outcome.
--
-- Usage: apply migration 20260930105448_deal_terms.sql (and its follow-up,
-- 20260930111044_deal_terms_revoke_execute_definer_functions.sql) on a
-- throwaway branch first, then run this file's statements in order inside
-- a single `psql` session (or the Supabase SQL editor) against that branch.

begin;

-- ---------------------------------------------------------------------
-- Fixture: two orgs, one entity each, one person each, as service_role
-- (bypasses RLS for setup only — the actual checks below run `set role`).
-- `website` is required: production's `entities_has_identity_evidence`
-- check constraint (not present when this script was first drafted) needs
-- at least one of website/email_domain/phone/address/source_url/
-- unverified_stub_at — confirmed by running this script for real and
-- hitting the constraint before this fix existed.
-- ---------------------------------------------------------------------
insert into orgs (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'zz-test-org-a'),
  ('22222222-2222-2222-2222-222222222222', 'zz-test-org-b');

insert into entities (id, org_id, name, type, status, website) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'zz-test-entity-a', 'vc', 'in_conversation', 'https://zz-test-entity-a.example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'zz-test-entity-b', 'vc', 'in_conversation', 'https://zz-test-entity-b.example.com');

-- Two real auth.users, one per org, each a member of only their own org.
insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000001', 'zz-test-founder-a@example.com'),
  ('dddddddd-0000-0000-0000-000000000001', 'zz-test-founder-b@example.com')
on conflict (id) do nothing;

insert into org_members (org_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'owner');

-- A deal_terms row written as service_role directly, for org A's entity.
insert into deal_terms (id, org_id, entity_id, kind, side, formality, amount_eur)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', 'commitment', 'theirs', 'agreed', 270000);

-- ---------------------------------------------------------------------
-- Check 1 — org A's own founder CAN read org A's deal_terms row.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "cccccccc-0000-0000-0000-000000000001"}';
do $$
declare v_count int;
begin
  select count(*) into v_count from deal_terms where id = 'eeeeeeee-0000-0000-0000-000000000001';
  assert v_count = 1, 'FAIL: org A founder could not read their own deal_terms row';
  raise notice 'PASS: org A founder reads org A deal_terms (count=%)', v_count;
end $$;

-- ---------------------------------------------------------------------
-- Check 2 — org B's founder CANNOT read org A's deal_terms row (the whole
-- point of this table's RLS: no cross-org leak, and specifically no
-- investor-side visibility — see the migration's own header).
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "dddddddd-0000-0000-0000-000000000001"}';
do $$
declare v_count int;
begin
  select count(*) into v_count from deal_terms where id = 'eeeeeeee-0000-0000-0000-000000000001';
  assert v_count = 0, 'FAIL: org B founder could read org A''s deal_terms row — RLS leak';
  raise notice 'PASS: org B founder reads ZERO of org A''s deal_terms rows';
end $$;

-- ---------------------------------------------------------------------
-- Check 3 — org B's founder CANNOT insert a deal_terms row naming org_id=B
-- (an org they ARE a member of) but entity_id belonging to org A. Review
-- fix C (2026-09-30): this used to be "app-trusted, not re-litigated by
-- this migration" — is_org_member(org_id) alone says nothing about which
-- org entity_id belongs to. Both triggers on this table are security
-- definer and write to entities.interest_eur, so without the fix this is a
-- real cross-tenant write, not just a read leak: org B could overwrite org
-- A's own entities.interest_eur. The with-check clauses now added
-- explicitly verify entity_id (and interaction_id/person_id, when
-- non-null) belong to the SAME org_id as the row being written.
--
-- Fixed 2026-09-30: the original version of this check had a real bug —
-- `exception when insufficient_privilege or others` catches EVERY
-- exception, including the `raise exception 'FAIL: ...'` raised a few
-- lines below when the insert unexpectedly SUCCEEDS, so it printed
-- "PASS (or acceptable no-op)" unconditionally regardless of outcome. It
-- could never actually have reported a real RLS gap. Narrowed to the
-- specific SQLSTATE an RLS with-check violation raises (insufficient_
-- privilege, 42501) — the FAIL exception (default SQLSTATE P0001) is no
-- longer caught by this handler, so an unexpectedly successful insert now
-- propagates as a real, visible error and aborts the script, exactly as a
-- failing `assert` does elsewhere in this file.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    insert into deal_terms (org_id, entity_id, kind, side, formality, amount_eur)
    values ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'offer', 'theirs', 'mentioned', 1);
    raise exception 'FAIL: org B founder inserted a deal_terms row claiming org A''s entity';
  exception when insufficient_privilege then
    raise notice 'PASS: insert rejected by RLS (entity_id belongs to a different org than org_id)';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Check 3b — sanity check: org B's founder CAN still insert an ordinary,
-- correctly-scoped row (org_id=B, entity_id=B's own entity). Fix C's new
-- with-check clauses must not have made the policy reject legitimate
-- inserts — this is the same shape as Check 3 but with entity_id/org_id
-- actually matching, so it must succeed where Check 3 must fail.
-- ---------------------------------------------------------------------
do $$
declare v_count int;
begin
  insert into deal_terms (org_id, entity_id, kind, side, formality, amount_eur)
  values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'offer', 'theirs', 'mentioned', 500000);
  select count(*) into v_count from deal_terms
    where org_id = '22222222-2222-2222-2222-222222222222' and entity_id = 'bbbbbbbb-0000-0000-0000-000000000001' and amount_eur = 500000;
  assert v_count = 1, 'FAIL: a correctly-scoped insert (org_id and entity_id both org B) was rejected';
  raise notice 'PASS: a correctly-scoped insert still succeeds after fix C';
end $$;

-- ---------------------------------------------------------------------
-- Check 4 — anon has NO access at all (belt-and-braces; anon should never
-- reach this table through any path).
--
-- Fixed 30/09/2026, run for real against production in a rolled-back
-- transaction: after review fix B's `revoke all on deal_terms from public,
-- anon`, anon no longer has a SELECT grant on this table at all — the
-- query fails at the privilege check with `permission denied for table
-- deal_terms` (42501/insufficient_privilege) BEFORE RLS ever runs, not a
-- silent empty result the way it would for a table anon has SELECT on but
-- RLS filters to zero rows. The original version of this check assumed the
-- latter and would have failed its own `assert v_count = 0` with an
-- unhandled permission-denied error instead of ever reaching that
-- assertion — accepting either outcome as PASS, since a hard permission
-- denial is a STRONGER guarantee than an RLS-filtered empty result, not a
-- weaker one.
-- ---------------------------------------------------------------------
reset role;
set local role anon;
do $$
declare v_count int;
begin
  begin
    select count(*) into v_count from deal_terms;
    assert v_count = 0, 'FAIL: anon could read deal_terms rows';
    raise notice 'PASS: anon reads ZERO deal_terms rows';
  exception when insufficient_privilege then
    raise notice 'PASS (stronger than expected): anon has no SELECT grant on deal_terms at all post-fix-B — permission denied before RLS even runs';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Check 5 — entities.interest_eur derivation trigger. As service_role
-- (bypasses RLS, exercises the trigger directly regardless of policy).
-- ---------------------------------------------------------------------
reset role;
set local role service_role;
do $$
declare v_interest int;
begin
  select interest_eur into v_interest from entities where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert v_interest = 270000, format('FAIL: entities.interest_eur was %s, expected 270000 after the fixture insert', v_interest);
  raise notice 'PASS: entities.interest_eur derived to 270000 from the fixture commitment row';
end $$;

-- Supersede it with a lower amount — interest_eur must follow the new head
-- of the chain, not the original row.
insert into deal_terms (id, org_id, entity_id, kind, side, formality, amount_eur, supersedes_id)
values ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', 'commitment', 'theirs', 'agreed', 200000,
        'eeeeeeee-0000-0000-0000-000000000001');

do $$
declare v_interest int;
begin
  select interest_eur into v_interest from entities where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert v_interest = 200000, format('FAIL: entities.interest_eur was %s, expected 200000 after supersede', v_interest);
  raise notice 'PASS: entities.interest_eur follows the supersede chain head (200000)';
end $$;

-- ---------------------------------------------------------------------
-- Check 6 — interactions.ask_amount_eur creates a deal_terms('ask') row.
-- ---------------------------------------------------------------------
insert into interactions (id, org_id, entity_id, direction, channel, content, ask_amount_eur)
values ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', 'out', 'email', 'zz-test message', 1300000);

do $$
declare v_count int;
begin
  select count(*) into v_count from deal_terms
    where interaction_id = 'ffffffff-0000-0000-0000-000000000001' and kind = 'ask' and side = 'ours' and amount_eur = 1300000;
  assert v_count = 1, 'FAIL: interactions.ask_amount_eur did not create a matching deal_terms(kind=ask) row';
  raise notice 'PASS: ask_amount_eur trigger created the matching deal_terms row';
end $$;

-- Nothing above is ever kept, pass or fail.
rollback;
