-- Prompt 667 §5 (Nuno's decision, 11/09, transmitted via Prompt 660 §1) —
-- "ablute_ — Internal QA" (a07a96eb-a5ac-49b3-be8f-5c60d8c70ecd) stays visible
-- in the Pipeline for testing, gets a visible marker distinguishing it from a
-- real investor, and is excluded from the six-card funnel counts and the
-- temperature distribution. entities had no is_test column of its own
-- (orgs.is_test and catalog_entities.is_test both exist; entities did not) —
-- added here, default false, so every other row is unaffected.
--
-- Scoped to this one entity only. "Test idividual" and
-- "nunomarujo@gmail.com — Individual investor" are explicitly NOT touched —
-- the latter looks like a real individual investor, per Nuno's own note.
-- Verified 2026-09-11: the row reads is_test=true; real counts (excluding it)
-- are 641 · 57 · 0 · 32 · 28 = 758, Active 726.

alter table public.entities
  add column if not exists is_test boolean not null default false;

update public.entities
   set is_test = true
 where id = 'a07a96eb-a5ac-49b3-be8f-5c60d8c70ecd';

insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
values (null, 'entity_flagged_test', 'entity', 'a07a96eb-a5ac-49b3-be8f-5c60d8c70ecd',
  jsonb_build_object('prompt', '667', 'reason', 'Nuno''s decision via Prompt 660 §1',
    'name', 'ablute_ — Internal QA', 'excluded_from', array['pipeline funnel counts', 'temperature distribution']));
