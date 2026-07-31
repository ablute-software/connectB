-- Bug found live testing Prompt 73's E2E flow (2026-07-31): catalog_entities
-- stub rows created for MatchDeal-only investors are frequently near-empty
-- (no website/phone/address) -- confirmed against all 6 investors currently
-- linked to an active matchdeal_investor_members row in production, every
-- one lacked all three, which made matchdeal_reconcile_pipeline_entry's
-- insert violate entities_has_identity_evidence (0049) and roll back the
-- WHOLE consent transaction (grant + reconciliation are one transaction by
-- design), so granting consent on any of them would have failed outright.
--
-- The investor's REAL identity evidence lives on their matchdeal_profiles
-- row instead, filled in during MatchDeal onboarding -- and is guaranteed
-- non-null for any investor who could ever reach a match at all, because
-- matchdeal_recompute_profile_completeness (0053) requires website is not
-- null before is_complete/is_visible can ever be true, and only
-- is_visible profiles are swipeable via matchdeal_eligible_deck. Falling
-- back to it here is both more accurate and what actually closes the gap.
--
-- unverified_stub_at is deliberately NOT used as a fallback here -- it is
-- documented as "set by human review only, never inferred" (0048/0049).
create or replace function public.matchdeal_reconcile_pipeline_entry(p_match_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_catalog_id uuid;
  v_investor_profile_id uuid;
  v_entity_id uuid;
  v_catalog record;
  v_investor_website text;
  v_final_website text;
begin
  select sp.membership_id, m.investor_catalog_entity_id, m.active_investor_profile_id
    into v_org_id, v_catalog_id, v_investor_profile_id
  from matchdeal_matches m
  join matchdeal_profiles sp on sp.id = m.startup_profile_id
  where m.id = p_match_id;

  if v_org_id is null or v_catalog_id is null then
    raise exception 'MATCHDEAL_MATCH_INCOMPLETE';
  end if;

  select entity_id into v_entity_id
  from catalog_deliveries
  where org_id = v_org_id and catalog_id = v_catalog_id;

  if v_entity_id is not null then
    return v_entity_id;
  end if;

  select * into v_catalog from catalog_entities where id = v_catalog_id;
  if v_catalog is null then
    raise exception 'MATCHDEAL_CATALOG_ENTITY_MISSING';
  end if;

  select website into v_investor_website
  from matchdeal_profiles where id = v_investor_profile_id;

  v_final_website := coalesce(v_catalog.website, v_investor_website);

  insert into entities (
    org_id, name, type, hq_city, hq_country, website, website_verified,
    email, phone, address, stage_min, stage_max,
    check_min_eur, check_max_eur, sectors, thesis, fit_score, wave,
    submission_channel_type, hard_filter_status, status, source
  ) values (
    v_org_id, v_catalog.name, v_catalog.type, v_catalog.hq_city, v_catalog.hq_country,
    v_final_website, v_final_website is not null,
    v_catalog.email, v_catalog.phone, v_catalog.address,
    v_catalog.stage_min, v_catalog.stage_max, v_catalog.check_min_eur, v_catalog.check_max_eur,
    v_catalog.sectors, v_catalog.thesis, 'high', 1,
    'unknown', 'not_applicable', 'not_contacted', 'match_deal'
  ) returning id into v_entity_id;

  insert into catalog_deliveries (org_id, catalog_id, entity_id, via_pack)
  values (v_org_id, v_catalog_id, v_entity_id, null);

  return v_entity_id;
end; $$;
