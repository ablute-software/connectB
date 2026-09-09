-- Prompt 627 §5 — the sweep I had just written would have raised every night
-- and enqueued nothing. This is the fix, kept as its own migration because
-- that is what happened and the ledger says so.
--
-- WHAT WENT WRONG. `catalog_match_score` — which §5.1 asks the sweep to use
-- for priority — opens with:
--
--   if auth.role() is distinct from 'service_role'
--      and not (is_org_member(p_org_id) or is_platform_admin())
--   then raise exception 'not authorized';
--
-- pg_cron runs as `postgres` with no JWT at all. `auth.role()` is null and
-- `auth.uid()` is null, so both membership checks are false and the guard
-- fires. SECURITY DEFINER does NOT help: it changes the database role, and
-- this guard reads a REQUEST CLAIM, not a role.
--
-- Measured before shipping rather than reasoned about afterwards. This
-- session runs as `postgres` with `auth.role()` null — the same context cron
-- uses (`cron.job.username = 'postgres'`) — and calling the function returned
-- `P0001: not authorized ... PL/pgSQL function enqueue_cold_person_batch
-- line 10 at FOR over SELECT rows`. Scheduling it without that call would
-- have produced a cron job that was installed, enabled, and inert, and a
-- report claiming 640 people were unblocked while nothing had moved. That is
-- the Prompt 618 failure exactly, and it is why this got a real call before
-- it got a schedule.
--
-- THE FIX, AND WHY IT IS NOT A WIDENING. The sweep declares what it is: a
-- nightly cross-org prioritisation that belongs to no single org and has no
-- user behind it — precisely the case the 'service_role' branch of that guard
-- exists for. `is_local = true` scopes the claim to this transaction, the
-- prior value is captured and restored on both the normal and the error path,
-- and the function is revoked from public/anon/authenticated, so the only
-- callers that can reach the line are `postgres` and `service_role`, both of
-- which can already read every org.
--
-- The alternative was to relax the guard inside `catalog_match_score`. That
-- would widen it for every caller, and §7 of this prompt asks for §3 to be
-- the only thing touching that function so the two changes cannot collide
-- mid-migration.
--
-- Verified after applying: `enqueue_cold_person_batch(1)` returned 1 in 4.05s
-- (about 2 000 score calls across 6 real orgs) and picked Philippe Hayat,
-- Managing Partner at Serena — rank 1 at a high-scoring firm, which is the
-- whole point of the ordering. `request.jwt.claims` reads back empty after
-- the call.

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
           -- Never spend on somebody who asked not to be here.
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
      -- Prompt 583 §C's band, verbatim: never buy a hook for an Office
      -- Manager at the same price as one for a Founding Partner.
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
      -- Scored once per FIRM, not once per person: a firm with eleven
      -- eligible people would otherwise be scored eleven times for one answer.
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
  'Prompt 627 §5 — nightly Camada 2 feeder. Sibling of enqueue_cold_enrichment_batch. Eligibility uses Prompt 583 §C''s seniority band so the sweep never buys a hook for an Office Manager; priority is the best catalog_match_score the firm reaches against any real org. Declares service_role claims because pg_cron has no JWT and catalog_match_score guards on one.';

-- 03:40, twenty minutes after the entity sweep at 03:20, so the two never
-- compete for the same nightly cost ceiling in the same minute (§5.2).
select cron.schedule('enrichment_cold_person_sweep', '40 3 * * *',
  $cron$select public.enqueue_cold_person_batch(50);$cron$);
