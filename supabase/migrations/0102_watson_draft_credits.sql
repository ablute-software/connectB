-- Prompt 106 §B — Watson (AI composer) monthly draft credits. 90/210 per
-- month for garage/motherfunding (WATSON_DRAFT_QUOTA in plans.ts), confirmed
-- by Nuno 2026-08-03. No real counter existed before this — the gate was
-- purely binary (plan has AI composer or not).
--
-- Reset cadence: "the 1st day of each billing cycle" (Prompt 106's own
-- words) — this app doesn't sync a real Stripe billing-period anchor to a
-- local column, so this approximates it as a rolling monthly window anchored
-- to whenever the org's counter was first touched (or, for orgs that predate
-- this migration, to today). It self-heals lazily on each compose call —
-- no cron needed, consistent with the Hobby-plan once/day cron limit.
alter table public.orgs
  add column ai_drafts_used_this_month integer not null default 0,
  add column ai_drafts_reset_at timestamptz not null default (now() + interval '1 month');

-- Read-only: applies a reset if due, then reports where the org stands.
-- Called before generating a draft (to decide whether to block) and by the
-- UI card ("Watson Drafts left (X)"). SECURITY DEFINER so the reset write
-- doesn't need a client-side UPDATE grant on orgs.
create or replace function public.watson_drafts_status(p_org_id uuid, p_quota integer)
returns table(used integer, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_used integer;
  v_reset timestamptz;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  select ai_drafts_used_this_month, ai_drafts_reset_at into v_used, v_reset
  from public.orgs where id = p_org_id for update;

  if v_reset is null or now() >= v_reset then
    v_used := 0;
    v_reset := now() + interval '1 month';
    update public.orgs set ai_drafts_used_this_month = v_used, ai_drafts_reset_at = v_reset where id = p_org_id;
  end if;

  return query select v_used, greatest(p_quota - v_used, 0), v_reset;
end;
$function$;
grant execute on function public.watson_drafts_status(uuid, integer) to authenticated;

-- Increments by exactly 1, applying a reset first if one is due (defensive,
-- in case a long-running compose call spans the reset boundary). Never goes
-- negative and never exceeds p_quota — the route calls watson_drafts_status
-- first to decide whether to even attempt a draft, so this should only ever
-- be hit when there's room, but the cap is enforced here too, not just by
-- the caller's own check.
create or replace function public.watson_record_draft(p_org_id uuid, p_quota integer)
returns table(used integer, remaining integer)
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_used integer;
  v_reset timestamptz;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this org';
  end if;

  select ai_drafts_used_this_month, ai_drafts_reset_at into v_used, v_reset
  from public.orgs where id = p_org_id for update;

  if v_reset is null or now() >= v_reset then
    v_used := 0;
    v_reset := now() + interval '1 month';
  end if;

  v_used := least(v_used + 1, p_quota);
  update public.orgs set ai_drafts_used_this_month = v_used, ai_drafts_reset_at = v_reset where id = p_org_id;

  return query select v_used, greatest(p_quota - v_used, 0);
end;
$function$;
grant execute on function public.watson_record_draft(uuid, integer) to authenticated;
