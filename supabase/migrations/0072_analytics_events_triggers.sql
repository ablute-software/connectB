-- SherlockDeal_Metricas_BackOffice_V1, Section 13 instrumentation, Batch 1.
-- DB triggers rather than app-level call sites for the two transitions
-- that have NO history today (confirmed via code read: setEntityStatus()
-- and the plan-setting routes all do a raw UPDATE, nothing logged) and
-- that multiple, hard-to-enumerate code paths can cause (client-side
-- store, admin routes, backfill scripts, the Stripe webhook). A trigger
-- can't be silently skipped by a forgotten call site the way an app-level
-- logEvent() call could — this is the actual "mesma definição em todo o
-- lado" (13.2) guarantee, enforced at the one place all writes pass
-- through regardless of origin.
create or replace function public.log_entity_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org record;
begin
  if new.status is distinct from old.status then
    select plan, country, sector from orgs where id = new.org_id into v_org;
    insert into analytics_events (
      organization_id, organization_type, plan_at_event_time, country_at_event_time, sector_at_event_time,
      event_type, related_startup_id, pipeline_relation_id, investor_source, result, source_of_action
    ) values (
      new.org_id, 'startup', v_org.plan, v_org.country, v_org.sector,
      'pipeline_stage_reached', new.org_id, new.id, new.source, new.status::text, 'manual'
    );
  end if;
  return new;
end; $$;

drop trigger if exists entities_status_change_event on entities;
create trigger entities_status_change_event after update of status on entities
  for each row execute function public.log_entity_status_change();

create or replace function public.log_org_plan_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.plan is distinct from old.plan then
    insert into analytics_events (
      organization_id, organization_type, plan_at_event_time, billing_frequency_at_event_time,
      country_at_event_time, sector_at_event_time, event_type, result, status
    ) values (
      new.id, 'startup', new.plan, new.stripe_billing_period,
      new.country, new.sector, 'plan_changed', new.plan, old.plan
    );
  end if;
  return new;
end; $$;

drop trigger if exists orgs_plan_change_event on orgs;
create trigger orgs_plan_change_event after update of plan on orgs
  for each row execute function public.log_org_plan_change();

-- Registration — an insert IS the event, no "changed from" comparison
-- needed. new.plan is always the starting tier ('idea' by default) at
-- this point, which is exactly what plan_at_event_time should read.
create or replace function public.log_org_registered() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into analytics_events (
    organization_id, organization_type, plan_at_event_time, country_at_event_time, sector_at_event_time, event_type
  ) values (
    new.id, 'startup', new.plan, new.country, new.sector, 'org_registered'
  );
  return new;
end; $$;

drop trigger if exists orgs_registered_event on orgs;
create trigger orgs_registered_event after insert on orgs
  for each row execute function public.log_org_registered();
