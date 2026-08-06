-- P135 §(c) — corrige o defeito da 0124 que impedia a criação automática da
-- entidade quando um investidor exprimia interesse no Pipeline.
--
-- APLICADA EM PRODUÇÃO A 05/08/2026 23:22:18 UTC pelo revisor (versão
-- 20260805232218 em supabase_migrations.schema_migrations), sem ficheiro no
-- repositório. Este ficheiro é a reconstrução verbatim do que está aplicado,
-- escrita idempotente, para o repositório voltar a ser fonte da verdade do
-- esquema. Aplicar num ambiente que já a tem é inofensivo.
--
-- O BUG: a 0124 inseria em entities a coluna `email` vinda de
-- catalog_entities, mas o CHECK entities_has_identity_evidence lê
-- `email_domain` — coluna diferente. Para as 53 de 536 entidades de catálogo
-- sem website/phone/address, o insert violava o CHECK e rebentava. O erro
-- nunca foi visto por ninguém porque o rpc() do supabase-js devolve
-- {data, error} e NÃO lança, e o call site em api/portal/pipeline/route.ts:196
-- embrulha a chamada num try/catch vazio.
--
-- A CORRECÇÃO, aditiva e de assinatura inalterada: derivar email_domain a
-- partir do email do catálogo, e preencher unverified_stub_at quando não há
-- nenhuma evidência de identidade — que é precisamente a válvula de escape
-- que o próprio CHECK já previa.
--
-- NOTA: catalog_entities só tem website, email, phone e address como campos
-- de identidade. Não tem source_url nem email_domain. Por isso a expressão
-- v_has_evidence abaixo cobre exactamente os quatro ramos possíveis a partir
-- desta origem, e não os seis do CHECK.

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

    -- The CHECK reads email_domain, so derive it; an email with no '@'
    -- yields '' from split_part, which nullif() turns back into NULL.
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

  return v_interaction_id;
end; $function$;
