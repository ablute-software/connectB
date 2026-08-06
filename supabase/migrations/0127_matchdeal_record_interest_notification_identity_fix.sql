-- Bug found in production (relatorio_verificacao_..._20260805 §3): every
-- single "investor expressed interest" since migration 0124 landed failed
-- silently — 0/757 entities with source='match_deal' from this path, 0
-- catalog_deliveries links, 0 "Investor expressed interest" interactions,
-- across the one real decision that existed. Root cause: this function
-- wrote the catalog entity's email into entities.email, but
-- entities_has_identity_evidence (0049) checks entities.email_domain — a
-- DIFFERENT column. An individual investor's catalog row with no website/
-- phone/address (the common case for a self-registered individual — 53 of
-- 536 catalog entities have none of the four) has nothing else to satisfy
-- the constraint on, so the insert violated it and rolled back every time.
-- The caller (src/app/api/portal/pipeline/route.ts) swallowed the failure
-- in a bare try/catch that never reads rpc()'s own `.error` (fixed
-- separately, same commit) — supabase-js's rpc() never throws, so nothing
-- was ever visible anywhere.
--
-- Fix, in the same spirit as 0080's fix to matchdeal_reconcile_pipeline_entry
-- for the same constraint: derive email_domain from the catalog email (the
-- column the constraint actually reads), same lower(domain-after-@)
-- convention as src/lib/md-history-import.ts's own emailDomain(). Unlike
-- 0080, there is no guaranteed fallback website here (an interest-expressing
-- investor need not have a MatchDeal profile at all — P132-A's Pipeline
-- union also includes plain access-grant/decision relationships) — so when
-- literally nothing (website, derived email_domain, phone, address) is
-- available, this sets unverified_stub_at, the schema's own documented
-- escape hatch (0048) for "no proof of independent existence yet, but the
-- row must still be allowed to exist." 0048's own comment says this flag
-- is meant to be "set by human review only, never inferred" — a narrow,
-- deliberate, additive exception here: the alternative is what already
-- happened for months, silently losing every such investor's interest
-- entirely. isUnverifiedStub() (src/lib/relationship.ts) already renders
-- this state honestly wherever an entity is shown, so nothing downstream
-- needs to change to display it.
--
-- Signature unchanged, purely additive.
create or replace function public.matchdeal_record_interest_notification(
  p_org_id uuid, p_catalog_id uuid, p_reason_detail text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entity_id uuid;
  v_catalog record;
  v_interaction_id uuid;
  v_email_domain text;
  v_has_identity_evidence boolean;
begin
  select entity_id into v_entity_id
  from catalog_deliveries
  where org_id = p_org_id and catalog_id = p_catalog_id;

  if v_entity_id is null then
    select * into v_catalog from catalog_entities where id = p_catalog_id;
    if v_catalog is null then
      raise exception 'MATCHDEAL_CATALOG_ENTITY_MISSING';
    end if;

    v_email_domain := lower(split_part(v_catalog.email, '@', 2));
    if v_email_domain = '' then
      v_email_domain := null;
    end if;

    v_has_identity_evidence := v_catalog.website is not null or v_email_domain is not null
      or v_catalog.phone is not null or v_catalog.address is not null;

    insert into entities (
      org_id, name, type, hq_city, hq_country, website, website_verified,
      email, email_domain, phone, address, stage_min, stage_max,
      check_min_eur, check_max_eur, sectors, thesis, fit_score, wave,
      submission_channel_type, hard_filter_status, status, source, unverified_stub_at
    ) values (
      p_org_id, v_catalog.name, v_catalog.type, v_catalog.hq_city, v_catalog.hq_country,
      v_catalog.website, v_catalog.website is not null,
      v_catalog.email, v_email_domain, v_catalog.phone, v_catalog.address,
      v_catalog.stage_min, v_catalog.stage_max, v_catalog.check_min_eur, v_catalog.check_max_eur,
      v_catalog.sectors, v_catalog.thesis, 'high', 1,
      'unknown', 'not_applicable', 'not_contacted', 'match_deal',
      case when v_has_identity_evidence then null else now() end
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

revoke execute on function public.matchdeal_record_interest_notification(uuid, uuid, text) from public, anon, authenticated;
