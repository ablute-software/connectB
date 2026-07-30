-- SherlockDeal_Metricas_BackOffice_V1, Section 6.1 indicator 2 — "novas
-- organizações investidoras com registo concluído E validado". Verified is
-- exactly catalog_entities.verification_status = 'verified', which is set
-- from at least two different routes (the Catalog page's own Verify
-- button, and investor-identity's entity-review approval) — a trigger
-- catches both without relying on either call site remembering to log it,
-- same reasoning as the entities.status / orgs.plan triggers above.
create or replace function public.log_investor_registered() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.verification_status = 'verified' and old.verification_status is distinct from 'verified' then
    insert into analytics_events (
      organization_id, organization_type, country_at_event_time, sector_at_event_time, event_type
    ) values (
      new.id, 'investor', new.hq_country, array_to_string(new.sectors, ','), 'investor_registered'
    );
  end if;
  return new;
end; $$;

drop trigger if exists catalog_entities_verified_event on catalog_entities;
create trigger catalog_entities_verified_event after update of verification_status on catalog_entities
  for each row execute function public.log_investor_registered();
