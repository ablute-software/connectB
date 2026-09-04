-- Prompt 556 — the two MatchDeal write paths stop delivering test investors
-- into real organisations.
--
-- NUMBERING: 0304. Checked with `git ls-remote --heads origin` across every
-- remote branch, not `main` alone, per Prompt 537's DECISIONS entry. 0303
-- (catalog_outreach_supply) is the highest taken. Worth flagging separately:
-- 0302 is currently DOUBLE-BOOKED across two branches
-- (0302_catalog_readiness_breakdown and 0302_matchdeal_investor_firm_view) —
-- not touched here, but somebody has to renumber one of them before they
-- meet on main.
--
-- THE BUG. `catalog_top_matches` — the discovery path that decides which
-- investors a founder is shown — has always filtered `is_test = false`. But
-- it is not the only thing that writes `catalog_deliveries`. These two
-- functions insert directly from a MatchDeal interest/pairing event and
-- never consulted `is_test` at all, so a test investor profile expressing
-- interest landed in a real founder's pipeline: a delivery, an entity, an
-- interaction and a "Respond to expressed interest" task.
--
-- Four rows in production, all with this path's fingerprint
-- (`quota_exempt = true`, `via_pack` null, `entities.source = 'match_deal'`):
--
--   2026-08-05  ablute_          <- nunomarujo@gmail.com — Individual investor
--   2026-08-24  Caramel Biscuit  <- ablute_ — Internal QA
--   2026-08-24  ablute_          <- ablute_ — Internal QA
--   2026-09-03  Krohnsty         <- ablute_ — Internal QA
--
-- The last one settles the "was it flagged as test only afterwards?"
-- question: it happened today, long after the flag existed. The path ignores
-- the flag, so it would do it again tomorrow.
--
-- THE DECISION (Nuno, 2026-09-03): ignore silently. A test investor
-- expressing interest must produce no delivery, no entity, no interaction
-- and no task in a real organisation — it is not a case to surface to the
-- founder differently, it is an event that should never have reached them.
-- Same rule `catalog_top_matches` already applies, with no exception.
--
-- HOW THE CHECK IS MADE. Directly on `catalog_entities.is_test` for the
-- investor-side catalog id, not via `matchdeal_profile_is_test()`. Both
-- reach the same column for an investor profile (that helper resolves
-- profile -> matchdeal_investor_members -> catalog_entities.is_test), but
-- the catalog id is a REQUIRED input to both functions while the profile id
-- is optional (`p_investor_profile_id uuid DEFAULT NULL` on the notifier,
-- and `active_investor_profile_id` is nullable on the match). Keying the
-- guard off the thing that is always present means it cannot be silently
-- skipped by a caller that omitted the optional argument.
--
-- RETURN VALUE WHEN IGNORED: null, and it is safe in both cases because
-- neither caller reads it. Verified rather than assumed:
--   * matchdeal_record_interest_notification — sole caller is
--     src/app/api/portal/pipeline/route.ts, which destructures `{ error }`
--     from the rpc and never touches `data`.
--   * matchdeal_reconcile_pipeline_entry — sole caller is
--     matchdeal_decide_dataroom_consent, which invokes it with `perform`,
--     discarding the result by definition.
--
-- SCOPE. Only the is_test guard. `quota_exempt` is untouched — the other
-- ~760 deliveries carrying it are 0170/0171's intended behaviour (an
-- interested investor must reach the founder regardless of quota) and are
-- not part of this problem. The four existing rows are not cleaned up here
-- either; that is a separate decision tied to Part F.

create or replace function public.matchdeal_record_interest_notification(
  p_org_id uuid, p_catalog_id uuid, p_reason_detail text default null::text,
  p_investor_profile_id uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entity_id uuid;
  v_catalog record;
  v_interaction_id uuid;
  v_email_domain text;
  v_has_evidence boolean;
  v_firm jsonb;
begin
  -- Prompt 556 — a test investor never reaches a real organisation. First
  -- statement in the function on purpose: everything below this line writes.
  if exists (select 1 from catalog_entities where id = p_catalog_id and is_test) then
    return null;
  end if;

  select entity_id into v_entity_id
  from catalog_deliveries
  where org_id = p_org_id and catalog_id = p_catalog_id;

  if v_entity_id is null then
    select * into v_catalog from catalog_entities where id = p_catalog_id;
    if v_catalog is null then
      raise exception 'MATCHDEAL_CATALOG_ENTITY_MISSING';
    end if;

    v_email_domain := nullif(lower(split_part(coalesce(v_catalog.email, ''), '@', 2)), '');

    -- Prompt 555 — the firm's own website/contact counts as identity
    -- evidence too, so a self-registered investor whose catalog stub is
    -- empty no longer trips entities_has_identity_evidence (0049).
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
$function$;

create or replace function public.matchdeal_reconcile_pipeline_entry(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Prompt 556 — placed after the match resolves (v_catalog_id only exists
  -- from here) and before the delivery lookup, so a test investor produces
  -- no read-then-write path at all. Note this also stops the Prompt 555
  -- refresh below from touching an entity created before this guard existed:
  -- those four rows are dealt with separately, not silently re-blessed here.
  if exists (select 1 from catalog_entities where id = v_catalog_id and is_test) then
    return null;
  end if;

  select entity_id into v_entity_id
  from catalog_deliveries
  where org_id = v_org_id and catalog_id = v_catalog_id;

  -- Prompt 555 — an entity that already exists is still refreshed from the
  -- firm. Before, this returned early and a row created by the older code
  -- (or before the investor finished their profile) stayed empty forever.
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
$function$;
