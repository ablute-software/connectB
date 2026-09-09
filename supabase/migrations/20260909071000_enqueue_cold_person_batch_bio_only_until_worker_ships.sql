-- Prompt 630 §3.4 (a) and §4.1 — two edits to the sweep, both because
-- production disagreed with the plan.
--
-- §3.4 (a) — BIO-ONLY UNTIL THE WORKER IS PUBLISHED. The Camada 2 web path
-- has never completed on claude-haiku-4-5: every person without a bio fails
-- three times with
--
--   anthropic_400 ... 'claude-haiku-4-5-20251001' does not support
--   programmatic tool calling. The following tools have `allowed_callers`
--   that require it: web_search.
--
-- Philippe Hayat — the person my own verification enqueued — is one of the
-- three failures on record. The fix is one field at two sites in the worker
-- (allowed_callers: ['direct']), but the worker is an Edge Function and the
-- version running is the one from before this week's commits. Until the
-- corrected build is live, enqueueing someone without a bio buys three
-- guaranteed 400s and nothing else. The bio path works and costs €0.003.
--
-- ONE CORRECTION TO §1 OF THAT PROMPT, from this function's own text: the
-- 90-day clause excludes queued/running/done, NOT failed — so a failed person
-- is not "locked for 90 days", they are re-enqueued the next night and fail
-- again. The queue would have advanced by ~29 a night and spent ~21 slots a
-- night re-failing the same people. Not locked; wasteful. This filter makes
-- both readings moot.
--
-- Reversible in one line: delete the bio_raw predicate once the worker ships
-- and a real run against Mathias Ockenfels / Jan-Hendrik Bürk has returned a
-- cost. That run is the first measurement the web path on haiku will ever
-- have had.
--
-- §4.1 — real_orgs HAD EXACTLY ONE ROW. `not is_internal` left a single org:
-- Wisify Tech Solutions, registered yesterday, sectors = [], stage series_a.
-- So the queue's entire priority order was decided by the fit against an org
-- that has declared no preference — and an org with no sectors gives every
-- entity the same +15, which is no order at all. ablute_ (6 sectors, 761
-- entities in its pipeline, 229 real interactions) was excluded for being
-- flagged internal.
--
-- The test is not internal/external. It is whether the org can EXPRESS a fit:
-- an org with no declared sectors has no signal to give and is dropped from
-- the score set whatever its flag; an internal org with a real pipeline is
-- the best signal there is today. The is_internal exclusion stays on
-- delivery_demand, where Prompt 583 §C put it for a different reason (a QA
-- org's own pipeline entry inflating a firm's apparent DEMAND count) — that is
-- a count, this is a fit. When Wisify fills in its sectors it joins the score
-- set with no further change here.

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

  -- See 20260909041500: pg_cron has no JWT and catalog_match_score guards on
  -- a service_role claim. Transaction-local, restored on both exits.
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
           -- Prompt 630 §3.4 (a): bio path only, until the worker that can
           -- run the web path is the one that is deployed. REMOVE THIS
           -- PREDICATE when that is true and measured.
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
         where cpa.seniority_rank is not null
           and cpa.seniority_rank <> 9
           and cpa.seniority_rank <= (case
                 when coalesce(r.min_rank, 999) <= 2 then 2
                 when r.min_rank = 3 then 3
                 else 4
               end)
      ),
      -- Prompt 630 §4.1: any open, non-test org that has declared sectors.
      -- Not `not is_internal` — see the header.
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
                b.seniority_rank asc,
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
  'Prompt 627 §5 / 630 §3.4(a) — nightly Camada 2 feeder. BIO-ONLY until the worker build with allowed_callers=[direct] on web_search is deployed and measured. Priority: best catalog_match_score across open non-test orgs that declare sectors (630 §4.1).';
