-- Prompt 878 §1 — "ABl" is not a person. `matchdeal_investor_firm_view()`
-- (0302) fed a MatchDeal profile's `representative_name`/a member's
-- auth.users display name into `people.full_name` with only a
-- length-greater-than-zero check — any non-empty string, including a
-- 3-character fragment someone typed into a test profile ("ABl", on
-- ablute_'s own "ablute_ — Internal QA" catalog entity), became a real
-- person row with `data_source = 'matchdeal_profile'`.
--
-- Confirmed empirically before writing this: all 7 existing
-- `data_source = 'matchdeal_profile'` rows in production belong to test
-- entities or individual test accounts (this QA entry, Nuno's own personal
-- test account, "Test idividual") — no contamination in the real catalog.
-- This migration is a guard against the NEXT one, not a cleanup of a
-- widespread problem; the one existing bad row is deleted separately.
--
-- Threshold: length(trim(name)) >= 4. A genuine full name (first + last,
-- the only kind these fields are meant to hold) is essentially always
-- longer than that; a 1-3 character value is far more likely to be a
-- placeholder, an initial, or a truncation artifact than a real name. Per
-- the prompt's own instruction: leaving the field empty (no person row
-- created) is better than inventing an illegible one. Applied to BOTH
-- loops that feed `data_source = 'matchdeal_profile'` — the representative
-- branch (the one that produced "ABl") and the auth.users display-name
-- branch (matchdeal_apply_firm_to_entity's insert doesn't distinguish
-- between the two; a short garbage display name would hit the same gap).
create or replace function public.matchdeal_investor_firm_view(p_catalog_id uuid, p_preferred_profile_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb := '{}'::jsonb;
  v_people jsonb := '[]'::jsonb;
  v_p record;
  v_seen_names text[] := array[]::text[];
begin
  if p_catalog_id is null then return null; end if;

  for v_p in
    select pr.*, mem.role as member_role
    from matchdeal_profiles pr
    join matchdeal_investor_members mem on mem.id = pr.membership_id
    where pr.kind = 'investor'
      and mem.catalog_entity_id = p_catalog_id
      and mem.status = 'active'
      and pr.owner_suspended_at is null
      and pr.platform_suspended_at is null
    order by (pr.id = p_preferred_profile_id) desc, pr.updated_at desc nulls last
  loop
    v_result := matchdeal_firm_prune(jsonb_build_object(
      'entity_name', v_p.entity_name, 'entity_type', v_p.entity_type,
      'entity_logo_url', v_p.entity_logo_url, 'website', v_p.website,
      'country', v_p.country, 'description', v_p.description,
      'sectors', to_jsonb(v_p.sectors), 'focus_keywords', to_jsonb(v_p.focus_keywords),
      'company_types', to_jsonb(v_p.company_types),
      'capital_to_deploy_eur', v_p.capital_to_deploy_eur,
      'investments_per_year', v_p.investments_per_year,
      'lead_or_colead', v_p.lead_or_colead, 'instruments', to_jsonb(v_p.instruments),
      'does_follow_on', v_p.does_follow_on, 'takes_board_seat', v_p.takes_board_seat,
      'typical_decision_weeks', v_p.typical_decision_weeks,
      'decision_process', v_p.decision_process, 'active_fund', v_p.active_fund,
      'portfolio_companies', v_p.portfolio_companies,
      'recent_investments', v_p.recent_investments,
      'usual_co_investors', v_p.usual_co_investors,
      'exclusions_sectors', to_jsonb(v_p.exclusions_sectors),
      'exclusions_notes', v_p.exclusions_notes,
      'accepts_cold_contact', v_p.accepts_cold_contact,
      'preferred_contact_channel', v_p.preferred_contact_channel,
      'contact', v_p.contact
    )) || v_result;

    if not ('stages' = any(coalesce(v_p.hidden_fields, array[]::text[]))) then
      v_result := matchdeal_firm_prune(jsonb_build_object(
        'stages_invested', to_jsonb(v_p.stages_invested),
        'phases_accepted', to_jsonb(v_p.phases_accepted))) || v_result;
    end if;
    if not ('geographies' = any(coalesce(v_p.hidden_fields, array[]::text[]))) then
      v_result := matchdeal_firm_prune(jsonb_build_object('geographies', to_jsonb(v_p.geographies))) || v_result;
    end if;
    if not ('specific_criteria' = any(coalesce(v_p.hidden_fields, array[]::text[]))) then
      v_result := matchdeal_firm_prune(jsonb_build_object('specific_criteria', v_p.specific_criteria)) || v_result;
    end if;
    -- The pair, together or not at all — see this migration's header.
    if not ('ticket' = any(coalesce(v_p.hidden_fields, array[]::text[])))
       and (v_p.ticket_min is not null or v_p.ticket_max is not null)
       and not (v_result ? 'ticket_min' or v_result ? 'ticket_max') then
      v_result := matchdeal_firm_prune(jsonb_build_object(
        'ticket_min', v_p.ticket_min, 'ticket_max', v_p.ticket_max)) || v_result;
    end if;

    -- Prompt 878 §1 — length guard: >= 4 chars, not merely non-empty.
    if v_p.representative_name is not null and length(trim(v_p.representative_name)) >= 4
       and not (lower(trim(v_p.representative_name)) = any(v_seen_names)) then
      v_seen_names := v_seen_names || lower(trim(v_p.representative_name));
      v_people := v_people || jsonb_build_array(matchdeal_firm_prune(jsonb_build_object(
        'full_name', trim(v_p.representative_name), 'title', 'Representative',
        'linkedin_url', v_p.representative_linkedin)) || jsonb_build_object('seniority', 1));
    end if;
  end loop;

  -- Members come from auth.users' DISPLAY NAME only. No email, ever.
  for v_p in
    select mem.role as member_role, mem.created_at,
           nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), '') as full_name
    from matchdeal_investor_members mem
    join auth.users u on u.id = mem.user_id
    where mem.catalog_entity_id = p_catalog_id and mem.status = 'active'
    order by (mem.role = 'owner') desc, mem.created_at
  loop
    -- Prompt 878 §1 — same guard: a display name has to be at least 4
    -- characters to become a real person row.
    if v_p.full_name is not null and length(v_p.full_name) >= 4 and not (lower(v_p.full_name) = any(v_seen_names)) then
      v_seen_names := v_seen_names || lower(v_p.full_name);
      v_people := v_people || jsonb_build_array(jsonb_build_object(
        'full_name', v_p.full_name,
        'title', case when v_p.member_role = 'owner' then 'Owner' else 'Member' end,
        'seniority', 2));
    end if;
  end loop;

  if v_result = '{}'::jsonb and v_people = '[]'::jsonb then return null; end if;
  return v_result || jsonb_build_object('people', v_people);
end;
$function$;

revoke all on function matchdeal_investor_firm_view(uuid, uuid) from public;
revoke all on function matchdeal_investor_firm_view(uuid, uuid) from anon;
revoke all on function matchdeal_investor_firm_view(uuid, uuid) from authenticated;
grant execute on function matchdeal_investor_firm_view(uuid, uuid) to service_role;
