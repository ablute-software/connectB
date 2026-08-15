-- Prompt 199 — decisão de produto: quota é o orçamento de investidores
-- introduzidos ao founder. unlockPack E a entrega mensal (catalog-monthly-
-- delivery-server.ts, Prompt 179 §B) consomem esse orçamento — a mensal
-- ainda nunca correu em produção (nenhuma org tem catalog_last_monthly_
-- delivery definido), mas quando correr deve contar como consumo real, tal
-- como um unlock manual. SÓ o interesse orgânico de um investidor
-- (matchdeal_record_interest_notification) não consome — o founder não
-- escolheu gastar quota, o investidor é que apareceu sozinho.
--
-- 0170 (aplicada antes) tinha resolvido isto sobrepondo "via_pack IS NULL"
-- a "não conta para quota" — mas via_pack só devia significar "veio de que
-- pack", não "consome quota". Se a entrega mensal também inserisse com
-- via_pack=null (como já faz), herdava a isenção da 0170 e nunca entregaria
-- nada, porque o count de via_pack-null já está poluído pelas 521 linhas do
-- bulk-seed de 2026-07-27. Esta migration separa os dois eixos.
--
-- APLICADO EM PRODUÇÃO 2026-08-15 (nome: catalog_deliveries_quota_exempt_column).
alter table catalog_deliveries add column if not exists quota_exempt boolean not null default false;

-- Backfill: todas as linhas via_pack IS NULL existentes hoje são ou o
-- bulk-seed histórico (521, ablute_) ou notificações de interesse (3) —
-- nenhuma é ainda uma entrega mensal real (nunca correu). Ambas isentas.
update catalog_deliveries set quota_exempt = true where via_pack is null;

create or replace function public.catalog_deliveries_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_quota int;
  v_delivered int;
begin
  if is_ablute_developer() then
    return new;
  end if;

  if new.quota_exempt then
    return new;
  end if;

  select catalog_quota into v_quota from public.orgs where id = new.org_id;
  if v_quota is null then
    raise exception 'catalog_deliveries: org % sem catalog_quota definido', new.org_id;
  end if;
  select count(*) into v_delivered from public.catalog_deliveries where org_id = new.org_id and not quota_exempt;
  if v_delivered >= v_quota then
    raise exception 'CATALOG_QUOTA_EXCEEDED: org % ja tem % entregas, quota=%',
      new.org_id, v_delivered, v_quota;
  end if;
  return new;
end;
$function$;

-- matchdeal_record_interest_notification: passa a inserir quota_exempt=true
-- explicitamente (via_pack continua null, sem mudança de significado).
create or replace function public.matchdeal_record_interest_notification(
  p_org_id uuid,
  p_catalog_id uuid,
  p_reason_detail text default null::text
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
    -- own quota spend. See this migration's own header.
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

  return v_interaction_id;
end;
$function$;
