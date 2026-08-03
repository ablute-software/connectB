-- Addenda ao Prompt 98 §1 point 5 — reconciled with org_traction_metrics,
-- this column duplicated it. No real data to migrate (test-only rows).
alter table public.matchdeal_profiles drop constraint matchdeal_profiles_traction_metrics_check;
alter table public.matchdeal_profiles drop column traction_metrics;
drop function if exists public.matchdeal_valid_traction_metrics(jsonb);
