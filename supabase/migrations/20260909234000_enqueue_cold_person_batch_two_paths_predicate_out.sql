-- Prompt 634 §3.5 + Prompt 636 §1 — the bio-only predicate comes out, and the
-- sweep learns which of two queues it is filling.
--
-- 634 §3.5: the predicate (630 §3.4 (a)) existed because the web path could
-- not run. It can now (measured, €0.075–€0.081), and the Article 9 net plus
-- the kill-word check are in the worker (version 29, checksum-verified
-- before this file was applied — the order matters: a sweep that enqueues
-- people without a bio against a worker without the net is exactly what
-- produced the Bürk background). So the predicate goes.
--
-- 636 §1: the promotion changed the arithmetic. With bio: 1 624 people at
-- ~€0.003 = under €5 for the whole catalogue, no web call, no Article 9
-- exposure. Without bio: 1 907 at ~€0.078 ≈ €149. The 50-a-night cap exists
-- to bound cost, and the bio path has almost none to bound — so the cheap
-- path gets its own queue with a cap of 300 (~€0.90 a night, six nights for
-- the 1 624), and the mixed queue keeps 50. Two cron jobs, ten minutes apart.
--
-- The real ceiling is not cost but throughput: the worker runs every 15
-- minutes with BATCH_SIZE 5 — 480 jobs a day. 350 a night fits; it just
-- takes most of the day to drain, which is fine.
--
-- The 1-argument signature is DROPPED, not left beside the new one: a call
-- with one argument would otherwise match both (the second has a default)
-- and fail as "function is not unique" — at 03:40, from cron, silently.

drop function if exists public.enqueue_cold_person_batch(integer);

create or replace function public.enqueue_cold_person_batch(p_batch_size integer default 50, p_path text default 'mixed')
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_inserted int := 0;
  v_id uuid;
  v_prior_claims text;
  v_cap int;
begin
  if p_path not in ('mixed', 'bio_only') then
    raise exception 'enqueue_cold_person_batch: p_path must be mixed or bio_only, got %', p_path;
  end if;
  -- Two ceilings, one reason each: mixed bounds web-path spend; bio_only
  -- bounds nothing expensive, so it is bounded by daily throughput instead.
  v_cap := case p_path when 'bio_only' then 300 else 50 end;
  if coalesce(p_batch_size, v_cap) > v_cap then
    raise exception 'enqueue_cold_person_batch: batch size above % for path % needs a deliberate decision, not a parameter', v_cap, p_path;
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
           -- Prompt 636 §1: only the bio_only queue is restricted by bio.
           and (p_path = 'mixed' or exists (
             select 1 from public.catalog_people_research r
              where r.person_id = p.id and coalesce(btrim(r.bio_raw), '') <> ''
           ))
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
       limit greatest(coalesce(p_batch_size, v_cap), 0)
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

revoke all on function public.enqueue_cold_person_batch(integer, text) from public, anon, authenticated;

comment on function public.enqueue_cold_person_batch(integer, text) is
  'Prompt 627 §5 / 633 §2.3.c / 634 §3.5 / 636 §1 — nightly Camada 2 feeder. p_path bio_only (cap 300, no web spend) or mixed (cap 50). Rank 9 excluded; unknown rank ordered last; known ranks keep 583 §C''s band.';

-- Two queues, ten minutes apart, after the entity sweep at 03:20.
select cron.unschedule('enrichment_cold_person_sweep');
select cron.schedule('enrichment_cold_person_bio_sweep', '35 3 * * *',
  $cron$select public.enqueue_cold_person_batch(300, 'bio_only');$cron$);
select cron.schedule('enrichment_cold_person_sweep', '45 3 * * *',
  $cron$select public.enqueue_cold_person_batch(50, 'mixed');$cron$);
