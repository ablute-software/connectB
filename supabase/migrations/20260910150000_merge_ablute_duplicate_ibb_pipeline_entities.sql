-- Prompt 885 — IBB Ventures is also duplicated in ablute_'s own pipeline, not
-- just in the catalogue (884). Merge the two entities into one.
--
-- After 884 both point at the same (merged) catalogue row, both are
-- not_contacted with zero interactions, so there is no state to reconcile —
-- simpler than the Faber merge. Survivor is 2ffec2b0 (the 2 Aug row): it has
-- the real notes and our_angle the other lacks, and the full legal name and
-- specific ibbventures.de domain. The loser (560ae2c5, 24 Jul) carries the
-- only things the survivor is missing: 8 people, 8 "Research hook" tasks, and
-- sectors=[generalist]. Verified in production that the loser has references
-- in exactly two tables (tasks, people) and nowhere else, and that the
-- survivor has 0 people, so nothing collides on the move.
--
-- KEEPER = 2ffec2b0-b95a-47d6-acc8-5e8a492582d7
-- LOSER  = 560ae2c5-0fa0-4466-8366-7f7ff4d4fa73

-- 1) fill the survivor's one empty field the loser has (sectors). notes,
--    our_angle, thesis, fit, name, website all already on the survivor and
--    left untouched. Idempotent: no-op once the loser is gone.
update public.entities k
   set sectors = l.sectors
  from public.entities l
 where k.id = '2ffec2b0-b95a-47d6-acc8-5e8a492582d7'
   and l.id = '560ae2c5-0fa0-4466-8366-7f7ff4d4fa73'
   and (k.sectors is null or cardinality(k.sectors) = 0)
   and l.sectors is not null and cardinality(l.sectors) > 0;

-- 2) the 8 people and 8 tasks follow the survivor. The survivor has no people
--    and no tasks of its own, so these move cleanly with no duplication.
update public.people set entity_id = '2ffec2b0-b95a-47d6-acc8-5e8a492582d7'
 where entity_id = '560ae2c5-0fa0-4466-8366-7f7ff4d4fa73';
update public.tasks  set entity_id = '2ffec2b0-b95a-47d6-acc8-5e8a492582d7'
 where entity_id = '560ae2c5-0fa0-4466-8366-7f7ff4d4fa73';

-- 3) delete the duplicate. Its only references (tasks, people) moved above;
--    every other referencing table was empty for it, so nothing cascades.
delete from public.entities where id = '560ae2c5-0fa0-4466-8366-7f7ff4d4fa73';

-- 4) audit.
insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
values (null, 'entity_merge', 'entity', '2ffec2b0-b95a-47d6-acc8-5e8a492582d7',
        jsonb_build_object('prompt', '885', 'org', 'ablute_',
          'mergedFrom', '560ae2c5-0fa0-4466-8366-7f7ff4d4fa73',
          'reason', 'IBB Ventures duplicated in ablute_ pipeline (both linked to the 884-merged catalogue row)',
          'keptNotesOurAngleFrom', 'keeper', 'peopleMoved', 8, 'tasksMoved', 8));
