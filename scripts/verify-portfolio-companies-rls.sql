-- Prompt 746 Phase 1 — manual RLS verification for investor_portfolio_
-- companies (migration 20260930120000_investor_portfolio_companies.sql).
--
-- Follows this repo's own established pattern (see the user's memory note
-- "migration_verification_via_rollback_transaction" and the sibling
-- Prompt 894/898 script, scripts/verify-deal-terms-rls.sql, which this one
-- mirrors line-for-line where the shape is the same): run the whole thing
-- as ONE transaction and ROLLBACK at the end, so nothing here ever lands in
-- real data regardless of outcome — this session has no live database
-- access at all, so this file has NOT been run against anything real. It
-- is meant for whoever has a writable branch to run before Nuno's "sim" for
-- the migration, exactly like the 894/898 script was.
--
-- Usage: apply migration 20260930120000_investor_portfolio_companies.sql
-- on a throwaway branch first, then run this file's statements in order
-- inside a single `psql` session (or the Supabase SQL editor) against that
-- branch.
--
-- Two firms, not two orgs — this table is investor-scoped, via
-- matchdeal_investor_members (user_id, catalog_entity_id, status), the same
-- shape investor_declared_investments (the table this one replaces) used.
-- There is no founder/org angle to this table at all, so unlike deal_terms'
-- RLS script there is no cross-table entity_id/org_id mismatch to test —
-- the only scoping column is investor_catalog_entity_id itself.

begin;

-- ---------------------------------------------------------------------
-- Fixture: two investor "firms" (catalog_entities), one active member
-- each, plus a third user who is a platform admin (no firm membership at
-- all) — as service_role (bypasses RLS for setup only; the checks below
-- run `set local role`).
-- ---------------------------------------------------------------------
insert into catalog_entities (id, name, type) values
  ('11111111-1111-1111-1111-111111111111', 'zz-test-firm-a', 'vc'),
  ('22222222-2222-2222-2222-222222222222', 'zz-test-firm-b', 'vc');

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000001', 'zz-test-investor-a@example.com'),
  ('dddddddd-0000-0000-0000-000000000001', 'zz-test-investor-b@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000001', 'zz-test-platform-admin@example.com')
on conflict (id) do nothing;

insert into matchdeal_investor_members (user_id, catalog_entity_id, status) values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'active'),
  ('dddddddd-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'active');

insert into platform_admins (user_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'admin');

-- A portfolio row written as service_role directly, for firm A.
insert into investor_portfolio_companies (id, investor_catalog_entity_id, status, company_name, website, domain, source, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'current', 'zz-test-portfolio-co', 'https://zz-test-portfolio-co.example.com', 'zz-test-portfolio-co.example.com',
        'manual', 'cccccccc-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------
-- Check 1 — firm A's own investor CAN read firm A's portfolio row.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "cccccccc-0000-0000-0000-000000000001"}';
do $$
declare v_count int;
begin
  select count(*) into v_count from investor_portfolio_companies where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert v_count = 1, 'FAIL: firm A investor could not read their own firm''s portfolio row';
  raise notice 'PASS: firm A investor reads firm A''s portfolio row (count=%)', v_count;
end $$;

-- ---------------------------------------------------------------------
-- Check 2 — firm B's investor CANNOT read firm A's portfolio row (the
-- whole point of this table's RLS — ticket/instrument/contact must never
-- leak to a different firm, let alone a founder).
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "dddddddd-0000-0000-0000-000000000001"}';
do $$
declare v_count int;
begin
  select count(*) into v_count from investor_portfolio_companies where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert v_count = 0, 'FAIL: firm B investor could read firm A''s portfolio row — RLS leak';
  raise notice 'PASS: firm B investor reads ZERO of firm A''s portfolio rows';
end $$;

-- ---------------------------------------------------------------------
-- Check 3 — firm B's investor CANNOT insert a row claiming firm A's
-- investor_catalog_entity_id. Unlike deal_terms (two scoping columns,
-- org_id and entity_id, that could disagree), this table has exactly ONE
-- scoping column, so the with-check clause is a direct membership test —
-- there is no cross-column mismatch class of bug possible here, only
-- "is this catalog_entity_id one I'm an active member of".
-- ---------------------------------------------------------------------
do $$
begin
  begin
    insert into investor_portfolio_companies (investor_catalog_entity_id, status, company_name, source, created_by)
    values ('11111111-1111-1111-1111-111111111111', 'current', 'zz-test-hostile-insert', 'manual', 'dddddddd-0000-0000-0000-000000000001');
    raise exception 'FAIL: firm B investor inserted a portfolio row claiming firm A''s catalog_entity_id';
  exception when insufficient_privilege then
    raise notice 'PASS: insert rejected by RLS (investor_catalog_entity_id belongs to a different firm)';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Check 3b — sanity check: firm B's investor CAN still insert a
-- correctly-scoped row (their own catalog_entity_id). Confirms the policy
-- isn't accidentally rejecting legitimate inserts too.
-- ---------------------------------------------------------------------
do $$
declare v_count int;
begin
  insert into investor_portfolio_companies (investor_catalog_entity_id, status, company_name, source, created_by)
  values ('22222222-2222-2222-2222-222222222222', 'current', 'zz-test-firm-b-co', 'manual', 'dddddddd-0000-0000-0000-000000000001');
  select count(*) into v_count from investor_portfolio_companies
    where investor_catalog_entity_id = '22222222-2222-2222-2222-222222222222' and company_name = 'zz-test-firm-b-co';
  assert v_count = 1, 'FAIL: a correctly-scoped insert (firm B investor, firm B catalog_entity_id) was rejected';
  raise notice 'PASS: a correctly-scoped insert still succeeds';
end $$;

-- ---------------------------------------------------------------------
-- Check 3c — firm B's investor CANNOT delete firm A's row (delete is
-- allowed for this table, unlike deal_terms — see the migration's own
-- comment — so this needs its own check, not just insert/select).
--
-- Fixed 30/09/2026, run for real against production in a rolled-back
-- transaction: the original version verified "the row still exists" with
-- a SELECT COUNT run AS THE SAME ROLE (firm B) that attempted the delete —
-- but firm B can never SEE firm A's row via SELECT either (Check 2, above),
-- so that count would read 0 regardless of whether the delete actually
-- succeeded. The assertion could never distinguish "RLS blocked the
-- delete" from "RLS blocked my own verification read" — it would fail its
-- own assert even when the real security behavior is correct, which is
-- exactly what happened on first real execution. Fixed by checking the
-- DELETE's own row count directly (0 rows affected = nothing was deleted,
-- a fact available regardless of who can SELECT the row afterward), then
-- confirming the row's continued existence via service_role (bypasses
-- RLS, so this read is trustworthy) rather than via firm B's own necessarily-
-- blind vantage point.
-- ---------------------------------------------------------------------
do $$
declare v_deleted int;
begin
  with d as (delete from investor_portfolio_companies where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning 1)
  select count(*) into v_deleted from d;
  assert v_deleted = 0, 'FAIL: firm B investor''s delete actually removed firm A''s row';
  raise notice 'PASS: firm B investor''s delete of firm A''s row affected ZERO rows (RLS-filtered, not an error)';
end $$;

reset role;
set local role service_role;
do $$
declare v_count int;
begin
  select count(*) into v_count from investor_portfolio_companies where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert v_count = 1, 'FAIL: firm A''s row is actually gone after firm B''s blocked delete attempt';
  raise notice 'PASS: firm A''s row still exists, confirmed via service_role (bypasses RLS, a trustworthy read)';
end $$;

-- ---------------------------------------------------------------------
-- Check 4 — the ORIGINAL owner (firm A) CAN delete their own row.
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "cccccccc-0000-0000-0000-000000000001"}';
do $$
declare v_count int;
begin
  delete from investor_portfolio_companies where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select count(*) into v_count from investor_portfolio_companies where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert v_count = 0, 'FAIL: firm A investor could not delete their own row';
  raise notice 'PASS: firm A investor deleted their own row';
end $$;

-- ---------------------------------------------------------------------
-- Check 5 — a platform admin (no firm membership at all) reads EVERY
-- firm's rows — "o admin lê tudo" (the prompt's own requirement).
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "eeeeeeee-0000-0000-0000-000000000001"}';
do $$
declare v_count int;
begin
  select count(*) into v_count from investor_portfolio_companies where company_name = 'zz-test-firm-b-co';
  assert v_count = 1, 'FAIL: platform admin could not read a firm''s portfolio row they are not a member of';
  raise notice 'PASS: platform admin reads a row belonging to a firm they are not a member of';
end $$;

-- ---------------------------------------------------------------------
-- Check 6 — anon has NO access at all (belt-and-braces — the migration's
-- own explicit `revoke all ... from public, anon`).
-- ---------------------------------------------------------------------
reset role;
set local role anon;
do $$
declare v_count int;
begin
  begin
    select count(*) into v_count from investor_portfolio_companies;
    assert v_count = 0, 'FAIL: anon could read investor_portfolio_companies rows';
    raise notice 'PASS: anon reads ZERO investor_portfolio_companies rows';
  exception when insufficient_privilege then
    raise notice 'PASS (stronger than expected): anon has no SELECT grant on investor_portfolio_companies at all — permission denied before RLS even runs';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Check 7 — authenticated with NO firm membership at all (a signed-in
-- user who has never linked an investor entity) reads zero rows, same as
-- anon in spirit but via a real authenticated session rather than the
-- anon role — the class of user every /api/portal/investor-profile/*
-- route already treats as "linked: false".
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "ffffffff-0000-0000-0000-000000000099"}';
do $$
declare v_count int;
begin
  select count(*) into v_count from investor_portfolio_companies;
  assert v_count = 0, 'FAIL: an authenticated user with no firm membership read a portfolio row';
  raise notice 'PASS: an authenticated user with no firm membership reads ZERO rows';
end $$;

-- ---------------------------------------------------------------------
-- Check 8 — the exit_at/exit_type-only-when-past constraint (application-
-- independent — this must hold even for a service-role direct insert).
-- ---------------------------------------------------------------------
reset role;
set local role service_role;
do $$
begin
  begin
    insert into investor_portfolio_companies (investor_catalog_entity_id, status, company_name, source, created_by, exit_at)
    values ('11111111-1111-1111-1111-111111111111', 'current', 'zz-test-bad-exit', 'manual', 'cccccccc-0000-0000-0000-000000000001', '2024-01-01');
    raise exception 'FAIL: a ''current'' row with exit_at set was accepted';
  exception when check_violation then
    raise notice 'PASS: a ''current'' row with exit_at set is rejected by investor_portfolio_companies_exit_only_when_past';
  end;
end $$;

-- Nothing above is ever kept, pass or fail.
rollback;
