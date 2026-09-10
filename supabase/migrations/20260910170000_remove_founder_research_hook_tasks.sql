-- Prompt 889 §2 — stop pushing "Research hook" work onto founders.
--
-- research_hook tasks (kind='research') were landing on founders' own task
-- lists (the "Research needed" tab), one per person whose hook the platform
-- had not enriched yet. Researching a person's hook is Sherlock's job, not the
-- founder's — "não podemos encher o user de tarefas que não são culpa dele".
-- 977 had already been created across five orgs (ablute_, Caramel Biscuit,
-- Estojo, Krohnsty, Sherlock Deal), still growing on every catalog delivery.
--
-- Both generators are removed in the same change (catalog-delivery-core's
-- WAVE-1 task, and the runAutomationTick `hook_missing` automation), so this
-- clears the backlog without it refilling. The missing-hook state now lives as
-- a non-task indication on the investor dossier's Team tab and the open person
-- profile, never as a founder to-do.
--
-- Scoped strictly to kind='research' AND action_type='research_hook'; every
-- other task (follow-ups, meetings, admin, the 9 legacy 'other' research rows)
-- is untouched. Idempotent: a no-op once the rows are gone.
-- Authorised by Nuno (delete across all 5 orgs), 2026-09-10.

insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
select null, 'tasks_bulk_deleted', 'tasks', null,
  jsonb_build_object(
    'prompt', '889',
    'reason', 'research_hook is Sherlock''s job, not a founder task',
    'kind', 'research',
    'action_type', 'research_hook',
    'deleted', (select count(*) from public.tasks where kind = 'research' and action_type = 'research_hook'),
    'orgs', (select jsonb_agg(distinct o.name)
               from public.tasks t join public.orgs o on o.id = t.org_id
              where t.kind = 'research' and t.action_type = 'research_hook'));

delete from public.tasks
 where kind = 'research'
   and action_type = 'research_hook';
