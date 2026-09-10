-- Prompt 651 §2 — the 977-row cleanup (migration 20260910170000) keyed on
-- action_type='research_hook' and missed seven older seed tasks whose title is
-- "Research hook: {name}" but whose action_type is 'other' (created 2026-07-21,
-- before the 19 Aug batch). One of them, "Research hook: Yahel Halamish", was
-- still visible in the founder's pipeline Next-action column after the first
-- cleanup. Delete every task titled "Research hook: ..." regardless of
-- action_type; the two legitimate "Verify ... eligibility" research tasks stay.
-- Authorised by Nuno via the 651 verifier request. Idempotent once gone.

insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
select null, 'tasks_bulk_deleted', 'tasks', null,
  jsonb_build_object('prompt','651','reason','titled Research hook: tasks missed by the action_type filter',
    'match','title ilike Research hook:%',
    'deleted', (select count(*) from public.tasks where title ilike 'Research hook:%'));

delete from public.tasks where title ilike 'Research hook:%';
