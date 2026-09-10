-- Prompt 884 — IBB Ventures has two catalog_entities rows for one German fund;
-- merge into one, the same way the merge route (api/backoffice/catalog/merge)
-- would, plus the name-based person dedup the prompt asks for.
--
-- The two rows are the same fund imported twice by two paths:
--   LOSER  c287e87e (27 Jul, backfill_entities): "IBB Ventures", ibb-bet.de,
--          with key_people (8 named) and email info@ibbventures.de.
--   KEEPER 9bdf1bc0 (1 Sep, pipeline_auto): the full legal name
--          "IBB Beteiligungsgesellschaft mbH — IBB Ventures", the specific
--          domain ibbventures.de, but empty key_people and email.
-- Both verified, each with 17 affiliated people, each used by one ablute_
-- entity. Per Nuno: keeper's name + website win (more specific); key_people +
-- email come from the loser (don't lose them).
--
-- People: verified in production — the 17 names match 17 names on the keeper
-- with the SAME LinkedIn (0 diverge). 9 are the same catalog_people row
-- affiliated to both; 8 are loser-only DUPLICATE rows that twin a keeper
-- person by name+LinkedIn. The route dedups affiliations by person_id, which
-- would collapse the 9 but leave the 8 as duplicates (25 on the keeper). The
-- prompt wants them once (17), so each loser-only duplicate is merged into its
-- keeper twin: the one founder-CRM pointer and the one enrichment source that
-- reference a duplicate are re-pointed to the twin, then the duplicate is
-- deleted. Nothing and nobody is lost; the keeper ends with its own 17.
--
-- KEEPER = 9bdf1bc0-a068-491e-93d1-8c5b4c651d8a
-- LOSER  = c287e87e-cae5-432c-816b-1cf0a26f4b07

-- 1) key_people + email from the loser (route does NOT carry these; the prompt
--    asks explicitly). Fill-only-if-empty, so a re-run is a no-op.
update public.catalog_entities k
   set key_people = coalesce(nullif(k.key_people, ''), l.key_people),
       email      = coalesce(k.email, l.email)
  from public.catalog_entities l
 where k.id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a'
   and l.id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07';

-- 2) the route's fill-if-empty for the mergeable fields the keeper is missing
--    (hq_city, thesis — measured empty on the keeper).
update public.catalog_entities k
   set hq_city = coalesce(nullif(k.hq_city, ''), l.hq_city),
       thesis  = coalesce(nullif(k.thesis, ''), l.thesis)
  from public.catalog_entities l
 where k.id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a'
   and l.id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07';

-- 3) re-point the founder-CRM pointer that references a loser-only duplicate to
--    its keeper twin (matched by folded name + LinkedIn), so deleting the
--    duplicate does not null a founder's link.
with twin as (
  select lp.id as loser_pid, kp.id as keeper_pid
    from public.catalog_people lp
    join public.catalog_people kp
      on lower(regexp_replace(lp.full_name, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(kp.full_name, '[^a-zA-Z0-9]', '', 'g'))
     and coalesce(lp.linkedin_url, '') = coalesce(kp.linkedin_url, '')
   where lp.id in (select person_id from public.catalog_person_affiliations where entity_id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07'
                   except
                   select person_id from public.catalog_person_affiliations where entity_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a')
     and kp.id in (select person_id from public.catalog_person_affiliations where entity_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a')
)
update public.people p set catalog_person_id = twin.keeper_pid
  from twin where p.catalog_person_id = twin.loser_pid;

-- 4) same re-point for the enrichment source that references a duplicate.
with twin as (
  select lp.id as loser_pid, kp.id as keeper_pid
    from public.catalog_people lp
    join public.catalog_people kp
      on lower(regexp_replace(lp.full_name, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(kp.full_name, '[^a-zA-Z0-9]', '', 'g'))
     and coalesce(lp.linkedin_url, '') = coalesce(kp.linkedin_url, '')
   where lp.id in (select person_id from public.catalog_person_affiliations where entity_id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07'
                   except
                   select person_id from public.catalog_person_affiliations where entity_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a')
     and kp.id in (select person_id from public.catalog_person_affiliations where entity_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a')
)
update public.catalog_entity_enrichment_sources s set person_id = twin.keeper_pid
  from twin where s.person_id = twin.loser_pid;

-- 5) the SHARED people (affiliated to both) may carry entity_id = loser on
--    their catalog_people row; re-point to keeper so the loser delete does not
--    orphan them (their loser affiliation cascades away, keeper's stays).
update public.catalog_people
   set entity_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a'
 where entity_id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07'
   and id in (select person_id from public.catalog_person_affiliations where entity_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a');

-- 6) pack_items → keeper (skip a pack the keeper already has), then drop leftovers.
update public.pack_items set catalog_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a'
 where catalog_id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07'
   and pack_id not in (select pack_id from public.pack_items where catalog_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a');
delete from public.pack_items where catalog_id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07';

-- 7) catalog_deliveries → keeper (drop a delivery the keeper already has for the
--    same org — both rows were delivered to ablute_, so the loser's is dropped).
delete from public.catalog_deliveries where catalog_id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07'
   and org_id in (select org_id from public.catalog_deliveries where catalog_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a');
update public.catalog_deliveries set catalog_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a'
 where catalog_id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07';

-- 8) investor_submissions provenance (none today; kept for faithfulness).
update public.investor_submissions set merged_catalog_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a'
 where merged_catalog_id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07';

-- 9) alias the loser name to the keeper so future imports/dedup match it.
insert into public.entity_aliases (catalog_id, alias)
select '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a', l.name
  from public.catalog_entities l
 where l.id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07'
   and not exists (select 1 from public.entity_aliases a where a.catalog_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a' and a.alias = l.name);

-- 10) the founder entity on the loser follows to the keeper (FK only; no
--     interactions/history move — those hang off entity_id).
update public.entities set catalog_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a'
 where catalog_id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07';

-- 11) delete the 8 loser-only DUPLICATE people (their loser affiliations and
--     research cascade). Computed from affiliations, so it MUST run before the
--     loser row is deleted below.
delete from public.catalog_people
 where id in (select person_id from public.catalog_person_affiliations where entity_id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07'
              except
              select person_id from public.catalog_person_affiliations where entity_id = '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a');

-- 12) delete the loser row. Its remaining affiliations (the 9 shared) cascade;
--     no catalog_people points at it any more, so nothing is orphaned.
delete from public.catalog_entities where id = 'c287e87e-cae5-432c-816b-1cf0a26f4b07';

-- 13) audit.
insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
values (null, 'catalog_merge', 'catalog_entity', '9bdf1bc0-a068-491e-93d1-8c5b4c651d8a',
        jsonb_build_object('prompt', '884',
          'mergedFrom', 'c287e87e-cae5-432c-816b-1cf0a26f4b07',
          'reason', 'IBB Ventures imported twice (backfill_entities 27 Jul vs pipeline_auto 1 Sep)',
          'keptNameWebsiteFrom', 'keeper', 'keyPeopleEmailFrom', 'loser',
          'duplicatePeopleMergedByName', 8, 'finalPeople', 17));
