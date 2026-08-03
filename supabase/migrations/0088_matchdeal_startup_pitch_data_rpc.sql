-- Prompt 98 — the mini-pitch (4-slide) content for a startup profile now
-- lives partly in orgs/company_people, which have no cross-org SELECT
-- policy (only is_org_member() or is_ablute_developer()). An investor
-- browsing the deck is neither, so the deck cannot read another org's
-- orgs/company_people rows directly. This is the narrowest fix: a single
-- SECURITY DEFINER RPC that returns only the specific public-facing fields
-- the mini-pitch needs, gated on the exact same is_visible=true trust
-- boundary matchdeal_eligible_deck() already relies on for the deck itself
-- — no other orgs columns (Stripe IDs, round internals, etc.) are ever
-- reachable through this function. EXECUTE is revoked from anon/public and
-- granted only to authenticated, unlike matchdeal_decide_dataroom_consent's
-- pre-existing anon+public grant (flagged separately this session) — /pair
-- itself already requires a signed-in session before the deck is reachable
-- at all, so this matches the real caller population without widening it.
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
    return; -- not visible / not a startup / doesn't exist — same trust boundary as the deck itself, nothing to return
  end if;

  return query
  select
    o.name, o.one_liner, o.description, o.country, o.hq_city, o.sectors,
    o.founded_year, o.round_target_eur, o.revenue_eur, o.logo_url, o.stage::text,
    v_profile.tam_eur, v_profile.sam_eur, v_profile.som_eur,
    v_profile.revenue_projection_12mo_eur, v_profile.revenue_projection_5yr_eur,
    v_profile.traction_metrics,
    coalesce((
      select jsonb_agg(jsonb_build_object('full_name', cp.full_name, 'title', cp.title, 'bio', cp.bio, 'photo_url', cp.photo_url) order by cp.sort_order)
      from public.company_people cp
      where cp.org_id = v_profile.membership_id and cp.is_founder = true
    ), '[]'::jsonb) as founders
  from public.orgs o
  where o.id = v_profile.membership_id;
end;
$function$;

revoke all on function public.matchdeal_startup_pitch_data(uuid) from public;
revoke all on function public.matchdeal_startup_pitch_data(uuid) from anon;
grant execute on function public.matchdeal_startup_pitch_data(uuid) to authenticated;
