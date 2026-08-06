-- relatorio_verificacao_..._20260805 §3, "O que falta" points 2-3.
--
-- Point 2 — matchdeal_record_interest_notification (0124, identity-evidence
-- fixed in 0127) creates the entity/link/interaction but never a follow-up
-- task, so an expressed interest could still sit unactioned with nothing on
-- the founder's own Today. Adds exactly one task, in the SAME transaction
-- as everything else this function already does (a Postgres function body
-- is one transaction) — kind='follow_up', action_type='follow_up_thread'
-- (0019's own enum already has this value), source='investor_interest'
-- (0128's own constraint widening already accepts it).
--
-- due_at = the moment interest was expressed (now()), not a 24h SLA — R2
-- default per the verification report's own recommendation ("o teu
-- problema foi precisamente ter passado despercebido"): this makes the
-- task immediately overdue, landing on Today's red "Overdue" card rather
-- than the quiet "This week" one. One line to change if Nuno wants a grace
-- period instead.
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
end; $$;

revoke execute on function public.matchdeal_record_interest_notification(uuid, uuid, text) from public, anon, authenticated;

-- Point 3 — the task closes itself, without anyone needing to remember it
-- exists, on whichever of three things happens first (Nuno's own words:
-- "até que se negasse ou aprovasse, ou se abrisse o log interaction e se
-- fizesse um contacto"):
--   (a) the founder records a decision on this relationship — the existing
--       roadmap concept for that is relationship_state.stage reaching its
--       own terminal value 'decision' (0003's own enum literally ends
--       there; there is no separate founder-side approve/deny action to
--       hook today, so this is the closest real "a decision was made" this
--       schema already expresses — flagging this interpretation rather
--       than inventing a new column).
--   (b) an outbound interaction is logged for this entity (direction='out')
--       — real contact was made, from the founder's own CRM.
--   (c) an investor_interaction_log entry is recorded for this (startup,
--       investor firm) pair — real contact was made, from the investor's
--       side of P133's private log; resolved back to the founder's
--       entity_id via catalog_deliveries, the same linking table
--       matchdeal_record_interest_notification itself just used to create it.
-- All three call the same function so the actual closing rule lives once.
create or replace function public.close_investor_interest_tasks(p_entity_id uuid) returns void
language sql security definer set search_path = public as $$
  update tasks set done = true
  where entity_id = p_entity_id and source = 'investor_interest' and done = false;
$$;

create or replace function public.trg_close_investor_interest_on_decision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'decision' then
    perform public.close_investor_interest_tasks(new.entity_id);
  end if;
  return new;
end; $$;

drop trigger if exists close_investor_interest_on_decision on relationship_state;
create trigger close_investor_interest_on_decision
  after insert or update of stage on relationship_state
  for each row execute function public.trg_close_investor_interest_on_decision();

create or replace function public.trg_close_investor_interest_on_outbound() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'out' then
    perform public.close_investor_interest_tasks(new.entity_id);
  end if;
  return new;
end; $$;

drop trigger if exists close_investor_interest_on_outbound on interactions;
create trigger close_investor_interest_on_outbound
  after insert on interactions
  for each row execute function public.trg_close_investor_interest_on_outbound();

-- investor_interaction_log (0125) only exists once that migration has been
-- applied — this trigger is created conditionally so applying 0129 never
-- fails on an environment that hasn't applied 0125 yet.
do $$
begin
  if to_regclass('public.investor_interaction_log') is not null then
    execute $trig$
      create or replace function public.trg_close_investor_interest_on_log_entry() returns trigger
      language plpgsql security definer set search_path = public as $inner$
      declare
        v_entity_id uuid;
      begin
        select entity_id into v_entity_id from catalog_deliveries
        where org_id = new.startup_org_id and catalog_id = new.investor_catalog_entity_id;
        if v_entity_id is not null then
          perform public.close_investor_interest_tasks(v_entity_id);
        end if;
        return new;
      end; $inner$;

      drop trigger if exists close_investor_interest_on_log_entry on investor_interaction_log;
      create trigger close_investor_interest_on_log_entry
        after insert on investor_interaction_log
        for each row execute function public.trg_close_investor_interest_on_log_entry();
    $trig$;
  end if;
end $$;
