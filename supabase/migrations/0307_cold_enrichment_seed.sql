-- Prompt 555 — the enrichment queue was a closed loop, not a backlog.
--
-- enrichment_jobs had exactly one source: trg_catalog_deliveries_enqueue_
-- enrichment, which fires when a row lands in catalog_deliveries. And
-- catalog_top_matches — which decides who gets delivered — only passes
-- entities that already clear the contactability floor (0301: at least one
-- affiliated person with a linkedin_url or a written hook).
--
-- So: only entities that already have contact data get delivered, and only
-- delivered entities get an enrichment job. An entity that has never been
-- enriched has no contact data, so it never passes the floor, so it is never
-- delivered, so it never gets a job. Nothing was slow; nothing could start.
--
-- Measured in production before writing this, over the universe
-- catalog_top_matches chooses from (verified, active, non-test):
--
--   enrichment_status   entities   pass the floor today
--   enriched                 92          49
--   pending                 263           0
--
-- Zero. 263 investors permanently invisible to every founder — not because
-- they are poor matches, but because they never had the chance to be enriched.
-- The queue has been empty since 2026-09-01 01:04, and the 17 deliveries made
-- since the floor was corrected all went to the same dozen already-enriched
-- names, recycled across orgs, because those 49 are the only ones that can
-- pass.
--
-- NOT A COST PROBLEM. enrichment_jobs records real spend: €0.0118 average per
-- entity. Clearing all 263 costs about €3.10. The original design — enrich
-- only what is about to be shown — was a sensible way not to spend budget on
-- the whole catalog, and in practice it stopped the catalog growing at all.
--
-- AND NOT FIXED BY LOWERING THE FLOOR. That would re-introduce exactly what
-- Prompt 552 corrected: delivering firms with nobody to contact. The floor
-- stays. What changes is that entities can now acquire contact data BEFORE
-- they need to pass it.

create or replace function public.enqueue_cold_enrichment_batch(p_batch_size int default 50)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_inserted int := 0;
  v_id uuid;
begin
  -- Hard ceiling, deliberately not a parameter the caller can raise: the
  -- constraint is the external web calls the worker makes per entity
  -- (~3.75 each), not the euros. Prompt 555 asks for 50 and for a
  -- conversation before anything larger.
  if coalesce(p_batch_size, 50) > 50 then
    raise exception 'enqueue_cold_enrichment_batch: batch size above 50 needs a deliberate decision, not a parameter';
  end if;

  for v_id in
    select c.id
      from public.catalog_entities c
     where c.verification_status = 'verified'
       and coalesce(c.moderation_status, 'active') = 'active'
       and coalesce(c.is_test, false) = false
       and (c.enrichment_status in ('pending', 'stale')
            or (c.enrichment_stale_after is not null and c.enrichment_stale_after < now()))
       -- The SAME dedup window the delivery trigger uses, so the two sources
       -- can never queue the same entity twice — including when both fire in
       -- the same cycle, because this reads the rows the trigger just wrote.
       and not exists (
         select 1 from public.enrichment_jobs j
          where j.target_type = 'entity' and j.target_id = c.id
            and j.status in ('queued', 'running', 'done')
            and j.created_at > now() - interval '90 days'
       )
     -- Oldest first: the entities that have been invisible longest go first.
     order by c.created_at
     limit greatest(coalesce(p_batch_size, 50), 0)
  loop
    begin
      insert into public.enrichment_jobs (target_type, target_id, layer, priority, requested_by_org_id)
      -- priority 200, BELOW the delivery path's 150. A founder is waiting on
      -- those; nobody is waiting on these yet. The worker claims by priority,
      -- so cold seeding can never delay a delivered row's enrichment.
      values ('entity', v_id, 1, 200, null);
      v_inserted := v_inserted + 1;
    exception when unique_violation then
      -- The partial unique index on (target_type, target_id) for active jobs.
      -- Losing this race means the row is already queued, which is the
      -- outcome we wanted anyway.
      null;
    end;
  end loop;

  return v_inserted;
end;
$function$;

revoke all on function public.enqueue_cold_enrichment_batch(int) from public, anon, authenticated;
grant execute on function public.enqueue_cold_enrichment_batch(int) to service_role;

-- Once a DAY, not every 15 minutes. This exists to unstick a 263-row history
-- gradually and then keep pace with new arrivals — about a week to clear the
-- backlog. A faster sweep would spend the whole catalog's web-call budget in
-- an afternoon for no benefit, since the worker processes one job at a time.
select cron.unschedule('enrichment_cold_seed_sweep')
 where exists (select 1 from cron.job where jobname = 'enrichment_cold_seed_sweep');

select cron.schedule(
  'enrichment_cold_seed_sweep',
  '20 3 * * *',
  $cron$select public.enqueue_cold_enrichment_batch(50);$cron$
);
