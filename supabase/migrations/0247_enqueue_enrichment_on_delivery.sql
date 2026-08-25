-- Prompt 380 §A — enrichment enqueue moves to the DELIVERY, not the caller.
--
-- The problem, measured: 413 catalog entities are sitting in founders'
-- pipelines, delivered, never enriched, and never even ENQUEUED. The queue
-- itself is healthy (cron alive, last runs succeeded, 0 rows queued — the
-- worker's `processed: 0` was honest); the gap was entirely upstream. Three
-- live paths create a `catalog_deliveries` row and only ONE of them enqueues:
--
--   1. unlockPack (store-supabase.tsx) — the only call site of
--      triggerEnrichmentEnqueue in the whole codebase, and even that is a
--      fire-and-forget fetch from the browser with an empty .catch(), so a
--      closed tab loses the enqueue with no trace.
--   2. the investor-interest DB function (matchdeal_record_interest_
--      notification) — inserts a delivery, enqueues nothing.
--   3. /api/market-data/bridge/add-target (Prompt 373 §C, one day old) —
--      inserts a delivery, enqueues nothing.
--
-- Plus the 2026-07-27 bulk SQL seed, which is where 410 of the 413 came
-- from. Patching each caller would leave path #4 to be written next month
-- with the same hole, so the enqueue moves to the one thing all of them do:
-- insert the delivery row.
--
-- SECURITY DEFINER is load-bearing, not decoration: enrichment_jobs is
-- `is_platform_admin()` for ALL commands, while catalog_deliveries INSERT is
-- open to `is_org_member(org_id)`. Without DEFINER, a founder unlocking a
-- pack would have this trigger denied by RLS and the ENTIRE delivery insert
-- would fail — i.e. the fix would break unlockPack for every founder.
-- search_path is pinned for the usual DEFINER reason (and to keep the
-- function_search_path_mutable advisor quiet).

-- §B.3 — lets a backfill campaign's jobs be identified in the ledger and in
-- the backoffice cost tab, instead of being indistinguishable from organic
-- traffic in a time window.
alter table public.enrichment_jobs add column if not exists campaign text;
create index if not exists enrichment_jobs_campaign_idx
  on public.enrichment_jobs (campaign) where campaign is not null;

create or replace function public.enqueue_enrichment_for_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_test boolean;
  v_status text;
  v_stale_after timestamptz;
  v_org_is_test boolean;
begin
  select coalesce(ce.is_test, false), ce.enrichment_status, ce.enrichment_stale_after
    into v_is_test, v_status, v_stale_after
  from catalog_entities ce where ce.id = new.catalog_id;

  -- Unknown entity: nothing to enrich, and never block the delivery.
  if not found then return new; end if;

  -- QA/test fixtures never cost real money. Checked on BOTH sides: a test
  -- catalog entity, and a real entity delivered to a test org.
  if v_is_test then return new; end if;
  select coalesce(o.is_test, false) into v_org_is_test from orgs o where o.id = new.org_id;
  if coalesce(v_org_is_test, false) then return new; end if;

  -- Only enqueue what is actually DUE — same rule the app's own
  -- /api/pipeline/enqueue-enrichment already applies, so the trigger and the
  -- route can't disagree about what "needs enriching" means.
  if not (v_status in ('pending', 'stale') or (v_stale_after is not null and v_stale_after < now())) then
    return new;
  end if;

  -- Dedup guard. A recent queued/running/done job means this target is
  -- already handled; a FAILED job deliberately does not block, so a
  -- re-delivery is a legitimate retry. This is what makes the trigger
  -- idempotent and cheap under repeated deliveries of the same entity to
  -- different orgs.
  if exists (
    select 1 from enrichment_jobs j
    where j.target_type = 'entity' and j.target_id = new.catalog_id
      and j.status in ('queued', 'running', 'done')
      and j.created_at > now() - interval '90 days'
  ) then
    return new;
  end if;

  -- The partial unique index enrichment_jobs_one_active_per_target still
  -- guards against a genuine race between two concurrent deliveries of the
  -- same entity; losing that race is a no-op, never a failed delivery.
  begin
    insert into enrichment_jobs (target_type, target_id, layer, priority, requested_by_org_id)
    values ('entity', new.catalog_id, 1, 150, new.org_id);
  exception when unique_violation then
    null;
  end;

  return new;
end;
$$;

-- Same defensive posture as every other DEFINER function in this schema:
-- nothing needs to call it directly, so nobody may.
revoke all on function public.enqueue_enrichment_for_delivery() from public;

drop trigger if exists trg_catalog_deliveries_enqueue_enrichment on public.catalog_deliveries;
create trigger trg_catalog_deliveries_enqueue_enrichment
  after insert on public.catalog_deliveries
  for each row execute function public.enqueue_enrichment_for_delivery();

comment on table public.catalog_deliveries is
  'Delivery of a catalog investor to one org. Prompt 380 §A: an AFTER INSERT trigger '
  '(trg_catalog_deliveries_enqueue_enrichment) enqueues layer-1 enrichment for the '
  'catalog_id automatically — any NEW code path that creates a delivery gets enrichment '
  'for free and must NOT add its own enqueue call. Layer-2 (person) jobs are still the '
  'worker''s own follow-up, unchanged.';

-- `revoke ... from public` does NOT remove the EXECUTE grants Supabase
-- issues explicitly to anon/authenticated on public-schema functions — the
-- security advisor flagged exactly that after the first apply. A TRIGGER
-- function never needs an EXECUTE grant (it runs as part of the statement,
-- not by being called), so revoking from every client role is free.
revoke all on function public.enqueue_enrichment_for_delivery() from anon, authenticated;
