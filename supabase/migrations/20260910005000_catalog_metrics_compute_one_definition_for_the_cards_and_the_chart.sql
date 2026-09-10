-- Prompt 644 §2.1 — one function is the only definition of the catalogue
-- metrics. The seven "Catalog stats" cards were live (no cache) and three of
-- them said one thing and counted another: "Total 763 — 3 demo excluded"
-- counted the demo rows; "Verified — confirmed contact" counted
-- catalog_status = verified, which since 633 means "delivered to at least
-- one org"; "Imported — pending enrichment" showed two test leftovers and
-- hid the four developer imports of 640. The route had its own seven
-- queries; the chart would have had seven more. Now both read this
-- function, so a card and a curve cannot disagree.
--
-- catalog_metrics_compute(p_day) is the state at the END of p_day (for today:
-- now). Series that carry a date are reconstructed for past days from
-- created_at / verified_at / enriched_at / reviewed_at / finished_at; series
-- that do not (e-mail, LinkedIn, hooks, countries, imports pending) are NULL
-- for any day before today — a zero there would be a lie. The labels,
-- definitions and "reconstructible from" dates live in
-- catalog_metrics_definitions(), read by the chart's tooltip.
--
-- Demo = catalog_status = 'demo'; test = is_test. Both excluded everywhere.
-- Cost is summed over every job that finished that day, whatever its
-- status: money spent on a failed job is still money spent.

create or replace function public.catalog_metrics_definitions()
returns table (metric text, label text, definition text, reconstructible_from date)
language sql immutable as $$
  select * from (values
    ('entities_total',              'Entities in catalog',                 'catalog_entities that are not demo and not is_test, created on or before the day', '2026-07-21'::date),
    ('entities_verified',           'Verified',                            'of those, verification_status = verified by the day — since 633 this means delivered to at least one org or admin-verified, not "contact confirmed"', '2026-07-20'::date),
    ('entities_imported',           'Developer imports',                   'source = verified_import (the 640 base and later files)', null::date),
    ('entities_imported_pending',   'Developer imports pending enrichment', 'source = verified_import and enrichment_status = pending', null::date),
    ('entities_with_email',         'With direct email',                   'email is not null', null::date),
    ('entities_with_person',        'With named person',                   'at least one catalog_person_affiliations row created by the day (people, not the key_people text)', '2026-08-08'::date),
    ('entities_confirmed_contact',  'With confirmed contact',              'email or a named person — the number of funds a founder can actually reach', null::date),
    ('entities_countries',          'Countries',                           'count(distinct hq_country)', null::date),
    ('entities_enriched',           'Enriched (Layer 1 done)',             'enrichment_status = enriched, by enriched_at', '2026-08-08'::date),
    ('entities_from_backfill',      'From backfill',                       'source_entity_id is not null (provenance)', '2026-07-21'::date),
    ('people_total',                'People in catalog',                   'catalog_people whose entity is not demo/test, created on or before the day', '2026-08-08'::date),
    ('people_with_linkedin',        'People with LinkedIn',                'linkedin_url is not null', null::date),
    ('people_with_hook',            'People with a hook',                  'catalog_people_research.hook is not empty', null::date),
    ('people_hook_human',           'Human-verified hooks',                'verified_fields.hook in (verified_by_admin, verified_by_person, verified_by_startups)', null::date),
    ('contributions_submitted',     'Contributions queue',                 'contributions still submitted at the end of the day', '2026-07-22'::date),
    ('contributions_verified_cum',  'Contributions verified (cumulative)', 'contributions verified on or before the day', '2026-07-22'::date),
    ('enrichment_cost_entity_eur',  'Enrichment cost — entities (€/day)',  'sum of enrichment_jobs.cost_eur for target_type = entity finished that day, any status', '2026-08-08'::date),
    ('enrichment_cost_person_eur',  'Enrichment cost — people (€/day)',    'sum of enrichment_jobs.cost_eur for target_type = person finished that day, any status', '2026-08-08'::date),
    ('enrichment_jobs_done',        'Enrichment jobs done',                'jobs with status done that finished that day', '2026-08-08'::date),
    ('enrichment_hooks_written',    'Hooks written by the worker',         'jobs done that day with outcome.hook_written = true (outcome exists since worker v32, 2026-09-09)', '2026-09-09'::date),
    ('enrichment_cost_per_hook_eur','€ per hook written',                  'enrichment_cost_person_eur / enrichment_hooks_written; null when no hook was written — the KPI of 638', '2026-09-09'::date)
  ) as t(metric, label, definition, reconstructible_from);
$$;
revoke all on function public.catalog_metrics_definitions() from public, anon;
grant execute on function public.catalog_metrics_definitions() to authenticated, service_role;

create or replace function public.catalog_metrics_compute(p_day date default current_date)
returns table (metric text, value numeric)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_start timestamptz := p_day::timestamptz;
  v_end   timestamptz := (p_day + 1)::timestamptz;
  v_today boolean := p_day >= current_date;
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
      (case when v_today then (select count(*) from ent where source = 'verified_import') end)::numeric as entities_imported,
      (case when v_today then (select count(*) from ent where source = 'verified_import' and enrichment_status = 'pending') end)::numeric as entities_imported_pending,
      (case when v_today then (select count(*) from ent where email is not null) end)::numeric as entities_with_email,
      (select count(*) from ent where exists (select 1 from ent_person x where x.entity_id = ent.id))::numeric as entities_with_person,
      (case when v_today then (select count(*) from ent where email is not null or exists (select 1 from ent_person x where x.entity_id = ent.id)) end)::numeric as entities_confirmed_contact,
      (case when v_today then (select count(distinct hq_country) from ent where hq_country is not null) end)::numeric as entities_countries,
      (select count(*) from ent where enrichment_status = 'enriched' and (v_today or enriched_at < v_end))::numeric as entities_enriched,
      (select count(*) from ent where source_entity_id is not null)::numeric as entities_from_backfill,
      (select count(*) from ppl)::numeric as people_total,
      (case when v_today then (select count(*) from ppl where linkedin_url is not null) end)::numeric as people_with_linkedin,
      (case when v_today then (select count(*) from ppl where coalesce(btrim(hook), '') <> '') end)::numeric as people_with_hook,
      (case when v_today then (select count(*) from ppl where verified_fields ->> 'hook' in ('verified_by_admin', 'verified_by_person', 'verified_by_startups')) end)::numeric as people_hook_human,
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
  'Prompt 644 §2.1 — the one definition of the catalogue metrics, as of the end of p_day (now for today). Series without a date are null for past days. Read by the Catalog stats cards, the daily snapshot and the chart.';
