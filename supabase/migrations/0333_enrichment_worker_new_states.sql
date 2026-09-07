-- Prompt 583 §D.3/§D.2 — two new terminal states the worker needs before
-- its own code can write them.
--
-- done_no_people: a Layer 1 job that successfully read a team page but
-- found zero people is written as `enrichment_status = 'enriched'` today —
-- indistinguishable from a firm whose team was actually captured. 99
-- entities are in exactly this state in production. catalog_outreach_
-- readiness() (migration 0300) checks `enrichment_status = 'enriched'`
-- literally for its +5 "the data is good" bonus — confirmed by reading it,
-- not assumed — so giving zero-people entities their own distinct value
-- is the entire fix; that function needs no change of its own, since a row
-- that is no longer literally 'enriched' no longer matches its check.
--
-- blocked: a 403/429 that persists after one backoff retry is a
-- structural "this site rejects bots", not a transient failure — writing
-- it as 'failed' put it in the same bucket as a real network error, and
-- retrying a bot-blocking site every few minutes (the normal 'failed'
-- requeue cadence) has no chance of succeeding differently.
alter table public.catalog_entities drop constraint catalog_entities_enrichment_status_check;
alter table public.catalog_entities add constraint catalog_entities_enrichment_status_check
  check (enrichment_status = any (array['pending', 'enriched', 'stale', 'failed', 'done_no_people']));

alter table public.enrichment_jobs drop constraint enrichment_jobs_status_check;
alter table public.enrichment_jobs add constraint enrichment_jobs_status_check
  check (status = any (array['queued', 'running', 'done', 'failed', 'skipped', 'blocked']));
