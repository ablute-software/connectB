-- Prompt 648 — the 00:05 snapshot was going to write NULL forever in 8 of
-- the 21 series.
--
-- 644's catalog_metrics_compute gates the eight date-less metrics
-- (entities_imported, entities_imported_pending, entities_with_email,
-- entities_confirmed_contact, entities_countries, people_with_linkedin,
-- people_with_hook, people_hook_human) on v_today := p_day >= current_date:
-- for any earlier day they are NULL, because the past state of a series that
-- carries no date cannot be reconstructed and a zero there would be a lie.
-- That is right for the backfill. It is wrong for the cron, which runs at
-- 00:05 asking for current_date - 1 — so every night it would write NULL for
-- exactly these eight, and the chart would say "no data before <date>"
-- forever while the cards (which read current_date) show numbers the curve
-- never has. The 9 Sep row the backfill wrote at 01:05 already proves it:
-- those eight are NULL, and that is what the cron would write for 10 Sep.
--
-- The fix (644 §2 as the verifier framed it): at 00:05 the current state IS
-- yesterday's close, five minutes away. So the eight gate on
-- v_closeable := p_day >= current_date - 1 instead — yesterday and today get
-- the live value, every earlier day stays NULL. The value expressions are
-- unchanged: each already counts over the ent/ppl CTEs bounded by
-- v_end = (p_day + 1), so for p_day = yesterday they naturally read the set
-- as it stood at end-of-yesterday, not merely "now". catalog_metrics_compute
-- (current_date) is untouched, so the cards read exactly as before, and the
-- real past (p_day < current_date - 1) is still NULL. entities_enriched keeps
-- v_today: it has a date (enriched_at) and reconstructs the past on its own;
-- v_today there is only the shortcut for today.

create or replace function public.catalog_metrics_compute(p_day date default current_date)
returns table (metric text, value numeric)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_start timestamptz := p_day::timestamptz;
  v_end   timestamptz := (p_day + 1)::timestamptz;
  v_today boolean := p_day >= current_date;
  -- Prompt 648 — "yesterday" at 00:05 is the close of the day just ended, so
  -- the date-less series are answerable for it; anything earlier is not.
  v_closeable boolean := p_day >= current_date - 1;
begin
  if current_user not in ('postgres', 'service_role') and auth.role() is distinct from 'service_role' and not public.is_platform_admin() then
    raise exception 'catalog_metrics_compute: platform admin only';
  end if;

  return query
  with ent as (
    select e.id, e.verification_status, e.verified_at, e.created_at, e.source, e.enrichment_status, e.enriched_at,
           e.email, e.hq_country, e.source_entity_id
      from catalog_entities e
     where e.catalog_status <> 'demo' and coalesce(e.is_test, false) = false and e.created_at < v_end
  ),
  ent_person as (
    select a.entity_id from catalog_person_affiliations a where a.created_at < v_end group by a.entity_id
  ),
  ppl as (
    select p.id, p.linkedin_url, r.hook, r.verified_fields
      from catalog_people p
      join ent on ent.id = p.entity_id
      left join catalog_people_research r on r.person_id = p.id
     where p.created_at < v_end
  ),
  jobs as (
    select j.* from enrichment_jobs j where j.finished_at >= v_start and j.finished_at < v_end
  ),
  agg as (
    select
      (select count(*) from ent)::numeric as entities_total,
      (select count(*) from ent where verification_status = 'verified' and coalesce(verified_at, created_at) < v_end)::numeric as entities_verified,
      (case when v_closeable then (select count(*) from ent where source = 'verified_import') end)::numeric as entities_imported,
      (case when v_closeable then (select count(*) from ent where source = 'verified_import' and enrichment_status = 'pending') end)::numeric as entities_imported_pending,
      (case when v_closeable then (select count(*) from ent where email is not null) end)::numeric as entities_with_email,
      (select count(*) from ent where exists (select 1 from ent_person x where x.entity_id = ent.id))::numeric as entities_with_person,
      (case when v_closeable then (select count(*) from ent where email is not null or exists (select 1 from ent_person x where x.entity_id = ent.id)) end)::numeric as entities_confirmed_contact,
      (case when v_closeable then (select count(distinct hq_country) from ent where hq_country is not null) end)::numeric as entities_countries,
      (select count(*) from ent where enrichment_status = 'enriched' and (v_today or enriched_at < v_end))::numeric as entities_enriched,
      (select count(*) from ent where source_entity_id is not null)::numeric as entities_from_backfill,
      (select count(*) from ppl)::numeric as people_total,
      (case when v_closeable then (select count(*) from ppl where linkedin_url is not null) end)::numeric as people_with_linkedin,
      (case when v_closeable then (select count(*) from ppl where coalesce(btrim(hook), '') <> '') end)::numeric as people_with_hook,
      (case when v_closeable then (select count(*) from ppl where verified_fields ->> 'hook' in ('verified_by_admin', 'verified_by_person', 'verified_by_startups')) end)::numeric as people_hook_human,
      (select count(*) from contributions c where c.created_at < v_end and (c.status = 'submitted' or (c.reviewed_at is not null and c.reviewed_at >= v_end)))::numeric as contributions_submitted,
      (select count(*) from contributions c where c.status = 'verified' and coalesce(c.reviewed_at, c.created_at) < v_end)::numeric as contributions_verified_cum,
      (select coalesce(sum(cost_eur), 0) from jobs where target_type = 'entity')::numeric as enrichment_cost_entity_eur,
      (select coalesce(sum(cost_eur), 0) from jobs where target_type = 'person')::numeric as enrichment_cost_person_eur,
      (select count(*) from jobs where status = 'done')::numeric as enrichment_jobs_done,
      (select count(*) from jobs where status = 'done' and (outcome ->> 'hook_written')::boolean)::numeric as enrichment_hooks_written
  )
  select m.metric, m.value from agg, lateral (values
    ('entities_total', agg.entities_total),
    ('entities_verified', agg.entities_verified),
    ('entities_imported', agg.entities_imported),
    ('entities_imported_pending', agg.entities_imported_pending),
    ('entities_with_email', agg.entities_with_email),
    ('entities_with_person', agg.entities_with_person),
    ('entities_confirmed_contact', agg.entities_confirmed_contact),
    ('entities_countries', agg.entities_countries),
    ('entities_enriched', agg.entities_enriched),
    ('entities_from_backfill', agg.entities_from_backfill),
    ('people_total', agg.people_total),
    ('people_with_linkedin', agg.people_with_linkedin),
    ('people_with_hook', agg.people_with_hook),
    ('people_hook_human', agg.people_hook_human),
    ('contributions_submitted', agg.contributions_submitted),
    ('contributions_verified_cum', agg.contributions_verified_cum),
    ('enrichment_cost_entity_eur', round(agg.enrichment_cost_entity_eur, 5)),
    ('enrichment_cost_person_eur', round(agg.enrichment_cost_person_eur, 5)),
    ('enrichment_jobs_done', agg.enrichment_jobs_done),
    ('enrichment_hooks_written', agg.enrichment_hooks_written),
    ('enrichment_cost_per_hook_eur', case when agg.enrichment_hooks_written > 0 then round(agg.enrichment_cost_person_eur / agg.enrichment_hooks_written, 4) end)
  ) as m(metric, value);
end $fn$;

revoke all on function public.catalog_metrics_compute(date) from public, anon;
grant execute on function public.catalog_metrics_compute(date) to authenticated, service_role;

comment on function public.catalog_metrics_compute(date) is
  'Prompt 644 §2.1 / 648 — the one definition of the catalogue metrics, as of the end of p_day (now for today). Series without a date of their own are answerable for today and for yesterday (the cron closes yesterday at 00:05) and null for any earlier day. Read by the Catalog stats cards, the daily snapshot and the chart.';

-- Prompt 648 §2 — re-close 9 Sep TODAY, while it is still current_date - 1,
-- so the first point of these eight series is real instead of the NULL the
-- backfill wrote. p_audit => false: this is a correction of an existing row,
-- not a new backfill event worth its own audit line. Left until tomorrow, 9
-- Sep would stay NULL for good — acceptable, but avoidable, so it runs here.
do $$
begin
  if current_date = date '2026-09-10' then
    perform public.catalog_metrics_snapshot(date '2026-09-09', false);
  end if;
end $$;
