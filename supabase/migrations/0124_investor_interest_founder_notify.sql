-- Prompt 126 E — "Express interest" already records the org-level decision
-- (investor_relationship_decisions, migrations 0077/0078) and best-effort
-- emails the founder (src/app/api/portal/pipeline/route.ts), but nothing
-- lands INSIDE the founder's own workspace: no interaction on the entity's
-- history, no in-app popup, nothing durable if Resend isn't configured or
-- the email is missed. This migration adds the one column the founder-side
-- popup needs (seen_at, to dismiss it) and a function that turns a fresh
-- 'interested' decision into a real, visible signal in the founder's own
-- CRM — reusing the exact same catalog_deliveries entity-linking-or-creation
-- pattern matchdeal_reconcile_pipeline_entry (0067) already established,
-- and the exact same not_contacted/contacted -> in_conversation transition
-- rule store-supabase.tsx's logInteraction already applies for a normal
-- inbound 'interested' reply (kept in raw SQL only for that one narrow
-- rule — this does NOT attempt to replicate contact-lock/wave/stage logic,
-- which stays client-side and out of scope here).
--
-- Does not touch decide_investor_relationship (0078) or the matching engine
-- itself — this only runs AFTER that function has already recorded the
-- decision, as an additive, best-effort side effect the API route calls
-- next (same non-transactional, best-effort-after-the-real-write posture
-- as the email notify block already uses).
--
-- PROPOSE ONLY — not applied. Apply manually via Supabase dashboard/CLI.
alter table investor_relationship_decisions add column if not exists seen_at timestamptz;

create or replace function public.matchdeal_record_interest_notification(
  p_org_id uuid, p_catalog_id uuid, p_reason_detail text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entity_id uuid;
  v_catalog record;
  v_interaction_id uuid;
begin
  select entity_id into v_entity_id
  from catalog_deliveries
  where org_id = p_org_id and catalog_id = p_catalog_id;

  if v_entity_id is null then
    select * into v_catalog from catalog_entities where id = p_catalog_id;
    if v_catalog is null then
      raise exception 'MATCHDEAL_CATALOG_ENTITY_MISSING';
    end if;

    insert into entities (
      org_id, name, type, hq_city, hq_country, website, website_verified,
      email, phone, address, stage_min, stage_max,
      check_min_eur, check_max_eur, sectors, thesis, fit_score, wave,
      submission_channel_type, hard_filter_status, status, source
    ) values (
      p_org_id, v_catalog.name, v_catalog.type, v_catalog.hq_city, v_catalog.hq_country,
      v_catalog.website, v_catalog.website is not null,
      v_catalog.email, v_catalog.phone, v_catalog.address,
      v_catalog.stage_min, v_catalog.stage_max, v_catalog.check_min_eur, v_catalog.check_max_eur,
      v_catalog.sectors, v_catalog.thesis, 'high', 1,
      'unknown', 'not_applicable', 'not_contacted', 'match_deal'
    ) returning id into v_entity_id;

    insert into catalog_deliveries (org_id, catalog_id, entity_id, via_pack)
    values (p_org_id, p_catalog_id, v_entity_id, null);
  end if;

  -- Same rule store-supabase.tsx's logInteraction already applies for any
  -- inbound 'interested'/'meeting_request'/'question' classification —
  -- only nudges forward from the two "nothing's happened yet" states,
  -- never overwrites a founder's own further-along status.
  update entities set status = 'in_conversation'
  where id = v_entity_id and status in ('not_contacted', 'contacted');

  insert into interactions (org_id, entity_id, direction, channel, content, classification)
  values (
    p_org_id, v_entity_id, 'in', 'web_form',
    case when p_reason_detail is not null and length(trim(p_reason_detail)) > 0
      then 'Investor expressed interest via Pipeline.' || E'\n\n' || p_reason_detail
      else 'Investor expressed interest via Pipeline.' end,
    'interested'
  ) returning id into v_interaction_id;

  return v_interaction_id;
end; $$;

-- Same posture as decide_investor_relationship (0078): reachable only via
-- the service-role client inside /api/portal/pipeline's POST handler,
-- which has already validated the investor's real access before calling
-- this — never a directly callable client RPC.
revoke execute on function public.matchdeal_record_interest_notification(uuid, uuid, text) from public, anon, authenticated;
