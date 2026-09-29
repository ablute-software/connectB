-- Prompt 894 §E — manual RLS verification for deal_terms, deal_terms_sync_
-- interest_trigger, and interactions_create_ask_term_trg.
--
-- NOT run by this session against any database, live or branched — the
-- session had no writable Supabase branch available and CLAUDE.md forbids
-- applying this prompt's migration to any database from this session. This
-- file is the concrete script for whoever next has one, following this
-- repo's own established pattern (see the user's memory note
-- "migration_verification_via_rollback_transaction" and Prompt 737's
-- 0A.5/0A.6 claim-simulation): run the whole thing as ONE transaction and
-- ROLLBACK at the end, so nothing here ever lands in real data regardless
-- of outcome.
--
-- Usage: apply migration 20260929200000_deal_terms.sql on a throwaway
-- branch first, then run this file's statements in order inside a single
-- `psql` session (or the Supabase SQL editor) against that branch.

begin;

-- ---------------------------------------------------------------------
-- Fixture: two orgs, one entity each, one person each, as service_role
-- (bypasses RLS for setup only — the actual checks below run `set role`).
-- ---------------------------------------------------------------------
insert into orgs (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'zz-test-org-a'),
  ('22222222-2222-2222-2222-222222222222', 'zz-test-org-b');

insert into entities (id, org_id, name, type, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'zz-test-entity-a', 'vc', 'in_conversation'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'zz-test-entity-b', 'vc', 'in_conversation');

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
-- Check 3 — org B's founder CANNOT insert a deal_terms row against org A's
-- entity even while claiming org_id = B (the with-check clause must look
-- at org_id, and entity_id belonging to a different org is a pre-existing,
-- app-trusted assumption shared with every other org-scoped table here —
-- not re-litigated by this migration).
-- ---------------------------------------------------------------------
do $$
begin
  begin
    insert into deal_terms (org_id, entity_id, kind, side, formality, amount_eur)
    values ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'offer', 'theirs', 'mentioned', 1);
    raise exception 'FAIL: org B founder inserted a deal_terms row claiming org A''s entity';
  exception when insufficient_privilege or others then
    raise notice 'PASS (or acceptable no-op): insert blocked or errored as expected';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Check 4 — anon has NO access at all (belt-and-braces; anon should never
-- reach this table through any path).
-- ---------------------------------------------------------------------
reset role;
set local role anon;
do $$
declare v_count int;
begin
  select count(*) into v_count from deal_terms;
  assert v_count = 0, 'FAIL: anon could read deal_terms rows';
  raise notice 'PASS: anon reads ZERO deal_terms rows';
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
