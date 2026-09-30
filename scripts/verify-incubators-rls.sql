-- Prompt I-01 §A.10 — RLS / function verification for the incubator
-- foundation (migration 20260930144202_incubators_foundation.sql).
--
-- Pattern: verify-deal-terms-rls.sql (one transaction, ROLLBACK at the end,
-- zz-test-* fixtures, `set local role` + request.jwt.claims). One difference,
-- on purpose: every check RECORDS its result into a temp table instead of
-- aborting on the first failure, and the last statement before ROLLBACK
-- selects that table — so one run shows every check, and a run through the
-- Supabase MCP (which returns the last result set) shows them too.
--
-- I-01b: every simulated session carries its e-mail in request.jwt.claims
-- (the accept/decline functions compare auth.jwt()->>'email' with the invited
-- address), and org A has a member (not allowed) and an admin (allowed) so
-- the owner/admin rule is exercised in SQL, not only in the routes.
--
-- Usage BEFORE the migration is applied (I-01 §D): one session, in order —
--   begin;
--   <the whole migration file>
--   <this file from the "FIXTURES" line down>
-- and this file's own trailing `rollback;` undoes both. AFTER the migration
-- is applied: `begin;` + this file from "FIXTURES" down. Nothing persists
-- either way.

begin;

-- =========================================================================
-- FIXTURES (as the connection's own role — bypasses RLS for setup only)
-- =========================================================================
create temp table _r (ord int, name text, pass boolean, detail text) on commit drop;
grant all on _r to authenticated, anon;
create function pg_temp.rec(p_ord int, p_name text, p_pass boolean, p_detail text default null)
returns void language sql as $$ insert into pg_temp._r values (p_ord, p_name, p_pass, p_detail) $$;

insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-00000000000a', 'zz-test-incub-founder-a@example.com'),
  ('f0000000-0000-0000-0000-00000000000b', 'zz-test-incub-founder-b@example.com'),
  ('e0000000-0000-0000-0000-00000000000a', 'zz-test-incub-member-a@example.com'),
  ('e0000000-0000-0000-0000-00000000000b', 'zz-test-incub-member-b@example.com'),
  ('d0000000-0000-0000-0000-000000000001', 'zz-test-incub-outsider@example.com'),
  ('f0000000-0000-0000-0000-00000000000c', 'zz-test-incub-member-of-a@example.com'),
  ('f0000000-0000-0000-0000-00000000000d', 'zz-test-incub-admin-of-a@example.com')
on conflict (id) do nothing;

insert into orgs (id, name, is_test) values
  ('10000000-0000-0000-0000-00000000000a', 'zz-test-startup-a', true),
  ('10000000-0000-0000-0000-00000000000b', 'zz-test-startup-b', true);
insert into org_members (org_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a', 'owner'),
  ('10000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-00000000000b', 'owner'),
  ('10000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000c', 'member'),
  ('10000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000d', 'admin');

insert into incubators (id, name, slug, kind, is_test) values
  ('20000000-0000-0000-0000-00000000000a', 'zz-test-incubadora-a', 'zz-test-incubadora-a', 'municipal', true),
  ('20000000-0000-0000-0000-00000000000b', 'zz-test-incubadora-b', 'zz-test-incubadora-b', 'university', true);
insert into incubator_members (id, incubator_id, user_id, role, status, accepted_at) values
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a', 'owner', 'active', now()),
  ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-00000000000b', 'owner', 'active', now());

-- Invites: 1 valid (A → founder A), 2 expired (B → founder A — the expired
-- check must pass the address check first; I-01b), 4 valid (A → the
-- outsider's no-org check), 5 valid (B → a plain member of org A).
-- Tokens hashed exactly as the app does.
insert into incubator_invites (id, incubator_id, email, startup_name, invited_by, token_hash, token_expires_at) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'zz-test-incub-founder-a@example.com', 'zz-test-startup-a',
   '30000000-0000-0000-0000-00000000000a', encode(sha256(convert_to('zz-test-incubator-token-0001-aaaaaaaaaaaaaaaa', 'UTF8')), 'hex'), now() + interval '30 days'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000b', 'zz-test-incub-founder-a@example.com', 'zz-test-startup-a',
   '30000000-0000-0000-0000-00000000000b', encode(sha256(convert_to('zz-test-incubator-token-0002-bbbbbbbbbbbbbbbb', 'UTF8')), 'hex'), now() - interval '1 day'),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000a', 'zz-test-incub-outsider@example.com', 'zz-test-nobody',
   '30000000-0000-0000-0000-00000000000a', encode(sha256(convert_to('zz-test-incubator-token-0004-dddddddddddddddd', 'UTF8')), 'hex'), now() + interval '30 days'),
  ('40000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-00000000000b', 'zz-test-incub-member-of-a@example.com', 'zz-test-startup-a',
   '30000000-0000-0000-0000-00000000000b', encode(sha256(convert_to('zz-test-incubator-token-0005-eeeeeeeeeeeeeeee', 'UTF8')), 'hex'), now() + interval '30 days');

-- =========================================================================
-- I-01b §A — a forwarded link: founder B (owner of an open org) holds the
-- token of the invite sent to founder A. Refused before any write.
-- =========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-00000000000b","role":"authenticated","email":"zz-test-incub-founder-b@example.com"}';
do $$ declare r jsonb; begin
  r := incubator_accept_invite('zz-test-incubator-token-0001-aaaaaaaaaaaaaaaa');
  perform pg_temp.rec(100, 'another address with a valid token → invite_email_mismatch (masked)',
    r->>'error' = 'invite_email_mismatch' and r->>'invited_email_masked' = 'zz…@example.com', r::text);
  r := incubator_decline_invite('zz-test-incubator-token-0001-aaaaaaaaaaaaaaaa');
  perform pg_temp.rec(101, 'another address cannot decline either', r->>'error' = 'invite_email_mismatch', r::text);
end $$;
reset role;
do $$ begin
  perform pg_temp.rec(102, 'nothing written by the refused attempts: invite still pending, no relationship',
    (select status from incubator_invites where id = '40000000-0000-0000-0000-000000000001') = 'invited'
    and (select count(*) from incubator_relationships) = 0, null);
end $$;

-- A plain member of org A, holding an invite sent to their own address:
-- the address matches, the role does not (I-01b §B).
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-00000000000c","role":"authenticated","email":"zz-test-incub-member-of-a@example.com"}';
do $$ declare r jsonb; begin
  r := incubator_accept_invite('zz-test-incubator-token-0005-eeeeeeeeeeeeeeee');
  perform pg_temp.rec(103, 'org member (not owner/admin) cannot accept', r->>'error' = 'not_allowed', r::text);
  r := incubator_decline_invite('zz-test-incubator-token-0005-eeeeeeeeeeeeeeee');
  perform pg_temp.rec(104, 'org member (not owner/admin) cannot decline for the org', r->>'error' = 'not_allowed', r::text);
end $$;
reset role;

-- =========================================================================
-- Founder A accepts (A.8). Level 1, badge on, idempotent.
-- =========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-00000000000a","role":"authenticated","email":"zz-test-incub-founder-a@example.com"}';
do $$ declare r jsonb; r2 jsonb; v record; begin
  r := incubator_accept_invite('zz-test-incubator-token-0001-aaaaaaaaaaaaaaaa');
  perform pg_temp.rec(1, 'founder A accepts invite', (r->>'ok')::boolean and not (r->>'already')::boolean, r::text);
  select sharing_level, public_badge, status into v from incubator_relationships where id = (r->>'relationship_id')::uuid;
  perform pg_temp.rec(2, 'new relationship: level 1, badge on, active (D2, D4)', v.sharing_level = 1 and v.public_badge and v.status = 'active', row_to_json(v)::text);
  r2 := incubator_accept_invite('zz-test-incubator-token-0001-aaaaaaaaaaaaaaaa');
  perform pg_temp.rec(3, 'accepting twice returns the same relationship', (r2->>'ok')::boolean and (r2->>'already')::boolean and r2->>'relationship_id' = r->>'relationship_id', r2::text);
  r2 := incubator_accept_invite('zz-test-incubator-token-0002-bbbbbbbbbbbbbbbb');
  perform pg_temp.rec(4, 'expired invite refused', r2->>'error' = 'invite_expired', r2::text);
  r2 := incubator_accept_invite('not-a-real-token-at-all-0000000000000000');
  perform pg_temp.rec(5, 'unknown token refused', r2->>'error' = 'invite_not_found', r2::text);
  perform pg_temp.rec(6, 'founder A is not an incubator member', not has_active_incubator_membership(), null);
  perform pg_temp.rec(7, 'founder A reads own relationship', (select count(*) from incubator_relationships) = 1, null);
end $$;
reset role;
do $$ begin
  perform pg_temp.rec(8, 'expired invite marked expired despite the refusal',
    (select status from incubator_invites where id = '40000000-0000-0000-0000-000000000002') = 'expired', null);
end $$;

-- =========================================================================
-- Member of incubator A: sees its own things, nothing of the founder.
-- =========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-00000000000a","role":"authenticated","email":"zz-test-incub-member-a@example.com"}';
do $$ declare n int; r jsonb; rel uuid; begin
  perform pg_temp.rec(10, 'member A has the incubator signal', has_active_incubator_membership(), null);
  perform pg_temp.rec(11, 'member A reads its relationship', (select count(*) from incubator_relationships) = 1, null);
  perform pg_temp.rec(12, 'member A portfolio has the startup name', (select count(*) from incubator_portfolio('20000000-0000-0000-0000-00000000000a') where startup_name = 'zz-test-startup-a') = 1, null);
  perform pg_temp.rec(13, 'member A cannot read incubator B members', (select count(*) from incubator_members where incubator_id = '20000000-0000-0000-0000-00000000000b') = 0, null);
  perform pg_temp.rec(14, 'incubator_can_view(orgA, 1) true', incubator_can_view('10000000-0000-0000-0000-00000000000a', 1::smallint), null);
  perform pg_temp.rec(15, 'incubator_can_view(orgA, 2) false (level above the shared one)', not incubator_can_view('10000000-0000-0000-0000-00000000000a', 2::smallint), null);
  -- The founder's tables: nothing, not even through "authenticated" alone.
  select count(*) into n from orgs;          perform pg_temp.rec(16, 'member A sees 0 orgs', n = 0, n::text);
  select count(*) into n from entities;      perform pg_temp.rec(17, 'member A sees 0 entities', n = 0, n::text);
  select count(*) into n from documents;     perform pg_temp.rec(18, 'member A sees 0 documents', n = 0, n::text);
  select count(*) into n from access_grants; perform pg_temp.rec(19, 'member A sees 0 access_grants', n = 0, n::text);
  select count(*) into n from interactions;  perform pg_temp.rec(20, 'member A sees 0 interactions', n = 0, n::text);
  select count(*) into n from deal_terms;    perform pg_temp.rec(21, 'member A sees 0 deal_terms', n = 0, n::text);
  select id into rel from incubator_relationships limit 1;
  r := incubator_set_sharing_level(rel, 2::smallint);
  perform pg_temp.rec(22, 'member A cannot set the sharing level', r->>'error' = 'not_allowed', r::text);
  r := incubator_log_access(rel, 'dossier_profile', null);
  perform pg_temp.rec(23, 'member A logs a consultation', (r->>'ok')::boolean, r::text);
  r := incubator_end_relationship(rel, '');
  perform pg_temp.rec(24, 'incubator must give a reason to end', r->>'error' = 'reason_required', r::text);
  -- Direct writes the functions exist to replace.
  begin
    insert into incubator_relationships (incubator_id, org_id) values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b');
    perform pg_temp.rec(25, 'direct insert into relationships refused', false, 'insert succeeded');
  exception when insufficient_privilege then perform pg_temp.rec(25, 'direct insert into relationships refused', true, sqlerrm); end;
  begin
    update incubator_members set role = 'owner' where id = '30000000-0000-0000-0000-00000000000a';
    perform pg_temp.rec(26, 'direct update of incubator_members refused', false, 'update succeeded');
  exception when insufficient_privilege then perform pg_temp.rec(26, 'direct update of incubator_members refused', true, sqlerrm); end;
  begin
    insert into incubator_invites (incubator_id, email, invited_by, token_hash, promo_code_id)
      values ('20000000-0000-0000-0000-00000000000a', 'x@zz-test.example', '30000000-0000-0000-0000-00000000000a', repeat('a', 64), '00000000-0000-0000-0000-000000000000');
    perform pg_temp.rec(27, 'invite with a voucher refused until I-02', false, 'insert succeeded');
  exception when insufficient_privilege then perform pg_temp.rec(27, 'invite with a voucher refused until I-02', true, sqlerrm); end;
  begin
    insert into incubator_invites (incubator_id, email, invited_by, token_hash)
      values ('20000000-0000-0000-0000-00000000000a', 'y@zz-test.example', '30000000-0000-0000-0000-00000000000a', repeat('b', 64));
    perform pg_temp.rec(28, 'member A creates an invite for its own incubator', true, null);
  exception when others then perform pg_temp.rec(28, 'member A creates an invite for its own incubator', false, sqlerrm); end;
  begin
    insert into incubator_invites (incubator_id, email, invited_by, token_hash)
      values ('20000000-0000-0000-0000-00000000000b', 'z@zz-test.example', '30000000-0000-0000-0000-00000000000a', repeat('c', 64));
    perform pg_temp.rec(29, 'member A cannot create an invite for incubator B', false, 'insert succeeded');
  exception when insufficient_privilege then perform pg_temp.rec(29, 'member A cannot create an invite for incubator B', true, sqlerrm); end;
end $$;

-- Member of incubator B: sees nothing of A.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-00000000000b","role":"authenticated","email":"zz-test-incub-member-b@example.com"}';
do $$ declare r jsonb; begin
  perform pg_temp.rec(30, 'member B sees no relationship of A', (select count(*) from incubator_relationships) = 0, null);
  perform pg_temp.rec(31, 'member B gets an empty portfolio for A', (select count(*) from incubator_portfolio('20000000-0000-0000-0000-00000000000a')) = 0, null);
  perform pg_temp.rec(32, 'member B cannot view org A', not incubator_can_view('10000000-0000-0000-0000-00000000000a', 0::smallint), null);
  perform pg_temp.rec(33, 'member B sees no invite of A', (select count(*) from incubator_invites where incubator_id = '20000000-0000-0000-0000-00000000000a') = 0, null);
  r := incubator_log_access((select id from incubator_relationships limit 1), 'dossier_profile', null);
  perform pg_temp.rec(34, 'member B cannot log on A''s relationship (no row visible → not_allowed)', coalesce(r->>'ok', 'false') = 'false', coalesce(r::text, 'null'));
end $$;

-- Founder B: sees nothing of A.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-00000000000b","role":"authenticated","email":"zz-test-incub-founder-b@example.com"}';
do $$ begin
  perform pg_temp.rec(40, 'founder B sees no relationship', (select count(*) from incubator_relationships) = 0, null);
  perform pg_temp.rec(41, 'founder B sees no access log', (select count(*) from founder_incubator_access_log()) = 0 and (select count(*) from incubator_access_log) = 0, null);
  perform pg_temp.rec(42, 'founder B reads no incubator row', (select count(*) from incubators) = 0, null);
end $$;

-- Outsider with no org cannot accept.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated","email":"zz-test-incub-outsider@example.com"}';
do $$ declare r jsonb; begin
  r := incubator_accept_invite('zz-test-incubator-token-0004-dddddddddddddddd');
  perform pg_temp.rec(43, 'user without an org cannot accept', r->>'error' = 'no_open_org', r::text);
end $$;

-- =========================================================================
-- Founder A controls level, badge, and the end (D2, D4, D6).
-- =========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-00000000000a","role":"authenticated","email":"zz-test-incub-founder-a@example.com"}';
do $$ declare r jsonb; rel uuid; begin
  select id into rel from incubator_relationships limit 1;
  r := incubator_set_sharing_level(rel, 3::smallint);
  perform pg_temp.rec(50, 'level 3 refused as coming soon', r->>'error' = 'level_coming_soon', r::text);
  r := incubator_set_sharing_level(rel, 4::smallint);
  perform pg_temp.rec(51, 'level 4 refused as coming soon', r->>'error' = 'level_coming_soon', r::text);
  r := incubator_set_sharing_level(rel, 2::smallint);
  perform pg_temp.rec(52, 'level 2 accepted', (r->>'ok')::boolean, r::text);
  r := incubator_set_public_badge(rel, false);
  perform pg_temp.rec(53, 'badge switched off', (r->>'ok')::boolean and not (select public_badge from incubator_relationships where id = rel), r::text);
  r := incubator_set_status(rel, 'paused');
  perform pg_temp.rec(54, 'founder cannot change the incubator-side status', r->>'error' = 'not_allowed', r::text);
  perform pg_temp.rec(55, 'founder A sees the consultation in "Quem consultou"', (select count(*) from founder_incubator_access_log()) = 1, null);
  perform pg_temp.rec(56, 'founder A reads the incubator through the function, with also_invests as a boolean',
    (select count(*) from founder_incubator_relationships() where incubator_name = 'zz-test-incubadora-a' and incubator_also_invests = false) = 1, null);
  begin
    update incubator_relationships set sharing_level = 4 where id = rel;
    perform pg_temp.rec(57, 'founder cannot write the relationship directly', false, 'update succeeded');
  exception when insufficient_privilege then perform pg_temp.rec(57, 'founder cannot write the relationship directly', true, sqlerrm); end;
end $$;

-- I-01b §B on the live relationship: a member of org A can read but not
-- change; an admin of org A can.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-00000000000c","role":"authenticated","email":"zz-test-incub-member-of-a@example.com"}';
do $$ declare r jsonb; rel uuid; begin
  select id into rel from incubator_relationships limit 1;
  perform pg_temp.rec(105, 'org member still READS the relationship (Programmes read-only)', rel is not null and (select count(*) from founder_incubator_relationships()) = 1, null);
  r := incubator_set_sharing_level(rel, 1::smallint);
  perform pg_temp.rec(106, 'org member cannot change the level', r->>'error' = 'not_allowed', r::text);
  r := incubator_set_public_badge(rel, true);
  perform pg_temp.rec(107, 'org member cannot change the badge', r->>'error' = 'not_allowed', r::text);
  r := incubator_end_relationship(rel, 'x');
  perform pg_temp.rec(108, 'org member cannot end the relationship', r->>'error' = 'not_allowed', r::text);
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-00000000000d","role":"authenticated","email":"zz-test-incub-admin-of-a@example.com"}';
do $$ declare r jsonb; rel uuid; begin
  select id into rel from incubator_relationships limit 1;
  r := incubator_set_public_badge(rel, true);
  perform pg_temp.rec(109, 'org admin can change the badge', (r->>'ok')::boolean, r::text);
  r := incubator_set_sharing_level(rel, 2::smallint);
  perform pg_temp.rec(110, 'org admin can change the level', (r->>'ok')::boolean, r::text);
end $$;

-- Incubator A: pause cuts access at once; resume restores it; graduating drops to 1.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-00000000000a","role":"authenticated","email":"zz-test-incub-member-a@example.com"}';
do $$ declare r jsonb; rel uuid; begin
  select id into rel from incubator_relationships limit 1;
  perform pg_temp.rec(60, 'level 2 now visible to member A', incubator_can_view('10000000-0000-0000-0000-00000000000a', 2::smallint), null);
  r := incubator_set_status(rel, 'paused');
  perform pg_temp.rec(61, 'paused → no access, not even level 0 (D6)', (r->>'ok')::boolean and not incubator_can_view('10000000-0000-0000-0000-00000000000a', 0::smallint), r::text);
  perform pg_temp.rec(62, 'paused row shows no sector/stage in the portfolio', (select count(*) from incubator_portfolio('20000000-0000-0000-0000-00000000000a') where not has_live_access and sector is null and stage is null) = 1, null);
  r := incubator_log_access(rel, 'dossier_profile', null);
  perform pg_temp.rec(63, 'no consultation can be logged while paused', r->>'error' = 'not_allowed', r::text);
  r := incubator_set_status(rel, 'active');
  perform pg_temp.rec(64, 'resume → access back', (r->>'ok')::boolean and incubator_can_view('10000000-0000-0000-0000-00000000000a', 2::smallint), r::text);
  r := incubator_set_status(rel, 'graduated');
  perform pg_temp.rec(65, 'graduation drops level 2 → 1 (D6b)', (r->>'ok')::boolean and (r->>'sharing_level')::int = 1, r::text);
  perform pg_temp.rec(66, 'graduated keeps live access at level 1', incubator_can_view('10000000-0000-0000-0000-00000000000a', 1::smallint)
    and not incubator_can_view('10000000-0000-0000-0000-00000000000a', 2::smallint), null);
  r := incubator_set_status(rel, 'active');
  perform pg_temp.rec(67, 'graduated → active is not an incubator transition', r->>'error' = 'invalid_transition', r::text);
end $$;

-- Founder raises it again after graduation, then ends: the cut is immediate.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-00000000000a","role":"authenticated","email":"zz-test-incub-founder-a@example.com"}';
do $$ declare r jsonb; rel uuid; begin
  select id into rel from incubator_relationships limit 1;
  r := incubator_set_sharing_level(rel, 2::smallint);
  perform pg_temp.rec(70, 'founder may raise the level again after graduation (D6b)', (r->>'ok')::boolean, r::text);
  r := incubator_end_relationship(rel, null);
  perform pg_temp.rec(71, 'founder ends without a reason', (r->>'ok')::boolean and r->>'ended_by' = 'founder', r::text);
  r := incubator_set_sharing_level(rel, 1::smallint);
  perform pg_temp.rec(72, 'an ended relationship cannot be changed', r->>'error' = 'relationship_ended', r::text);
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-00000000000a","role":"authenticated","email":"zz-test-incub-member-a@example.com"}';
do $$ begin
  perform pg_temp.rec(73, 'ended → member A lost access in the same instant (D6)', not incubator_can_view('10000000-0000-0000-0000-00000000000a', 0::smallint), null);
  perform pg_temp.rec(74, 'ended → gone from the portfolio', (select count(*) from incubator_portfolio('20000000-0000-0000-0000-00000000000a')) = 0, null);
  perform pg_temp.rec(75, 'the incubator keeps what it produced: its access-log row survives', (select count(*) from incubator_access_log) = 1, null);
end $$;

-- =========================================================================
-- anon: nothing anywhere.
-- =========================================================================
reset role;
set local role anon;
do $$ declare n int; begin
  begin select count(*) into n from incubators; perform pg_temp.rec(80, 'anon cannot read incubators', false, n::text);
  exception when insufficient_privilege then perform pg_temp.rec(80, 'anon cannot read incubators', true, sqlerrm); end;
  begin select count(*) into n from incubator_relationships; perform pg_temp.rec(81, 'anon cannot read relationships', false, n::text);
  exception when insufficient_privilege then perform pg_temp.rec(81, 'anon cannot read relationships', true, sqlerrm); end;
  begin perform has_active_incubator_membership(); perform pg_temp.rec(82, 'anon cannot call the role function', false, 'call succeeded');
  exception when insufficient_privilege then perform pg_temp.rec(82, 'anon cannot call the role function', true, sqlerrm); end;
  begin perform incubator_accept_invite('zz-test-incubator-token-0004-dddddddddddddddd'); perform pg_temp.rec(83, 'anon cannot accept', false, 'call succeeded');
  exception when insufficient_privilege then perform pg_temp.rec(83, 'anon cannot accept', true, sqlerrm); end;
  begin perform incubator_decline_invite('zz-test-incubator-token-0004-dddddddddddddddd'); perform pg_temp.rec(85, 'anon cannot decline', false, 'call succeeded');
  exception when insufficient_privilege then perform pg_temp.rec(85, 'anon cannot decline', true, sqlerrm); end;
end $$;

-- I-01b §A — decline is a signed-in act now: the invitee with no org
-- declines their own invite; nobody else can.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated","email":"zz-test-incub-outsider@example.com"}';
do $$ declare r jsonb; begin
  r := incubator_decline_invite('zz-test-incubator-token-0004-dddddddddddddddd');
  perform pg_temp.rec(84, 'the invited address (no org yet) declines its own invite', (r->>'ok')::boolean, r::text);
end $$;

-- =========================================================================
-- Final grants (information_schema), as the connection's own role.
-- =========================================================================
reset role;
do $$ declare anon_n int; auth_list text; begin
  select count(*) into anon_n from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'PUBLIC') and table_name like 'incubator%';
  perform pg_temp.rec(90, 'anon/PUBLIC hold no table privilege on incubator tables', anon_n = 0, anon_n::text);
  select string_agg(table_name || ':' || privilege_type, ', ' order by table_name collate "C", privilege_type collate "C") into auth_list
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and table_name like 'incubator%';
  perform pg_temp.rec(91, 'authenticated table privileges = incubators S/I/U, cohorts S/I, everything else S',
    auth_list = 'incubator_access_log:SELECT, incubator_cohorts:INSERT, incubator_cohorts:SELECT, incubator_invites:SELECT, incubator_members:SELECT, incubator_relationships:SELECT, incubators:INSERT, incubators:SELECT, incubators:UPDATE',
    auth_list);
  select string_agg(table_name || '.' || column_name || ':' || privilege_type, ', ' order by table_name collate "C", privilege_type collate "C", column_name collate "C") into auth_list
    from information_schema.column_privileges
    where table_schema = 'public' and grantee = 'authenticated' and table_name in ('incubator_invites', 'incubator_cohorts')
      and privilege_type in ('INSERT', 'UPDATE')
      and column_name in ('status', 'promo_code_id', 'accepted_org_id', 'token_hash', 'auto_promo_code_id');
  -- incubator_cohorts has a TABLE-level insert grant, which information_schema
  -- reports on every column, auto_promo_code_id included; the insert/update
  -- policies keep that column null (checked by the policy, not the grant).
  perform pg_temp.rec(92, 'no column grant lets authenticated set invite status/voucher/acceptance (token_hash insert only)',
    coalesce(auth_list, '') = 'incubator_cohorts.auto_promo_code_id:INSERT, incubator_invites.token_hash:INSERT', coalesce(auth_list, '(none)'));
end $$;

do $$ begin
  perform pg_temp.rec(93, 'email_send_log.kind accepts the three incubator kinds',
    pg_get_constraintdef((select oid from pg_constraint where conname = 'email_send_log_kind_check' and conrelid = 'public.email_send_log'::regclass))
      like '%incubator_invite%incubator_member_invite%incubator_relationship_ended%', null);
end $$;

select json_agg(json_build_object('ord', ord, 'pass', pass, 'name', name, 'detail', detail) order by ord) as results,
       count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed
from _r;

rollback;
