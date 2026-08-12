-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro: prompt_179_pipeline_vidro_fosco_e_entrega_mensal_20260812.md §B

-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- plans.ts linha 19, no proprio codigo: "a monthly delivery job -- not yet
-- built -- is meant to grow [catalog_quota] further". Nao existe nenhum
-- mecanismo que aumente orgs.catalog_quota ao longo do tempo -- so o seed
-- inicial (migracao 0042: idea=3, garage=15, motherfunding=40) e a
-- entrega manual pontual via unlockPack(). Um founder no tecto do seu
-- plano fica ali para sempre, mesmo a copy do proprio cartao de planos
-- prometendo "Up to 10/25/50 new Sherlock Deal investors per month"
-- (plans.ts, WATSON_DRAFT_QUOTA/PLAN_PIPELINE_MONTHLY_ADDITION ja usam
-- este padrao "up to N/month" para outras quotas).
--
-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- 1) orgs.catalog_last_monthly_delivery (date, nullable) -- o marcador
--    "ja corri para esta org neste mes" pedido pelo prompt, para o job
--    (piggyback no cron diario /api/automations, vercel.json 0 9 * * *
--    -- plano Hobby so permite 1x/dia) nunca entregar duas vezes no mesmo
--    mes mesmo com re-tentativas do mesmo dia ou uma segunda invocacao
--    acidental. NULL = nunca correu para esta org. Guardado como a data do
--    PRIMEIRO DIA do mes em que correu (nao a data exacta de execucao),
--    para uma comparacao trivial ano/mes em SQL ou em JS sem re-derivar
--    "que mes e este timestamp" em dois sitios.
--
-- 2) Escotilha service_role em catalog_top_matches -- mesmo padrao ja
--    estabelecido nesta base de dados para RPCs SECURITY DEFINER chamadas
--    por rotas server-side sem sessao de utilizador (ver 0136, 0141, 0154:
--    "auth.role() is distinct from 'service_role' and not (...)").
--    catalog_top_matches (0149/0150) so aceita is_org_member(p_org_id) ou
--    is_platform_admin() -- ambos dependem de auth.uid(), que e NULL numa
--    chamada service_role (sem JWT de utilizador, confirmado ao tentar
--    chamar a funcao via SQL directo nesta sessao: "not authorized"). Sem
--    esta escotilha, o job mensal (que tem de correr para TODAS as orgs,
--    nao so a de um utilizador com sessao activa) nao conseguiria chamar
--    catalog_top_matches -- exactamente o "mesmo mecanismo do unlockPack"
--    que o prompt pede para a entrega. Aditiva apenas: nenhum caller
--    autenticado existente perde acesso, so se acrescenta um novo caller
--    permitido.
-- =============================================================================

alter table public.orgs add column catalog_last_monthly_delivery date;

create or replace function public.catalog_top_matches(p_org_id uuid, p_limit int)
returns table(catalog_id uuid, score int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' and not (is_org_member(p_org_id) or is_platform_admin()) then
    raise exception 'not authorized';
  end if;
  if p_limit <= 0 then return; end if;

  return query
    select scored.id as catalog_id, scored.score
    from (
      select ce.id, public.catalog_match_score(p_org_id, ce.id) as score
      from public.catalog_entities ce
      where ce.verification_status = 'verified'
        and not ce.is_test
        and not exists (
          select 1 from public.catalog_deliveries cd
          where cd.org_id = p_org_id and cd.catalog_id = ce.id
        )
    ) scored
    order by scored.score desc nulls last
    limit p_limit;
end;
$$;

revoke all on function public.catalog_top_matches(uuid, int) from public, anon;
grant execute on function public.catalog_top_matches(uuid, int) to authenticated, service_role;

-- catalog_match_score itself also needs the same escape hatch: it's called
-- BY catalog_top_matches for every candidate row, in the SAME transaction —
-- but as a SEPARATE security definer call, is_org_member(p_org_id)/
-- is_platform_admin() inside IT are re-evaluated independently and would
-- also fail under a service_role caller with no JWT.
create or replace function public.catalog_match_score(p_org_id uuid, p_catalog_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org record;
  v_cat record;
  v_score int := 0;
  v_rank_org int;
  v_rank_min int;
  v_rank_max int;
  v_lo int;
  v_hi int;
  v_dist int;
  v_ticket numeric;
  v_org_country_code text;
begin
  if auth.role() is distinct from 'service_role' and not (is_org_member(p_org_id) or is_platform_admin()) then
    raise exception 'not authorized';
  end if;

  select sectors, stage, round_min_ticket_eur, round_target_eur, country
    into v_org
    from public.orgs where id = p_org_id;
  if not found then return null; end if;

  select sectors_normalized, stage_min, stage_max, check_min_eur, check_max_eur,
         hq_country, enrichment_status, verification_status
    into v_cat
    from public.catalog_entities where id = p_catalog_id;
  if not found or v_cat.verification_status <> 'verified' then return null; end if;

  if coalesce(array_length(v_cat.sectors_normalized, 1), 0) = 0 then
    v_score := v_score + 35;
  elsif v_cat.sectors_normalized && v_org.sectors then
    v_score := v_score + 35;
  end if;

  v_rank_org := case v_org.stage
    when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6
    else null end;
  v_rank_min := case v_cat.stage_min
    when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6
    else null end;
  v_rank_max := case v_cat.stage_max
    when 'pre_seed' then 1 when 'seed' then 2 when 'series_a' then 3
    when 'series_b' then 4 when 'series_c_plus' then 5 when 'later' then 6
    else null end;

  if v_cat.stage_min is null and v_cat.stage_max is null then
    v_score := v_score + 25;
  elsif v_org.stage = 'other' or v_cat.stage_min = 'other' or v_cat.stage_max = 'other' then
    v_score := v_score + 25;
  elsif v_rank_org is null then
    v_score := v_score + 25;
  else
    v_lo := coalesce(v_rank_min, 1);
    v_hi := coalesce(v_rank_max, 6);
    if v_rank_org between v_lo and v_hi then
      v_score := v_score + 25;
    else
      v_dist := least(abs(v_rank_org - v_lo), abs(v_rank_org - v_hi));
      if v_dist = 1 then v_score := v_score + 10; end if;
    end if;
  end if;

  v_ticket := coalesce(v_org.round_min_ticket_eur, v_org.round_target_eur);
  if v_ticket is null or v_cat.check_min_eur is null or v_cat.check_max_eur is null then
    v_score := v_score + 20;
  elsif v_ticket between v_cat.check_min_eur and v_cat.check_max_eur then
    v_score := v_score + 20;
  elsif (v_ticket < v_cat.check_min_eur and v_ticket * 2 >= v_cat.check_min_eur)
     or (v_ticket > v_cat.check_max_eur and v_ticket <= v_cat.check_max_eur * 2) then
    v_score := v_score + 10;
  end if;

  v_org_country_code := case lower(btrim(coalesce(v_org.country, '')))
    when 'portugal' then 'PT' when 'spain' then 'ES' when 'united kingdom' then 'GB'
    when 'uk' then 'GB' when 'germany' then 'DE' when 'france' then 'FR'
    when 'netherlands' then 'NL' when 'switzerland' then 'CH' when 'sweden' then 'SE'
    when 'denmark' then 'DK' when 'finland' then 'FI' when 'norway' then 'NO'
    when 'ireland' then 'IE' when 'belgium' then 'BE' when 'italy' then 'IT'
    when 'austria' then 'AT' when 'luxembourg' then 'LU' when 'poland' then 'PL'
    when 'greece' then 'GR' when 'czech republic' then 'CZ' when 'czechia' then 'CZ'
    when 'hungary' then 'HU' when 'romania' then 'RO' when 'bulgaria' then 'BG'
    when 'croatia' then 'HR' when 'slovenia' then 'SI' when 'slovakia' then 'SK'
    when 'estonia' then 'EE' when 'latvia' then 'LV' when 'lithuania' then 'LT'
    when 'iceland' then 'IS' when 'malta' then 'MT' when 'cyprus' then 'CY'
    else null end;

  if v_cat.hq_country is not null and v_cat.hq_country = v_org_country_code then
    v_score := v_score + 2;
  elsif v_cat.hq_country in ('GB','DE','FR','NL','CH','SE') then
    v_score := v_score + 10;
  elsif v_cat.hq_country in ('DK','FI','NO','IE','BE','AT','IT') then
    v_score := v_score + 7;
  else
    v_score := v_score + 5;
  end if;

  if v_cat.enrichment_status = 'enriched' then
    v_score := v_score + 10;
  end if;

  return v_score;
end;
$$;

revoke all on function public.catalog_match_score(uuid, uuid) from public, anon;
grant execute on function public.catalog_match_score(uuid, uuid) to authenticated, service_role;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select column_name from information_schema.columns
--   where table_name='orgs' and column_name='catalog_last_monthly_delivery';
-- -- Esperado: 1 linha.
--
-- set local role service_role;
-- select count(*) from catalog_top_matches(
--   (select id from orgs where name = 'Estojo'), 5
-- );
-- -- Esperado: 5 linhas, sem "not authorized" (confere a escotilha).
-- reset role;
-- =============================================================================
