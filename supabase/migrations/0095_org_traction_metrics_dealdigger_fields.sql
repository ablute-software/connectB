-- Addenda ao Prompt 98 §1 — reconcile Slide 4's traction source with the
-- already-live org_traction_metrics (feeds the investor portal today) so
-- the founder never fills the same thing twice. dealdigger_type uses the
-- same 7-value list matchdeal_valid_traction_metrics() already validated,
-- just as a per-row CHECK instead of a jsonb-array check (the shapes
-- differ: one row per metric here, vs an array column there).
alter table public.org_traction_metrics
  add column dealdigger_type text,
  add column show_on_dealdigger boolean not null default false;

alter table public.org_traction_metrics
  add constraint org_traction_metrics_dealdigger_type_check
  check (dealdigger_type is null or dealdigger_type in
    ('mrr_arr','growth_rate','paying_customers','lois_pilots','waitlist','partnerships','other'));

-- At most 2 metrics featured on DealDigger per org — DB-enforced per your
-- "trigger if simple" preference, not left to the client alone.
create or replace function public.org_traction_metrics_enforce_dealdigger_limit()
returns trigger
language plpgsql
as $function$
begin
  if new.show_on_dealdigger and (
    select count(*) from public.org_traction_metrics
    where org_id = new.org_id and show_on_dealdigger = true
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) >= 2 then
    raise exception 'MATCHDEAL_DEALDIGGER_TRACTION_LIMIT: at most 2 metrics can be featured on DealDigger per org';
  end if;
  return new;
end;
$function$;

create trigger org_traction_metrics_dealdigger_limit
before insert or update on public.org_traction_metrics
for each row execute function public.org_traction_metrics_enforce_dealdigger_limit();
