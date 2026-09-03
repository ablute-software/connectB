-- Prompt 555 — a MatchDeal investor in a founder's pipeline is described by
-- the investor's OWN profile, never by its catalog stub.
--
-- MIGRATION NUMBER 0302, chosen after sweeping EVERY remote branch with
-- `git ls-remote --heads origin`: 0298 is taken by
-- claude/prompt-534-round-blueprint, 0300 and 0301 by
-- claude/prompt-544-outreach-ready, and 0295-0297/0299 are on main. Reading
-- main alone would have collided, exactly as Prompt 536's backfill did.
--
-- THREE CAUSES, all confirmed against production before any of this was
-- written:
--
-- 1. Both write paths insert FROM catalog_entities ONLY.
--    matchdeal_record_interest_notification (0124/0187) and
--    matchdeal_reconcile_pipeline_entry (0067/0080) build the entity out of
--    the catalog row. For an investor who came FROM the catalog that row is
--    real; for a self-registered one it is a stub created only to hang the
--    membership off — no website, thesis, sectors, stage or check. 0080's own
--    comment already knew the stub is "frequently near-empty" and fell back
--    to the profile for the WEBSITE alone, to satisfy the identity-evidence
--    constraint. Everything else stayed null.
-- 2. Neither path ever inserted `people`.
-- 3. The founder's entity page resolved "the investor's own MatchDeal
--    profile" through entity-catalog-prefill.ts, which matches against
--    catalog_entities AGAIN — its header comment believed the MatchDeal
--    profile IS the catalog row.
--
-- Measured: all 6 source='match_deal' entities in production (ablute_ x4,
-- Caramel Biscuit, Krohnsty) had null thesis, sectors, stage_min/max,
-- check_min/max, website and hq_country, and 0 people — while the profiles
-- behind them carried country Portugal, website ablute.pt, real tickets and
-- five stages.
--
-- Nothing here is newly exposed: MatchDealDeck already shows founders these
-- exact fields on the investor's card, honouring hidden_fields. This is the
-- same information failing to follow the investor into the pipeline.
--
-- TWO DESIGN CORRECTIONS found by running the projection against the real
-- two-profile firm rather than trusting it:
--   * A TICKET RANGE MUST COME FROM ONE PROFILE. Filling min and max
--     independently produced 10,000-1,350,000 — the min from the complete
--     profile, the max from the more recently updated one. Neither investor
--     ever stated that range. ticket_min/ticket_max are taken together, from
--     the first profile that has either.
--   * AN EMPTY ARRAY IS NOT AN ANSWER. jsonb_strip_nulls keeps `[]`, so the
--     projection was publishing sectors: [], instruments: [] and friends.
--     For a read path whose rule is "only the fields present", that renders
--     as empty rows. matchdeal_firm_prune drops them, so absent means absent.

-- ---------------------------------------------------------------------------
-- MatchDeal's stage vocabulary -> the CRM's Stage union (types.ts:9:
-- pre_seed | seed | series_a | later | other). series_b_plus and growth both
-- collapse to 'later'; the CRM has no finer bucket. Encoded ONCE so the write
-- paths and the backfill cannot disagree about the order.
create or replace function matchdeal_stage_rank(p_stage text)
returns int language sql immutable set search_path = public as $$
  select case p_stage
    when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b_plus' then 4 when 'growth' then 5 else null end;
$$;

create or replace function matchdeal_stage_to_crm(p_stage text)
returns text language sql immutable set search_path = public as $$
  select case p_stage
    when 'pre_seed' then 'pre_seed' when 'seed' then 'seed' when 'series_a' then 'series_a'
    when 'series_b_plus' then 'later' when 'growth' then 'later' else null end;
$$;

-- entities.type is the enum `entity_type` and stage_min/max are the enum
-- `stage`, while the projection carries text. Casting blind would raise 22P02
-- on any value MatchDeal has that the CRM enum does not (the two vocabularies
-- are maintained separately), and one bad label would abort a whole backfill
-- transaction. These return null instead of raising, so an unknown label is
-- simply not copied.
create or replace function matchdeal_text_to_entity_type(p text)
returns entity_type language plpgsql immutable set search_path = public as $$
begin
  if p is null then return null; end if;
  return p::entity_type;
exception when others then
  return null;
end;
$$;

create or replace function matchdeal_text_to_stage(p text)
returns stage language plpgsql immutable set search_path = public as $$
begin
  if p is null then return null; end if;
  return p::stage;
exception when others then
  return null;
end;
$$;

-- Drops keys that are null, an empty array, or a blank string — see the
-- second design correction in this file's header.
create or replace function matchdeal_firm_prune(p jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  from jsonb_each(jsonb_strip_nulls(p)) as e(k, v)
  where not (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0)
    and not (jsonb_typeof(v) = 'string' and length(trim(v #>> '{}')) = 0);
$$;

-- ---------------------------------------------------------------------------
-- §A — ONE founder-safe projection of an investor FIRM.
--
-- A firm is one firm even though the schema stores one matchdeal_profiles row
-- per member. The preferred profile (the member who actually acted) wins
-- field by field; every other ACTIVE, non-suspended member's profile fills
-- the gaps, most recently updated first.
--
-- hidden_fields is respected per SOURCE profile with the 0155 vocabulary
-- ('stages' covers stages_invested + phases_accepted; 'ticket' covers both
-- bounds), and a hidden field is ABSENT rather than present-and-null: a null
-- with a hint still discloses that the field exists and was withheld.
--
-- Never in this projection: plan_tier*, billing, suspension columns,
-- photo_*_scan, self_declared_*, hidden_fields itself, anything of the
-- startup kind — and NEVER auth.users.email. The only address that can appear
-- is the profile's own `contact`, which the investor typed knowing founders
-- would read it.
create or replace function matchdeal_investor_firm_view(
  p_catalog_id uuid, p_preferred_profile_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    -- The pair, together or not at all — see this file's header.
    if not ('ticket' = any(coalesce(v_p.hidden_fields, array[]::text[])))
       and (v_p.ticket_min is not null or v_p.ticket_max is not null)
       and not (v_result ? 'ticket_min' or v_result ? 'ticket_max') then
      v_result := matchdeal_firm_prune(jsonb_build_object(
        'ticket_min', v_p.ticket_min, 'ticket_max', v_p.ticket_max)) || v_result;
    end if;

    if v_p.representative_name is not null and length(trim(v_p.representative_name)) > 0
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
    if v_p.full_name is not null and not (lower(v_p.full_name) = any(v_seen_names)) then
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
$$;

revoke all on function matchdeal_firm_prune(jsonb) from public;
revoke all on function matchdeal_firm_prune(jsonb) from anon;
revoke all on function matchdeal_firm_prune(jsonb) from authenticated;
revoke all on function matchdeal_investor_firm_view(uuid, uuid) from public;
revoke all on function matchdeal_investor_firm_view(uuid, uuid) from anon;
revoke all on function matchdeal_investor_firm_view(uuid, uuid) from authenticated;
grant execute on function matchdeal_investor_firm_view(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- §B — the shared write step. Both entry points call this, so they cannot
-- drift, and §D's backfill is literally the same call — no second code path
-- that could disagree. Fills ONLY null/empty columns: a value the founder
-- typed is never overwritten, which is what makes it safe to re-run.
create or replace function matchdeal_apply_firm_to_entity(
  p_entity_id uuid, p_catalog_id uuid, p_preferred_profile_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_firm jsonb; v_org_id uuid; v_stages text[];
  v_stage_min text; v_stage_max text; v_contact text; v_person jsonb;
begin
  v_firm := matchdeal_investor_firm_view(p_catalog_id, p_preferred_profile_id);
  if v_firm is null then return; end if;

  select org_id into v_org_id from entities where id = p_entity_id;
  if v_org_id is null then return; end if;

  v_stages := array(select jsonb_array_elements_text(coalesce(v_firm->'stages_invested', '[]'::jsonb)));
  select matchdeal_stage_to_crm(s) into v_stage_min from unnest(v_stages) s
    where matchdeal_stage_rank(s) is not null order by matchdeal_stage_rank(s) limit 1;
  select matchdeal_stage_to_crm(s) into v_stage_max from unnest(v_stages) s
    where matchdeal_stage_rank(s) is not null order by matchdeal_stage_rank(s) desc limit 1;

  -- `email` only when the investor's own contact IS an email address. A phone
  -- number or a LinkedIn handle in that field must not land in a column the
  -- outreach rules treat as a mailbox.
  v_contact := v_firm->>'contact';
  if v_contact is not null and v_contact ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    v_contact := lower(trim(v_contact));
  else
    v_contact := null;
  end if;

  update entities e set
    name = coalesce(nullif(trim(e.name), ''), v_firm->>'entity_name', e.name),
    type = coalesce(e.type, matchdeal_text_to_entity_type(v_firm->>'entity_type')),
    hq_country = coalesce(e.hq_country, v_firm->>'country'),
    website = coalesce(e.website, v_firm->>'website'),
    website_verified = e.website_verified or (e.website is null and (v_firm->>'website') is not null),
    email = coalesce(e.email, v_contact),
    email_domain = coalesce(e.email_domain, nullif(lower(split_part(coalesce(v_contact, ''), '@', 2)), '')),
    sectors = case when coalesce(array_length(e.sectors, 1), 0) = 0
      then array(select jsonb_array_elements_text(coalesce(v_firm->'sectors', '[]'::jsonb))) else e.sectors end,
    stage_min = coalesce(e.stage_min, matchdeal_text_to_stage(v_stage_min)),
    stage_max = coalesce(e.stage_max, matchdeal_text_to_stage(v_stage_max)),
    check_min_eur = coalesce(e.check_min_eur, (v_firm->>'ticket_min')::numeric),
    check_max_eur = coalesce(e.check_max_eur, (v_firm->>'ticket_max')::numeric),
    thesis = coalesce(e.thesis, nullif(v_firm->>'description', ''), nullif(v_firm->>'specific_criteria', '')),
    key_people = coalesce(nullif(trim(coalesce(e.key_people, '')), ''), nullif((
      select string_agg(x->>'full_name', ', ' order by (x->>'seniority')::int, x->>'full_name')
      from jsonb_array_elements(coalesce(v_firm->'people', '[]'::jsonb)) x), '')),
    -- The investor's own onboarding IS the identity evidence 0080 already
    -- accepted, so a firm that supplies a website or a contact clears the
    -- stub flag. Never set the other way: 0048/0049 document this column as
    -- human-review-only, never inferred.
    unverified_stub_at = case
      when (v_firm->>'website') is not null or v_contact is not null then null
      else e.unverified_stub_at end
  where e.id = p_entity_id;

  -- People, idempotent on (entity_id, lower(full_name)). data_source records
  -- the origin so a founder can tell these apart from someone they added.
  for v_person in select * from jsonb_array_elements(coalesce(v_firm->'people', '[]'::jsonb)) loop
    if not exists (
      select 1 from people p
      where p.entity_id = p_entity_id
        and lower(trim(p.full_name)) = lower(trim(v_person->>'full_name'))
    ) then
      insert into people (org_id, entity_id, full_name, role, linkedin_url, seniority_rank, data_source)
      values (v_org_id, p_entity_id, trim(v_person->>'full_name'), v_person->>'title',
              v_person->>'linkedin_url', (v_person->>'seniority')::int, 'matchdeal_profile');
    end if;
  end loop;
end;
$$;

revoke all on function matchdeal_apply_firm_to_entity(uuid, uuid, uuid) from public;
revoke all on function matchdeal_apply_firm_to_entity(uuid, uuid, uuid) from anon;
revoke all on function matchdeal_apply_firm_to_entity(uuid, uuid, uuid) from authenticated;
grant execute on function matchdeal_apply_firm_to_entity(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- §B (continued) — both write paths.
--
-- The 3-arg signature of matchdeal_record_interest_notification is DROPPED
-- rather than left beside a 4-arg version with a default: PostgreSQL would
-- find f(uuid, uuid, text) ambiguous between the two and the existing caller
-- would start failing. Grants are re-issued because a drop takes the ACL with
-- it (previous ACL: postgres + service_role only; restored exactly).
drop function if exists matchdeal_record_interest_notification(uuid, uuid, text);

create or replace function matchdeal_record_interest_notification(
  p_org_id uuid, p_catalog_id uuid, p_reason_detail text default null,
  p_investor_profile_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entity_id uuid;
  v_catalog record;
  v_interaction_id uuid;
  v_email_domain text;
  v_has_evidence boolean;
  v_firm jsonb;
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

    -- Prompt 555 — the firm's own website/contact counts as identity evidence
    -- too, so a self-registered investor whose catalog stub is empty no
    -- longer trips entities_has_identity_evidence (0049).
    v_firm := matchdeal_investor_firm_view(p_catalog_id, p_investor_profile_id);

    v_has_evidence := (
      v_catalog.website is not null
      or v_email_domain is not null
      or v_catalog.phone is not null
      or v_catalog.address is not null
      or (v_firm->>'website') is not null
      or (v_firm->>'contact') is not null
    );

    insert into entities (
      org_id, name, type, hq_city, hq_country, website, website_verified,
      email, email_domain, phone, address, unverified_stub_at,
      stage_min, stage_max,
      check_min_eur, check_max_eur, sectors, thesis, fit_score, wave,
      submission_channel_type, hard_filter_status, status, source
    ) values (
      p_org_id,
      coalesce(nullif(trim(coalesce(v_catalog.name, '')), ''), v_firm->>'entity_name', 'Investor'),
      v_catalog.type, v_catalog.hq_city, v_catalog.hq_country,
      coalesce(v_catalog.website, v_firm->>'website'),
      coalesce(v_catalog.website, v_firm->>'website') is not null,
      v_catalog.email, v_email_domain, v_catalog.phone, v_catalog.address,
      case when v_has_evidence then null else now() end,
      v_catalog.stage_min, v_catalog.stage_max, v_catalog.check_min_eur, v_catalog.check_max_eur,
      v_catalog.sectors, v_catalog.thesis, 'high', 1,
      'unknown', 'not_applicable', 'not_contacted', 'match_deal'
    ) returning id into v_entity_id;

    insert into catalog_deliveries (org_id, catalog_id, entity_id, via_pack, quota_exempt)
    values (p_org_id, p_catalog_id, v_entity_id, null, true);
  end if;

  -- Every remaining null column, and the people. Idempotent, and it never
  -- overwrites a value the founder typed, so calling it on an entity that
  -- already existed is safe and keeps a returning investor's row current.
  perform matchdeal_apply_firm_to_entity(v_entity_id, p_catalog_id, p_investor_profile_id);

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

  insert into tasks (org_id, title, due_at, entity_id, kind, action_type, source)
  values (p_org_id, 'Respond to expressed interest', now(), v_entity_id, 'follow_up', 'follow_up_thread', 'investor_interest');

  return v_interaction_id;
end;
$$;

revoke all on function matchdeal_record_interest_notification(uuid, uuid, text, uuid) from public;
revoke all on function matchdeal_record_interest_notification(uuid, uuid, text, uuid) from anon;
revoke all on function matchdeal_record_interest_notification(uuid, uuid, text, uuid) from authenticated;
grant execute on function matchdeal_record_interest_notification(uuid, uuid, text, uuid) to service_role;

create or replace function matchdeal_reconcile_pipeline_entry(p_match_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_catalog_id uuid;
  v_investor_profile_id uuid;
  v_entity_id uuid;
  v_catalog record;
  v_firm jsonb;
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

  -- Prompt 555 — an entity that already exists is still refreshed from the
  -- firm. Before, this returned early and a row created by the older code (or
  -- before the investor finished their profile) stayed empty forever.
  if v_entity_id is not null then
    perform matchdeal_apply_firm_to_entity(v_entity_id, v_catalog_id, v_investor_profile_id);
    return v_entity_id;
  end if;

  select * into v_catalog from catalog_entities where id = v_catalog_id;
  if v_catalog is null then
    raise exception 'MATCHDEAL_CATALOG_ENTITY_MISSING';
  end if;

  -- 0080's original note stands: catalog stubs for MatchDeal-only investors
  -- are frequently near-empty, and the investor's real identity evidence
  -- lives on their matchdeal_profiles row. Prompt 555 widens that fallback
  -- from "the website alone" to the whole firm projection.
  -- unverified_stub_at is still never INFERRED here (0048/0049: human review
  -- only) — the helper only ever clears it.
  v_firm := matchdeal_investor_firm_view(v_catalog_id, v_investor_profile_id);
  v_final_website := coalesce(v_catalog.website, v_firm->>'website');

  insert into entities (
    org_id, name, type, hq_city, hq_country, website, website_verified,
    email, phone, address, stage_min, stage_max,
    check_min_eur, check_max_eur, sectors, thesis, fit_score, wave,
    submission_channel_type, hard_filter_status, status, source
  ) values (
    v_org_id,
    coalesce(nullif(trim(coalesce(v_catalog.name, '')), ''), v_firm->>'entity_name', 'Investor'),
    v_catalog.type, v_catalog.hq_city, v_catalog.hq_country,
    v_final_website, v_final_website is not null,
    v_catalog.email, v_catalog.phone, v_catalog.address,
    v_catalog.stage_min, v_catalog.stage_max, v_catalog.check_min_eur, v_catalog.check_max_eur,
    v_catalog.sectors, v_catalog.thesis, 'high', 1,
    'unknown', 'not_applicable', 'not_contacted', 'match_deal'
  ) returning id into v_entity_id;

  insert into catalog_deliveries (org_id, catalog_id, entity_id, via_pack)
  values (v_org_id, v_catalog_id, v_entity_id, null);

  perform matchdeal_apply_firm_to_entity(v_entity_id, v_catalog_id, v_investor_profile_id);

  return v_entity_id;
end;
$$;

revoke all on function matchdeal_reconcile_pipeline_entry(uuid) from public;
revoke all on function matchdeal_reconcile_pipeline_entry(uuid) from anon;
revoke all on function matchdeal_reconcile_pipeline_entry(uuid) from authenticated;
grant execute on function matchdeal_reconcile_pipeline_entry(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- §D — backfill, nulls only.
--
-- Scope: every source='match_deal' entity whose catalog stub has at least one
-- ACTIVE investor profile behind it. interactions, tasks and statuses are
-- untouched. Measured in production, before -> after:
--
--   ablute_  nunomarujo@gmail.com — Individual investor
--     thesis no->YES, sectors 0->3, stage -..- -> pre_seed..series_a,
--     check -..- -> 10000..50000, website - -> ablute.pt, people 0->1
--   ablute_  Invest green
--     stage -..- -> pre_seed..later, check -..- -> 15000..50000,
--     country - -> Portugal, people 0->1
--   ablute_  Test idividual
--     sectors 0->3, stage -..- -> pre_seed..seed,
--     check -..- -> 25000..75000, country - -> Portugal, people 0->1
--   ablute_ / Caramel Biscuit / Krohnsty  "ablute_ — Internal QA" (x3)
--     thesis no->YES, stage -..- -> pre_seed..series_a,
--     check -..- -> ..1350000, website - -> ablute.pt,
--     country - -> Portugal, people 0->4
--
-- No `email` was written anywhere: none of these firms' own `contact` fields
-- held an email address, and auth.users.email is never read at all.
do $$
declare r record;
begin
  for r in
    select e.id as entity_id, d.catalog_id
    from entities e
    join catalog_deliveries d on d.entity_id = e.id
    where e.source = 'match_deal'
      and exists (
        select 1
        from matchdeal_investor_members mem
        join matchdeal_profiles pr on pr.membership_id = mem.id and pr.kind = 'investor'
        where mem.catalog_entity_id = d.catalog_id and mem.status = 'active'
      )
  loop
    perform matchdeal_apply_firm_to_entity(r.entity_id, r.catalog_id, null);
  end loop;
end $$;
