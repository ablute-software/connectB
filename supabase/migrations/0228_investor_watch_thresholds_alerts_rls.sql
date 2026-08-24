-- Prompt 348 — follow-up fix. 0227 enabled RLS on investor_watch_thresholds
-- and investor_watch_alerts but added no policy at all, which the Supabase
-- advisor correctly flags (0008_rls_enabled_no_policy) — that comment's own
-- claim of matching investor_scorecard_criteria's posture was wrong:
-- migration 0152 DOES define a real owner-scoped SELECT policy for its own
-- tables (defense in depth on top of the service-role app routes), it just
-- also uses service-role for writes. This migration adds the equivalent
-- for these two tables, via the same investor_watches -> investor_catalog_entity_id
-- -> matchdeal_investor_members join every other seat-scoped read in this
-- schema uses.
create policy investor_watch_thresholds_owner on investor_watch_thresholds for select
  using (exists (
    select 1 from investor_watches w
    join matchdeal_investor_members m on m.catalog_entity_id = w.investor_catalog_entity_id
    where w.id = investor_watch_thresholds.watch_id and m.user_id = auth.uid()
  ));

create policy investor_watch_alerts_owner on investor_watch_alerts for select
  using (exists (
    select 1 from investor_watches w
    join matchdeal_investor_members m on m.catalog_entity_id = w.investor_catalog_entity_id
    where w.id = investor_watch_alerts.watch_id and m.user_id = auth.uid()
  ));
