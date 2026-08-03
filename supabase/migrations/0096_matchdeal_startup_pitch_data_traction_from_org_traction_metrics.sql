-- Addenda ao Prompt 98 §1 point 4 — traction now comes from
-- org_traction_metrics (show_on_dealdigger = true), not the
-- matchdeal_profiles column being dropped right after this.
create or replace function public.matchdeal_startup_pitch_data(p_profile_id uuid)
returns table(
  org_name text, one_liner text, description text,
  country text, hq_city text, sectors text[],
  founded_year int, round_target_eur int, revenue_eur numeric,
  logo_url text, stage text,
  tam_eur numeric, sam_eur numeric, som_eur numeric,
  revenue_projection_12mo_eur numeric, revenue_projection_5yr_eur numeric,
  traction_metrics jsonb,
  founders jsonb
)
language plpgsql
security definer
as $function$
declare
  v_profile public.matchdeal_profiles;
begin
  select * into v_profile from public.matchdeal_profiles
  where id = p_profile_id and kind = 'startup' and is_visible = true;

  if v_profile.id is null then
    return;
  end if;

  return query
  select
    o.name, o.one_liner, o.description, o.country, o.hq_city, o.sectors,
    o.founded_year, o.round_target_eur, o.revenue_eur, o.logo_url, o.stage::text,
    v_profile.tam_eur, v_profile.sam_eur, v_profile.som_eur,
    v_profile.revenue_projection_12mo_eur, v_profile.revenue_projection_5yr_eur,
    coalesce((
      select jsonb_agg(jsonb_build_object('type', tm.dealdigger_type, 'value', tm.value, 'label', tm.label) order by tm.sort_order)
      from public.org_traction_metrics tm
      where tm.org_id = v_profile.membership_id and tm.show_on_dealdigger = true
    ), '[]'::jsonb) as traction_metrics,
    coalesce((
      select jsonb_agg(jsonb_build_object('full_name', cp.full_name, 'title', cp.title, 'bio', cp.bio, 'photo_url', cp.photo_url) order by cp.sort_order)
      from public.company_people cp
      where cp.org_id = v_profile.membership_id and cp.is_founder = true
    ), '[]'::jsonb) as founders
  from public.orgs o
  where o.id = v_profile.membership_id;
end;
$function$;
