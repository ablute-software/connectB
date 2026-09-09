-- Prompt 633 §2.3.c — a person with no rank is not junior. They are unknown.
--
-- The band filter I wrote in 627 §5 (and defended, correctly, against buying
-- hooks for Office Managers) had a second effect I did not measure: it
-- treated null exactly like rank 9. Of 2 211 people at available entities,
-- 884 were null-ranked and every one of them was excluded — a CEO the
-- classifier could not read sat behind an Analyst it could. With the
-- classifier widened (previous file) most of those 884 now have a real rank;
-- what is left null is genuinely ambiguous (Member, Manager, Director,
-- committee names), and the right place for genuinely ambiguous is the END
-- of the queue, not outside it.
--
-- So: rank 9 stays excluded (that exclusion is deliberate and unchanged);
-- null is accepted, is exempt from the firm's band (a band cannot be applied
-- to an unknown), and sorts as 5 — behind every Analyst, ahead of nothing.
-- The bio-only predicate from 630 §3.4(a) is kept as-is; that is a separate
-- decision and is Nuno's.

create or replace function public.enqueue_cold_person_batch(p_batch_size integer default 50)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_inserted int := 0;
  v_id uuid;
  v_prior_claims text;
begin
  if coalesce(p_batch_size, 50) > 50 then
    raise exception 'enqueue_cold_person_batch: batch size above 50 needs a deliberate decision, not a parameter';
  end if;

  v_prior_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  begin
    for v_id in
      with candidate_people as (
        select p.id, p.entity_id, p.created_at
          from public.catalog_people p
          join public.catalog_entities c on c.id = p.entity_id
         where c.verification_status = 'verified'
           and coalesce(c.moderation_status, 'active') = 'active'
           and coalesce(c.is_test, false) = false
           and coalesce(p.do_not_contact, false) = false
           and exists (
             select 1 from public.catalog_people_research r
              where r.person_id = p.id and coalesce(btrim(r.bio_raw), '') <> ''
           )
           and not exists (
             select 1 from public.catalog_person_suppressions s
              where (s.linkedin_url_normalized is not null
                     and s.linkedin_url_normalized = p.linkedin_url_normalized)
                 or (s.name_key is not null
                     and s.entity_id is not distinct from p.entity_id
                     and s.name_key = public.catalog_person_name_key(p.full_name))
           )
           and (p.hook_status = 'to_research'
                or (p.enrichment_stale_after is not null and p.enrichment_stale_after < now()))
           and not exists (
             select 1 from public.enrichment_jobs j
              where j.target_type = 'person' and j.target_id = p.id
                and j.status in ('queued', 'running', 'done')
                and j.created_at > now() - interval '90 days'
           )
      ),
      roster_min_rank as (
        select cpa.entity_id,
               min(cpa.seniority_rank) filter (where cpa.seniority_rank is not null and cpa.seniority_rank <> 9) as min_rank
          from public.catalog_person_affiliations cpa
         group by cpa.entity_id
      ),
      banded as (
        select cp.id, cp.entity_id, cp.created_at, cpa.seniority_rank
          from candidate_people cp
          join public.catalog_person_affiliations cpa
            on cpa.person_id = cp.id and cpa.is_primary = true
          left join roster_min_rank r on r.entity_id = cp.entity_id
         where cpa.seniority_rank is distinct from 9
           -- Prompt 633 §2.3.c: null passes; a known rank keeps 583 §C's band.
           and (cpa.seniority_rank is null
                or cpa.seniority_rank <= (case
                     when coalesce(r.min_rank, 999) <= 2 then 2
                     when r.min_rank = 3 then 3
                     else 4
                   end))
      ),
      scoring_orgs as (
        select o.id from public.orgs o
         where o.closed_at is null
           and coalesce(o.is_test, false) = false
           and coalesce(cardinality(o.sectors), 0) > 0
      ),
      entity_demand as (
        select e.entity_id,
               coalesce(max(public.catalog_match_score(o.id, e.entity_id)), 0) as best_score
          from (select distinct entity_id from banded) e
          cross join scoring_orgs o
         group by e.entity_id
      ),
      delivery_demand as (
        select cd.catalog_id, count(distinct cd.org_id) as n
          from public.catalog_deliveries cd
          join public.orgs o on o.id = cd.org_id
         where coalesce(o.is_internal, false) = false and coalesce(o.is_test, false) = false
         group by cd.catalog_id
      )
      select b.id
        from banded b
        left join entity_demand ed on ed.entity_id = b.entity_id
        left join delivery_demand dd on dd.catalog_id = b.entity_id
       order by coalesce(ed.best_score, 0) desc,
                coalesce(dd.n, 0) desc,
                coalesce(b.seniority_rank, 5) asc,
                b.created_at asc
       limit greatest(coalesce(p_batch_size, 50), 0)
    loop
      begin
        insert into public.enrichment_jobs (target_type, target_id, layer, priority, requested_by_org_id)
        values ('person', v_id, 2, 200, null);
        v_inserted := v_inserted + 1;
      exception when unique_violation then
        null;
      end;
    end loop;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
    raise;
  end;

  perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
  return v_inserted;
end;
$fn$;

revoke all on function public.enqueue_cold_person_batch(integer) from public, anon, authenticated;

comment on function public.enqueue_cold_person_batch(integer) is
  'Prompt 627 §5 / 630 §3.4(a) / 633 §2.3.c — nightly Camada 2 feeder. Bio-only until the web path is confirmed. Rank 9 excluded; unknown rank accepted and ordered last (as 5); known ranks keep Prompt 583 §C''s band.';
