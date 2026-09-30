-- Prompt I-01c — verification of incubator_accept_pending_member_invites()
-- (§A.2) and the ecosystem kinds (§B), in ONE rolled-back transaction, with
-- zz-test-* fixtures. Same pattern as verify-incubators-rls.sql: every check
-- records into a temp table and the last statement before ROLLBACK selects it.
--
-- Usage before the two I-01c migrations are applied: `begin;` + both
-- migration files + this file from "FIXTURES" down. After: `begin;` + this
-- file from "FIXTURES" down. Nothing persists either way.

begin;

-- =========================================================================
-- FIXTURES
-- =========================================================================
create temp table _r (ord int, name text, pass boolean, detail text) on commit drop;
grant all on _r to authenticated, anon;
create function pg_temp.rec(p_ord int, p_name text, p_pass boolean, p_detail text default null)
returns void language sql as $$ insert into pg_temp._r values (p_ord, p_name, p_pass, p_detail) $$;

insert into auth.users (id, email, email_confirmed_at) values
  ('c1000000-0000-0000-0000-00000000000a', 'zz-test-i01c-good@example.com', now()),
  ('c1000000-0000-0000-0000-00000000000b', 'zz-test-i01c-unconfirmed@example.com', null),
  ('c1000000-0000-0000-0000-00000000000c', 'zz-test-i01c-other@example.com', now()),
  ('c1000000-0000-0000-0000-00000000000d', 'zz-test-i01c-closedorg@example.com', now()),
  ('c1000000-0000-0000-0000-00000000000e', 'zz-test-i01c-owner@example.com', now())
on conflict (id) do nothing;

insert into incubators (id, name, slug, kind, is_test, closed_at) values
  ('c2000000-0000-0000-0000-00000000000a', 'zz-test-i01c-open', 'zz-test-i01c-open', 'public_agency', true, null),
  ('c2000000-0000-0000-0000-00000000000b', 'zz-test-i01c-closed', 'zz-test-i01c-closed', 'association', true, now());

insert into incubator_members (incubator_id, user_id, invited_email, role, status, accepted_at, invite_expires_at) values
  ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000e', null, 'owner', 'active', now(), null),
  ('c2000000-0000-0000-0000-00000000000a', null, 'zz-test-i01c-good@example.com', 'manager', 'invited', null, now() + interval '14 days'),
  ('c2000000-0000-0000-0000-00000000000a', null, 'zz-test-i01c-unconfirmed@example.com', 'manager', 'invited', null, now() + interval '14 days'),
  ('c2000000-0000-0000-0000-00000000000a', null, 'zz-test-i01c-someone-else@example.com', 'manager', 'invited', null, now() + interval '14 days'),
  ('c2000000-0000-0000-0000-00000000000b', null, 'zz-test-i01c-closedorg@example.com', 'manager', 'invited', null, now() + interval '14 days');

-- =========================================================================
-- §A.2 incubator_accept_pending_member_invites()
-- =========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-00000000000b","role":"authenticated","email":"zz-test-i01c-unconfirmed@example.com"}';
do $$ declare r jsonb; begin
  r := incubator_accept_pending_member_invites();
  perform pg_temp.rec(1, 'unconfirmed e-mail → 0 accepted', (r->>'accepted')::int = 0, r::text);
  perform pg_temp.rec(2, 'unconfirmed stays without the incubator signal', not has_active_incubator_membership(), null);
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-00000000000c","role":"authenticated","email":"zz-test-i01c-other@example.com"}';
do $$ declare r jsonb; begin
  r := incubator_accept_pending_member_invites();
  perform pg_temp.rec(3, 'someone else''s invite is never accepted → 0', (r->>'accepted')::int = 0, r::text);
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-00000000000d","role":"authenticated","email":"zz-test-i01c-closedorg@example.com"}';
do $$ declare r jsonb; begin
  r := incubator_accept_pending_member_invites();
  perform pg_temp.rec(4, 'closed organisation → 0', (r->>'accepted')::int = 0, r::text);
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-00000000000a","role":"authenticated","email":"zz-test-i01c-good@example.com"}';
do $$ declare r jsonb; r2 jsonb; begin
  r := incubator_accept_pending_member_invites();
  perform pg_temp.rec(5, 'confirmed invited address → 1 accepted', (r->>'accepted')::int = 1, r::text);
  perform pg_temp.rec(6, 'and now resolves as a member (role signal)', has_active_incubator_membership(), null);
  r2 := incubator_accept_pending_member_invites();
  perform pg_temp.rec(7, 'running it again accepts nothing more (idempotent)', (r2->>'accepted')::int = 0, r2::text);
end $$;
reset role;
do $$ begin
  perform pg_temp.rec(8, 'row is active, bound to the user, token cleared',
    exists (select 1 from incubator_members where invited_email = 'zz-test-i01c-good@example.com'
            and status = 'active' and user_id = 'c1000000-0000-0000-0000-00000000000a' and accepted_at is not null and invite_token_hash is null), null);
  perform pg_temp.rec(9, 'the unconfirmed / other / closed invites are all still invited',
    (select count(*) from incubator_members where status = 'invited' and invited_email in
      ('zz-test-i01c-unconfirmed@example.com', 'zz-test-i01c-someone-else@example.com', 'zz-test-i01c-closedorg@example.com')) = 3, null);
end $$;
set local role anon;
do $$ begin
  begin perform incubator_accept_pending_member_invites(); perform pg_temp.rec(10, 'anon cannot call it', false, 'call succeeded');
  exception when insufficient_privilege then perform pg_temp.rec(10, 'anon cannot call it', true, sqlerrm); end;
end $$;
reset role;

-- =========================================================================
-- §B ecosystem kinds
-- =========================================================================
do $$ begin
  perform pg_temp.rec(20, 'public_agency / association accepted by the check (fixtures above inserted)',
    (select count(*) from incubators where id in ('c2000000-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000b')) = 2, null);
  begin
    insert into incubators (name, slug, kind) values ('zz-test-i01c-bad', 'zz-test-i01c-bad', 'not_a_kind');
    perform pg_temp.rec(21, 'an unknown kind is still refused', false, 'insert succeeded');
  exception when check_violation then perform pg_temp.rec(21, 'an unknown kind is still refused', true, sqlerrm); end;
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-00000000000e","role":"authenticated","email":"zz-test-i01c-owner@example.com"}';
do $$ declare r jsonb; begin
  r := incubator_update_profile('c2000000-0000-0000-0000-00000000000a', 'zz-test-i01c-open', 'tech_transfer_office', '', '', '', '');
  perform pg_temp.rec(22, 'owner can set a new kind from Settings (update_profile widened too)', (r->>'ok')::boolean, r::text);
end $$;
reset role;

select json_agg(json_build_object('ord', ord, 'pass', pass, 'name', name, 'detail', detail) order by ord) as results,
       count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed
from _r;

rollback;
