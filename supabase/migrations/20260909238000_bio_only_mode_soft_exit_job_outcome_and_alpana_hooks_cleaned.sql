-- Prompt 638 — §3.1 the bio_only mode with the soft exit, §3.3 the job records
-- what it did, §3.2 the two Alpana hooks cleaned.
--
-- §3.1. 636's bio queue failed because a job row could not say "bio only,
-- stop there": the worker's 0.6 confidence gate sent four in five down the
-- web path at €0.063 a head. `mode` is that word. And the terminal state is
-- what decides whether the mode helps or harms: a person who fails the bio
-- gate in bio_only mode must NOT become none_found — none_found plus the
-- sweep's 90-day clause would shut the door on someone the web path might
-- still serve (Indico again, self-inflicted). So the worker leaves
-- hook_status untouched, closes the job `done` with last_error =
-- 'bio_inconclusive' (or 'bio_only_no_bio'), keeps whatever bio-grounded
-- fields came out, and the sweep below reads that reason: a soft exit does
-- not exclude the person from the MIXED queue, and does exclude them from
-- the bio_only queue, which would only pay €0.003 to fail again.
--
-- §3.3 / §2. `outcome` is the run's own account of itself — path taken,
-- bio confidence, whether the bio evidence quote held, which guards fired,
-- hook written and from where, sources found and read. Cost per completed
-- job was the wrong metric (a done without a hook costs the same as a done
-- with one); cost per USEFUL hook needs this column, and 638 §2's question
-- — does low bio confidence predict an empty web? — is answered from it,
-- not from six survivors.
--
-- The bio cron stays unscheduled (236000) until the twenty mixed jobs 638
-- §3.3 asks for have been measured. The 294 `skipped` rows remain eligible.

alter table public.enrichment_jobs
  add column if not exists mode text not null default 'mixed',
  add column if not exists outcome jsonb;

alter table public.enrichment_jobs drop constraint if exists enrichment_jobs_mode_check;
alter table public.enrichment_jobs add constraint enrichment_jobs_mode_check check (mode in ('mixed', 'bio_only'));

comment on column public.enrichment_jobs.mode is
  'Prompt 638 §3.1 — mixed: bio path then web fallback; bio_only: bio path only, a failed gate closes the job done with last_error bio_inconclusive and leaves the person eligible for the mixed sweep.';
comment on column public.enrichment_jobs.outcome is
  'Prompt 638 §3.3 — what the worker did on this job: path, mode, bio_confidence, bio_hook_supported, guard_rejections[], hook_written, hook_source, sources_found, sources_read. Measure cost per useful hook from here, not per done row.';

-- Same signature as 234000: create or replace is enough, no ambiguity.
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
                and j.created_at > now() - interval '90 days'
                and (j.status in ('queued', 'running')
                     -- Prompt 638 §3.1: a bio_only job that stopped soft keeps
                     -- the person eligible for the MIXED queue; it does close
                     -- the bio_only queue, which would only fail again.
                     or (j.status = 'done'
                         and (p_path = 'bio_only'
                              or coalesce(j.last_error, '') not in ('bio_inconclusive', 'bio_only_no_bio'))))
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
        -- Prompt 638 §3.1: the queue's path travels with the job.
        insert into public.enrichment_jobs (target_type, target_id, layer, priority, requested_by_org_id, mode)
        values ('person', v_id, 2, 200, null, p_path);
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
  'Prompt 627 §5 / 633 §2.3.c / 634 §3.5 / 636 §1 / 638 §3.1 — nightly Camada 2 feeder. p_path bio_only (cap 300, worker stops after the bio path, soft exit) or mixed (cap 50). A bio_inconclusive job does not exclude the person from the mixed queue.';

-- §3.2 — the two Alpana hooks, the same treatment as Bürk: research ran and
-- produced nothing usable, so none_found, not to_research.
update public.catalog_people_research
   set hook = null, hook_source = null, updated_at = now()
 where person_id in ('a0d5c30a-3a97-431c-9b1b-ec0dba15d413', '236cb31e-9d23-481e-8816-053f8840561a')
   and coalesce(hook, '') ilike 'Alpana Ventures%';

update public.catalog_people
   set hook_status = 'none_found'
 where id in ('a0d5c30a-3a97-431c-9b1b-ec0dba15d413', '236cb31e-9d23-481e-8816-053f8840561a');

insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
values
  (null, 'hook_about_fund_not_person', 'catalog_person', 'a0d5c30a-3a97-431c-9b1b-ec0dba15d413',
   jsonb_build_object('path', 'manual', 'entity_mention', 'alpana ventures',
                      'hook', 'Alpana Ventures focuses on bridging Swiss and European startups to Silicon Valley and Asia',
                      'note', 'Prompt 638 §3.2 — fund thesis written as a person hook; guard added in the worker')),
  (null, 'hook_about_fund_not_person', 'catalog_person', '236cb31e-9d23-481e-8816-053f8840561a',
   jsonb_build_object('path', 'manual', 'entity_mention', 'alpana ventures',
                      'hook', 'Alpana Ventures employs a unique early-stage investment model combining capital deployment',
                      'note', 'Prompt 638 §3.2 — fund thesis written as a person hook; guard added in the worker'));
