-- Prompt 565 — 50 delivered rows that arrived with no way to contact anyone.
--
-- Between 2026-08-03 14:54 and 2026-09-02 13:22, four orgs received 50
-- catalog deliveries (entities.source = 'catalog') whose submission_channel,
-- email and key_people were ALL empty — Caramel Biscuit 24, Estojo 13, "New
-- company (please rename in Settings)" 10, Krohnsty 3. The master catalog held
-- the data for the same firms the whole time: Atomico's email and 12
-- investment-team people, Index Ventures' email and 9 partners, Luminar's
-- email and 6. The delivery path simply never copied it — catalogContactFields
-- only entered catalog-delivery-core.ts on 03/09 19:17 (Prompt 544 Part C,
-- 560d9a2), so everything delivered before that came out blank.
--
-- Why this silences Sherlock's Next Clue completely: a founder whose entire
-- pipeline has no channel on any row passes neither readyToContact (needs
-- people) nor 564's new next_approach (nothing to rank a firm on without
-- email, submission_channel or key_people), so the ladder falls through to
-- pitch_review / readiness_nudge / all_clear. It was telling the truth about
-- data that should never have looked like that.
--
-- ONE CORRECTION to the report that prompted this, because the difference
-- matters for whether the forward fix is real. The report inferred from the
-- data that deliveries "stopped coming out empty" somewhere between 02/09
-- 13:22 and 20:10, and asked for the commit that did it. No commit matches
-- that window, and none should: the three later batches that look complete
-- (Sherlock Deal 02/09 20:10 and 03/09 21:10, Krohnsty 03/09 11:34) all share
-- the same entities.updated_at of 2026-09-03 21:11:24 — twenty-five hours
-- after the earliest of them was delivered. They were not born complete; they
-- were filled in afterwards by a separate backfill. The real cutoff is
-- 560d9a2 itself, and Sherlock Deal's 03/09 21:10 batch is the first one
-- actually delivered complete by the code.
--
-- Scope: copy only. No contact is invented, and entities.source = 'manual'
-- is untouched — ablute_'s 761 hand-entered rows, 114 of them without contact,
-- are the founder's own entries and not a symptom of this.
create temporary table _p565_before on commit drop as
select e.org_id, count(*) as sem_contacto
  from public.entities e
  join public.catalog_deliveries cd on cd.entity_id = e.id
 where e.source = 'catalog'
   and coalesce(e.submission_channel, '') = ''
   and coalesce(e.email, '') = ''
   and coalesce(e.key_people, '') = ''
 group by e.org_id;

update public.entities e
   set submission_channel = nullif(trim(coalesce(ce.submission_channel, '')), ''),
       email              = nullif(trim(coalesce(ce.email, '')), ''),
       key_people         = nullif(trim(coalesce(ce.key_people, '')), ''),
       -- Same rule as deriveSubmissionChannelType(): a form beats an email,
       -- and neither means 'unknown'. Kept in step with 564 §A rather than
       -- left at the hard-coded 'unknown' the old delivery wrote.
       -- The column is the submission_channel_type ENUM (email|form|none|
       -- unknown), not text, so the cast is required rather than cosmetic.
       submission_channel_type = (case
         when coalesce(trim(ce.submission_channel), '') <> '' then 'form'
         when coalesce(trim(ce.email), '') <> ''              then 'email'
         else 'unknown'
       end)::public.submission_channel_type,
       updated_at = now()
  from public.catalog_deliveries cd
  join public.catalog_entities ce on ce.id = cd.catalog_id
 where cd.entity_id = e.id
   and e.source = 'catalog'
   -- Only rows with nothing at all: never overwrite a founder's own edit, and
   -- never touch a row the delivery already filled correctly.
   and coalesce(e.submission_channel, '') = ''
   and coalesce(e.email, '') = ''
   and coalesce(e.key_people, '') = ''
   -- And only where the catalog actually has something to give.
   and (coalesce(trim(ce.submission_channel), '') <> ''
     or coalesce(trim(ce.email), '') <> ''
     or coalesce(trim(ce.key_people), '') <> '');

do $report$
declare r record;
begin
  for r in
    select o.name,
           b.sem_contacto as antes,
           (select count(*) from public.entities e2
              join public.catalog_deliveries cd2 on cd2.entity_id = e2.id
             where e2.org_id = b.org_id and e2.source = 'catalog'
               and coalesce(e2.submission_channel,'') = ''
               and coalesce(e2.email,'') = ''
               and coalesce(e2.key_people,'') = '') as depois
      from _p565_before b join public.orgs o on o.id = b.org_id
     order by b.sem_contacto desc
  loop
    raise notice 'Prompt 565 backfill — %: % sem contacto antes, % depois', r.name, r.antes, r.depois;
  end loop;
end
$report$;
