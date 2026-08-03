-- Addenda 2026-08-02 §"Copy explícita quando o limite é mesmo a causa" —
-- the deck RPC only ever returns rows, with no context for why it came back
-- empty. This lets the client distinguish "weekly limit reached" (needs
-- plan + reset-date copy) from "pool genuinely has no eligible candidates"
-- (existing generic message still correct there) without touching
-- matchdeal_eligible_deck's own eligibility/ordering logic at all.
create or replace function public.matchdeal_weekly_quota_status(p_viewer_profile_id uuid)
returns table(deck_size int, shown_count int, remaining int, week_start date, resets_at timestamptz)
language plpgsql
security definer
as $function$
declare
  v_viewer public.matchdeal_profiles;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
begin
  select * into v_viewer from public.matchdeal_profiles where id = p_viewer_profile_id;
  v_weekly := public.matchdeal_get_or_create_weekly_activity(p_viewer_profile_id);
  select * into v_limits from public.matchdeal_tier_limits(v_viewer.plan_tier);
  return query select
    v_limits.deck_size,
    v_weekly.shown_count,
    greatest(v_limits.deck_size - v_weekly.shown_count, 0),
    v_weekly.week_start,
    (public.matchdeal_current_week_start() + interval '7 days')::timestamptz;
end; $function$;

revoke all on function public.matchdeal_weekly_quota_status(uuid) from public;
revoke all on function public.matchdeal_weekly_quota_status(uuid) from anon;
grant execute on function public.matchdeal_weekly_quota_status(uuid) to authenticated;
