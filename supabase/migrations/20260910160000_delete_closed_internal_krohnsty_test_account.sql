-- Prompt 887 §0 — hard-delete the closed internal "Krohnsty" test account,
-- per Nuno's explicit decision (asked before touching it).
--
-- Two near-identical internal test accounts exist; this deletes the CLOSED
-- one (54f1bf67, created 2 Sep, closed 3 Sep, 0 members, 69 sessions). The
-- active one (70a354f2) is untouched. Verified in production that nothing
-- with a NO ACTION / RESTRICT foreign key references it (0 support_tickets,
-- 0 promo-code referrals), so the delete is unblocked; everything else
-- (usage_sessions, entities + children, catalog_deliveries, org_members,
-- documents, grants, …) cascades. Internal test data, no customer affected.
--
-- Guarded to the exact target — the specific id AND is_internal AND closed —
-- so it can never delete a real, open, or non-internal account, and is a
-- no-op on replay once the row is gone.

insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
select null, 'org_hard_deleted', 'org', o.id,
       jsonb_build_object('prompt', '887', 'name', o.name, 'is_internal', o.is_internal,
         'closed_at', o.closed_at, 'usage_sessions', (select count(*) from public.usage_sessions us where us.org_id = o.id),
         'reason', 'closed internal test account, deleted by Nuno''s decision')
  from public.orgs o
 where o.id = '54f1bf67-66a3-4c60-8e1b-9ec39ea2c0dd' and o.is_internal = true and o.closed_at is not null;

delete from public.orgs
 where id = '54f1bf67-66a3-4c60-8e1b-9ec39ea2c0dd'
   and is_internal = true
   and closed_at is not null;
