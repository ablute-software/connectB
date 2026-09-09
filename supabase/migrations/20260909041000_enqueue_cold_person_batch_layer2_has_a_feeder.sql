-- Prompt 627 §5 — Camada 2 had no one feeding it.
--
-- Measured 2026-09-09: 3 534 of 3 547 people sit at hook_status
-- 'to_research', and `enrichment_jobs` has 21 layer-2 rows in its entire
-- history — every one of them queued by hand. `enqueue_cold_enrichment_batch`
-- runs at 03:20 nightly and inserts `target_type='entity', layer=1` only.
-- There was never a person equivalent. This is it.
--
-- WHY THIS IS THE ROOT OF §4. A fund is dropped from catalog_top_matches when
-- no one at it has a LinkedIn URL or a hook. Nobody has a hook because nothing
-- has ever asked for one at scale. §4 loosens the gate; this fills the thing
-- the gate was measuring.
--
-- ONE DELIBERATE DEVIATION FROM §5.1, AND IT IS ABOUT MONEY.
-- §5.1 lists the seniority rank as an ordering criterion only. I made it an
-- ELIGIBILITY criterion, reusing verbatim the band that Prompt 583 §C already
-- established and that `catalog_layer2_candidates` already applies in the
-- back-office panel:
--
--     rank is not null, rank <> 9, and rank <= the firm's own best band
--
-- 583 §C exists because "the campaign researched a firm's Office Manager and
-- Executive Assistant in the same pass as its Founding Partner, at the same
-- €0.30+ cost each". Ordering alone does not prevent that — it only defers
-- it, and a nightly sweep with no end runs out of partners and starts buying
-- Workshop Coordinators. Two different definitions of "who is worth
-- researching", one in the panel and one in the cron, is also exactly the
-- split-semantics problem §3.1 of this same prompt objects to.
--
-- What it costs: the queue is 640 people rather than 2 196 — 13 nights at 50
-- a night rather than 44 — and the 1 556 excluded are unranked or rank-9.
-- If Nuno wants them, the band is one line here and one line in 0332, and it
-- should change in both or neither.
--
-- PRIORITY is §5.1's: the best catalog_match_score this person's firm reaches
-- against any real (non-internal, non-test, open) org. A person at a fund no
-- founder would ever be shown is worth less than a person at a fund three
-- founders are looking at, and the score is what the product already means by
-- that. Delivery demand breaks ties, then seniority, then age.

create or replace function public.enqueue_cold_person_batch(p_batch_size integer default 50)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_inserted int := 0;
  v_id uuid;
begin
  if coalesce(p_batch_size, 50) > 50 then
    raise exception 'enqueue_cold_person_batch: batch size above 50 needs a deliberate decision, not a parameter';
  end if;

  for v_id in
    with candidate_people as (
        select p.id, p.entity_id, p.created_at
          from public.catalog_people p
          join public.catalog_entities c on c.id = p.entity_id
         where c.verification_status = 'verified'
           and coalesce(c.moderation_status, 'active') = 'active'
           and coalesce(c.is_test, false) = false
           and coalesce(p.do_not_contact, false) = false
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
         where cpa.seniority_rank is not null
           and cpa.seniority_rank <> 9
           and cpa.seniority_rank <= (case
                 when coalesce(r.min_rank, 999) <= 2 then 2
                 when r.min_rank = 3 then 3
                 else 4
               end)
      ),
      real_orgs as (
        select o.id from public.orgs o
         where o.closed_at is null
           and coalesce(o.is_test, false) = false
           and coalesce(o.is_internal, false) = false
      ),
      entity_demand as (
        select e.entity_id,
               coalesce(max(public.catalog_match_score(o.id, e.entity_id)), 0) as best_score
          from (select distinct entity_id from banded) e
          cross join real_orgs o
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
                b.seniority_rank asc,
                b.created_at asc
       limit greatest(coalesce(p_batch_size, 50), 0)
    loop
      begin
        insert into public.enrichment_jobs (target_type, target_id, layer, priority, requested_by_org_id)
        values ('person', v_id, 2, 200, null);
        v_inserted := v_inserted + 1;
      exception when unique_violation then
        -- enrichment_jobs_one_active_per_target — already queued or running.
        null;
      end;
    end loop;
  return v_inserted;
end;
$fn$;

revoke all on function public.enqueue_cold_person_batch(integer) from public, anon, authenticated;

comment on function public.enqueue_cold_person_batch(integer) is
  'Prompt 627 §5 — nightly Camada 2 feeder. Sibling of enqueue_cold_enrichment_batch. Eligibility uses Prompt 583 §C''s seniority band so the sweep never buys a hook for an Office Manager; priority is the best catalog_match_score the person''s firm reaches against any real org.';
