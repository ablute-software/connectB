-- Prompt 257 §3 — regression found while checking whether Today/Actions
-- required already surfaces a fresh 'interested' decision (the "Invest
-- green" case: expressed interest, buried in a 760-row Pipeline with no
-- durable signal anywhere else). It did, once: migration 0129 added a
-- "Respond to expressed interest" task (due_at=now(), so it lands
-- immediately on Today's Overdue card) to matchdeal_record_interest_notification,
-- auto-closed by three triggers (on a decision, an outbound interaction, or
-- an investor_interaction_log entry — all three untouched, still enabled in
-- production) once the founder actually acts.
--
-- Migration 0171 (2026-08-15, catalog_deliveries_quota_exempt_column) later
-- redefined the SAME function to add quota_exempt=true to the
-- catalog_deliveries insert — but its `create or replace function` body was
-- copied from the PRE-0129 version, silently dropping the task insert while
-- correctly adding the quota fix. Confirmed against the live production
-- function definition (pg_get_functiondef) 2026-08-19: no `insert into
-- tasks` anywhere in the body, while all three close_investor_interest_*
-- triggers remain enabled — the closing half of the lifecycle is intact,
-- only the creating half was lost. Any 'interested' decision recorded since
-- 2026-08-15 got an entity + interaction but no task, i.e. no visible
-- Today/Actions-required signal at all — exactly the invisibility this
-- prompt's own motivating case describes.
--
-- This migration is the union of both changes that were never meant to
-- conflict: 0171's quota_exempt=true, plus 0129's task insert, restored
-- verbatim. Confirmed with Nuno before applying (2026-08-19) — no data
-- changes, SECURITY DEFINER function body only, future behavior only.
--
-- APLICADO EM PRODUÇÃO 2026-08-19 via mcp Supabase apply_migration. Este
-- ficheiro é a cópia verbatim para o repositório, escrita idempotente
-- (create or replace).
CREATE OR REPLACE FUNCTION public.matchdeal_record_interest_notification(
  p_org_id uuid,
  p_catalog_id uuid,
  p_reason_detail text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_entity_id uuid;
  v_catalog record;
  v_interaction_id uuid;
  v_email_domain text;
  v_has_evidence boolean;
begin
  select entity_id into v_entity_id
  from catalog_deliveries
  where org_id = p_org_id and catalog_id = p_catalog_id;

  if v_entity_id is null then
    select * into v_catalog from catalog_entities where id = p_catalog_id;
    if v_catalog is null then
      raise exception 'MATCHDEAL_CATALOG_ENTITY_MISSING';
    end if;

    v_email_domain := nullif(lower(split_part(coalesce(v_catalog.email, ''), '@', 2)), '');

    v_has_evidence := (
      v_catalog.website is not null
      or v_email_domain is not null
      or v_catalog.phone is not null
      or v_catalog.address is not null
    );

    insert into entities (
      org_id, name, type, hq_city, hq_country, website, website_verified,
      email, email_domain, phone, address, unverified_stub_at,
      stage_min, stage_max,
      check_min_eur, check_max_eur, sectors, thesis, fit_score, wave,
      submission_channel_type, hard_filter_status, status, source
    ) values (
      p_org_id, v_catalog.name, v_catalog.type, v_catalog.hq_city, v_catalog.hq_country,
      v_catalog.website, v_catalog.website is not null,
      v_catalog.email, v_email_domain, v_catalog.phone, v_catalog.address,
      case when v_has_evidence then null else now() end,
      v_catalog.stage_min, v_catalog.stage_max, v_catalog.check_min_eur, v_catalog.check_max_eur,
      v_catalog.sectors, v_catalog.thesis, 'high', 1,
      'unknown', 'not_applicable', 'not_contacted', 'match_deal'
    ) returning id into v_entity_id;

    -- quota_exempt=true — organic, investor-initiated, never the founder's
    -- own quota spend (0171's own fix, preserved here).
    insert into catalog_deliveries (org_id, catalog_id, entity_id, via_pack, quota_exempt)
    values (p_org_id, p_catalog_id, v_entity_id, null, true);
  end if;

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

  -- 0129's task insert, restored verbatim — due_at=now() so it lands on
  -- Today's Overdue card immediately, not a quiet "this week" one. Closed
  -- automatically by close_investor_interest_on_decision/_on_outbound/
  -- _on_log_entry (0129), all three confirmed still enabled in production.
  insert into tasks (org_id, title, due_at, entity_id, kind, action_type, source)
  values (p_org_id, 'Respond to expressed interest', now(), v_entity_id, 'follow_up', 'follow_up_thread', 'investor_interest');

  return v_interaction_id;
end;
$function$;
