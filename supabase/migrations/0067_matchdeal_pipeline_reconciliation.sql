-- Prompt 73 — reconcile a consented MatchDeal match into the founder's
-- real pipeline. `matchdeal_conciliacao_web` was scoped in an earlier
-- design doc but never actually built (confirmed via full-repo search:
-- zero functions/routes/comments implementing it) — this migration is
-- that missing piece.
--
-- Reuses entities.source='match_deal' (migration 0042 already reserved
-- this exact value — "not wired yet", see src/lib/types.ts) rather than
-- adding a new `origin` column: the schema already had a home for this.
-- Field mapping mirrors what the legacy unlockPack path used when turning
-- a catalog_entities row into a pipeline entities row (src/lib/
-- store-supabase.tsx), and catalog_deliveries provides the same
-- idempotency guarantee it always has (unique org_id+catalog_id) — a
-- match that gets re-consented after a decline/regrant cycle must not
-- create a second pipeline entry for the same investor.
create or replace function public.matchdeal_reconcile_pipeline_entry(p_match_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_catalog_id uuid;
  v_entity_id uuid;
  v_catalog record;
begin
  select sp.membership_id, m.investor_catalog_entity_id
    into v_org_id, v_catalog_id
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

  -- A mutual match is the strongest possible pipeline signal this app can
  -- represent (both sides showed direct interest already) — wave 1 /
  -- fit_score 'high', not the neutral defaults a cold catalog listing gets.
  insert into entities (
    org_id, name, type, hq_city, hq_country, website, website_verified,
    email, phone, address, stage_min, stage_max,
    check_min_eur, check_max_eur, sectors, thesis, fit_score, wave,
    submission_channel_type, hard_filter_status, status, source
  ) values (
    v_org_id, v_catalog.name, v_catalog.type, v_catalog.hq_city, v_catalog.hq_country,
    v_catalog.website, v_catalog.website is not null,
    v_catalog.email, v_catalog.phone, v_catalog.address,
    v_catalog.stage_min, v_catalog.stage_max, v_catalog.check_min_eur, v_catalog.check_max_eur,
    v_catalog.sectors, v_catalog.thesis, 'high', 1,
    'unknown', 'not_applicable', 'not_contacted', 'match_deal'
  ) returning id into v_entity_id;

  insert into catalog_deliveries (org_id, catalog_id, entity_id, via_pack)
  values (v_org_id, v_catalog_id, v_entity_id, null);

  return v_entity_id;
end; $$;

-- Wire it into the one real trigger point that already exists: consent
-- granted -> dataroom access. Adds the pipeline-entry call in the same
-- transaction as the existing matchdeal_grant_dataroom call, so "match
-- consented" reliably produces both halves of what MatchDeal promises —
-- never just a data-room grant with no visible pipeline entry. Does not
-- change what matchdeal_grant_dataroom itself receives or writes.
create or replace function public.matchdeal_decide_dataroom_consent(p_match_id uuid, p_granted boolean, p_decline_reason text default null::text) returns void
language plpgsql security definer as $$
declare
  v_active_queue_id uuid;
begin
  insert into public.matchdeal_dataroom_consent (match_id, granted, decline_reason)
  values (p_match_id, p_granted, p_decline_reason)
  on conflict (match_id) do update
    set granted = excluded.granted, decline_reason = excluded.decline_reason, decided_at = now();

  if p_granted then
    update public.matchdeal_matches
      set status = 'active', dataroom_granted_at = now(), updated_at = now()
      where id = p_match_id;

    select id into v_active_queue_id
    from public.matchdeal_responsibility_queue
    where match_id = p_match_id and status = 'active';

    update public.matchdeal_responsibility_queue
      set sla_deadline = now() + interval '7 days'
      where id = v_active_queue_id;

    -- Acesso real ao data room do Sherlock Deal (0006).
    perform public.matchdeal_grant_dataroom(p_match_id);

    -- Prompt 73 — the pipeline entry, added alongside the existing grant
    -- call above.
    perform public.matchdeal_reconcile_pipeline_entry(p_match_id);

    insert into public.matchdeal_match_events (match_id, event_type)
    values (p_match_id, 'consent_granted');

    insert into public.matchdeal_messages (match_id, sender_profile_id, kind, body)
    values (p_match_id, null, 'system',
      'A startup autorizou a partilha do data room. Já podes ver os documentos no Sherlock Deal e conversar livremente aqui.');
  else
    update public.matchdeal_matches
      set status = 'declined_by_startup', cooldown_until = now() + interval '30 days', updated_at = now()
      where id = p_match_id;

    update public.matchdeal_responsibility_queue
      set status = 'declined'
      where match_id = p_match_id;

    insert into public.matchdeal_match_events (match_id, event_type, payload)
    values (p_match_id, 'consent_declined', jsonb_build_object('reason', p_decline_reason));

    insert into public.matchdeal_messages (match_id, sender_profile_id, kind, body)
    values (p_match_id, null, 'system',
      'A startup optou por não partilhar o data room neste momento. O match fica sem efeito.');
  end if;
end; $$;
