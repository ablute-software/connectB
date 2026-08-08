-- APLICADO em produção 2026-08-08 20:22:42 UTC (versão 20260808215822).
-- Texto idêntico ao aplicado, md5 verificado (8033ebc29f05f712a5ad486b1518725f).
-- Ver 0150_catalog_top_matches_exclude_test_entities.sql para a correção
-- aplicada no mesmo dia (catalog_top_matches não filtrava is_test — ver
-- esse ficheiro para o achado completo).

-- Prompt 139 — motor de correspondencia catalogo -> pipeline (setor/fase/
-- cheque/geografia/dados-prontos). PROPOSTA, NAO APLICADA — esta sessao nao
-- aplica as proprias migracoes; revista e verificada contra producao antes
-- de qualquer aplicacao (mesmo padrao das anteriores, ex. 0145/0146).
--
-- Substitui a fonte de dados de unlockPack() (src/lib/store-supabase.tsx):
-- em vez do pack fixo "Starter Europe" (pack_items, curado a mao, fit_score
-- sempre 'medium', wave sempre 3), a pipeline passa a ser preenchida pelas
-- entidades verificadas com melhor pontuacao real para o perfil da org.
-- packs/pack_items ficam na base, inertes, para rollback facil.
--
-- Duas correccoes feitas nesta proposta ao desenho original do prompt,
-- ambas confirmadas empiricamente antes de escrever SQL nenhum (e
-- aprovadas pelo Nuno num addendum antes desta entrega):
--
-- 1) orgs.catalog_quota NAO e "quota do plano menos usado" — e um tecto
--    acumulado, semeado por CATALOG_QUOTA[tier] e NUNCA baixado (ver
--    src/lib/plan-sync.ts). O p_limit certo para catalog_top_matches e
--    `orgs.catalog_quota - count(catalog_deliveries desta org)`, calculado
--    no lado do cliente (unlockPack) antes de chamar a funcao — nao dentro
--    dela, para a manter uma funcao de seleccao pura.
--
-- 2) A ORDEM FISICA do enum `stage` no Postgres (pg_enum.enumsortorder,
--    medida directamente) NAO e a ordem semantica que o proprio prompt
--    descreve. Medido: pre_seed(1) < seed(2) < series_a(3) < later(4) <
--    other(5) < series_b(6) < series_c_plus(7) — "later" ordena ANTES de
--    series_b/series_c_plus, nao depois. Usar os operadores nativos
--    <=/>= do enum (o que "usa a ordem real do enum" sugere a uma leitura
--    literal) teria comparado fase de forma silenciosamente errada — ex.:
--    um fundo com stage_max='series_b' teria aceite sem restricao uma
--    startup em stage='later', que fisicamente (4) cai dentro de
--    pre_seed..series_b (1..6) mas nao devia contar como dentro do
--    intervalo. Corrigido com um mapeamento EXPLICITO de rank (CASE
--    inline, so usado aqui — nao vale um helper à parte), na ordem
--    semantica que o prompt pede: pre_seed=1, seed=2, series_a=3,
--    series_b=4, series_c_plus=5, later=6. 'other' nunca entra neste
--    mapeamento numerico — e sempre um ramo a parte (comodin em qualquer
--    lado), exactamente como o prompt já pedia.
--
-- Terceira correccao, nao pedida no prompt mas encontrada ao verificar os
-- dados reais antes de escrever o criterio de geografia: orgs.country
-- guarda o NOME completo do pais ("Portugal", "Spain" — confirmado, 100%
-- das 9 orgs reais), enquanto catalog_entities.hq_country guarda sempre um
-- codigo ISO de 2 letras ("PT", "ES", "GB"...). Uma comparacao directa
-- (hq_country = country) nunca seria verdadeira, para nenhuma org, mesmo
-- quando o pais e literalmente o mesmo — o criterio "mesmo pais -> 2 pts"
-- nunca dispararia. Corrigido com uma normalizacao inline (nome -> ISO-2)
-- cobrindo os paises europeus plausiveis; um nome nao reconhecido cai no
-- balde "restantes paises" (5 pts) em vez de rebentar a funcao.

-- ============================================================
-- D1 — catalog_match_score: pontuacao 0-100 de uma entidade do catalogo
-- para o perfil de uma org. "Sem dado = credito total" em cada criterio,
-- por instrucao explicita do prompt (o mesmo principio de
-- src/lib/investor-match-score.ts, direccao contraria).
-- ============================================================
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
  if not (is_org_member(p_org_id) or is_platform_admin()) then
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

-- ============================================================
-- D2 — catalog_top_matches: as p_limit melhores entidades verificadas
-- ainda nao entregues a esta org, ordenadas por pontuacao desc.
-- ============================================================
create or replace function public.catalog_top_matches(p_org_id uuid, p_limit int)
returns table(catalog_id uuid, score int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (is_org_member(p_org_id) or is_platform_admin()) then
    raise exception 'not authorized';
  end if;
  if p_limit <= 0 then return; end if;

  return query
    select scored.id as catalog_id, scored.score
    from (
      select ce.id, public.catalog_match_score(p_org_id, ce.id) as score
      from public.catalog_entities ce
      where ce.verification_status = 'verified'
        and not exists (
          select 1 from public.catalog_deliveries cd
          where cd.org_id = p_org_id and cd.catalog_id = ce.id
        )
    ) scored
    order by scored.score desc nulls last
    limit p_limit;
end;
$$;

revoke all on function public.catalog_match_score(uuid, uuid) from public, anon;
revoke all on function public.catalog_top_matches(uuid, int) from public, anon;
grant execute on function public.catalog_match_score(uuid, uuid) to authenticated;
grant execute on function public.catalog_top_matches(uuid, int) to authenticated;
