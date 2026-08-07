-- =============================================================================
-- 0144_matchdeal_deck_symmetric_is_test.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Fica para o revisor aplicar e ler de volta.
-- Ficheiro companheiro: 01_visibilidade_simetrica_is_test.md (07/08/2026),
-- Plano B — "o buraco". matchdeal_eligible_deck() nunca juntou orgs nem
-- catalog_entities: filtra is_visible, kind, sectores, estagios, geografias,
-- fases, bloqueios e cooldowns, mas nao sabe nada de is_test. Consequencia
-- medida em producao: um investidor real que abra o MatchDeal ve as cinco
-- cartas demo e a "Sherlock Deal_ test".
--
-- =============================================================================
-- A REGRA (visibilidade simetrica, nao censura)
-- =============================================================================
-- is_test deixou de significar "esconder" e passou a significar COORTE:
--   (quem_ve.is_test) OR (NOT alvo.is_test)
-- Uma conta de teste ve teste + real; uma conta real ve so real. A unica
-- forma de testar a plataforma hoje e como conta de teste, por isso o
-- conteudo de teste nao pode desaparecer para essas contas.
--
-- Este e o UNICO ponto do motor de matching que esta migracao altera —
-- nenhuma mudanca a ordenacao, quotas, cooldowns ou deck_replay_mode. Ver
-- CLAUDE.md / 00_LEIA_PRIMEIRO.md §3.2 para a excepcao explicita a proibicao
-- permanente de mexer em matchdeal_eligible_deck (0136 linha ~138) — esta
-- migracao E essa excepcao, nomeada e justificada aqui.
--
-- =============================================================================
-- OPCAO ESCOLHIDA: funcao auxiliar (Opcao 1 do prompt), nao coluna
-- desnormalizada
-- =============================================================================
-- matchdeal_profiles nao tem coluna is_test, e a ligacao a quem a possui e
-- polimorfica sem FK (membership_id -> orgs se kind='startup', ->
-- matchdeal_investor_members se kind='investor'). Uma funcao auxiliar
-- resolve isto sem adicionar uma coluna desnormalizada a manter por
-- triggers em duas tabelas — menos maquinaria, e o custo de mais uma junção
-- por linha do deck e desprezavel a esta escala (single-digit orgs). Revisitar
-- com uma coluna + triggers só se um EXPLAIN real em produção mostrar custo,
-- não antes.
-- =============================================================================

begin;

create or replace function public.matchdeal_profile_is_test(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select o.is_test from matchdeal_profiles p
       join orgs o on o.id = p.membership_id
      where p.id = p_profile_id and p.kind = 'startup'),
    (select ce.is_test from matchdeal_profiles p
       join matchdeal_investor_members im on im.id = p.membership_id
       join catalog_entities ce on ce.id = im.catalog_entity_id
      where p.id = p_profile_id and p.kind = 'investor'),
    false
  );
$$;
revoke all on function public.matchdeal_profile_is_test(uuid) from public, anon;

-- Redefinicao completa de matchdeal_eligible_deck: corpo identico ao de
-- 0083_matchdeal_deck_replay_mode.sql, com v_viewer_is_test resolvido uma
-- vez logo a seguir a `select ... into v_viewer`, e o predicado aplicado
-- nos DOIS pontos que testam elegibilidade de um perfil alvo — o calculo de
-- v_pool_count (usado pelo deck_replay_mode para decidir quando o ciclo deu
-- a volta) e a query principal que devolve o baralho. Alterar so um deixa o
-- bug vivo no replay mode.
create or replace function public.matchdeal_eligible_deck(p_viewer_profile_id uuid, p_limit integer default 20)
 returns setof matchdeal_profiles
 language plpgsql
 security definer
as $function$
declare
  v_viewer public.matchdeal_profiles;
  v_viewer_is_test boolean;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
  v_remaining int;
  v_liked_count int;
  v_pool_count int;
begin
  select * into v_viewer from public.matchdeal_profiles where id = p_viewer_profile_id;
  v_viewer_is_test := public.matchdeal_profile_is_test(p_viewer_profile_id);
  v_weekly := public.matchdeal_get_or_create_weekly_activity(p_viewer_profile_id);
  select * into v_limits from public.matchdeal_tier_limits(v_viewer.plan_tier);
  v_remaining := greatest(v_limits.deck_size - v_weekly.shown_count, 0);
  if v_remaining = 0 then return; end if;

  if v_viewer.deck_replay_mode then
    -- Tamanho do pool elegível (mesmos filtros de compatibilidade, sem a
    -- exclusão por swipe) — usado só para decidir se o ciclo já deu a volta
    -- completa (todos os perfis já tiveram like nalgum momento).
    select count(*) into v_pool_count
    from public.matchdeal_profiles p
    where p.is_visible = true
      and p.kind <> v_viewer.kind
      and (v_viewer_is_test or not public.matchdeal_profile_is_test(p.id))
      and (v_viewer.kind <> 'investor' or v_viewer.sectors = '{}' or p.sectors && v_viewer.sectors)
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.stages_invested,1) is null or p.investment_stage_sought = any(v_viewer.stages_invested))
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.geographies,1) is null or p.country = any(v_viewer.geographies))
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.phases_accepted,1) is null or p.company_phase = any(v_viewer.phases_accepted))
      and (v_viewer.kind <> 'startup' or array_length(p.stages_invested,1) is null or v_viewer.investment_stage_sought = any(p.stages_invested))
      and (v_viewer.kind <> 'startup' or array_length(p.geographies,1) is null or v_viewer.country = any(p.geographies))
      and (v_viewer.kind <> 'startup' or array_length(p.phases_accepted,1) is null or v_viewer.company_phase = any(p.phases_accepted));

    select count(distinct target_profile_id) into v_liked_count
    from public.matchdeal_swipes
    where actor_profile_id = p_viewer_profile_id and direction = 'like';

    if v_pool_count > 0 and v_liked_count >= v_pool_count then
      delete from public.matchdeal_swipes where actor_profile_id = p_viewer_profile_id;
    end if;
  end if;

  return query
  select p.* from public.matchdeal_profiles p
  where p.is_visible = true
    and p.kind <> v_viewer.kind
    and (
      (not v_viewer.deck_replay_mode and p.id not in (
        select target_profile_id from public.matchdeal_swipes where actor_profile_id = p_viewer_profile_id
      ))
      or
      (v_viewer.deck_replay_mode and p.id not in (
        select target_profile_id from public.matchdeal_swipes where actor_profile_id = p_viewer_profile_id and direction = 'like'
      ))
    )
    and (v_viewer_is_test or not public.matchdeal_profile_is_test(p.id))
    and (v_viewer.kind <> 'investor' or v_viewer.sectors = '{}' or p.sectors && v_viewer.sectors)
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.stages_invested,1) is null or p.investment_stage_sought = any(v_viewer.stages_invested))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.geographies,1) is null or p.country = any(v_viewer.geographies))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.phases_accepted,1) is null or p.company_phase = any(v_viewer.phases_accepted))
    and (v_viewer.kind <> 'startup' or array_length(p.stages_invested,1) is null or v_viewer.investment_stage_sought = any(p.stages_invested))
    and (v_viewer.kind <> 'startup' or array_length(p.geographies,1) is null or v_viewer.country = any(p.geographies))
    and (v_viewer.kind <> 'startup' or array_length(p.phases_accepted,1) is null or v_viewer.company_phase = any(p.phases_accepted))
    -- Bloqueio de longa duração (§5.4). Vale nos dois sentidos: a startup
    -- não vê a entidade que bloqueou, e ninguém dessa entidade a vê a ela.
    and not exists (
      select 1 from public.matchdeal_entity_blocks bl
      where (v_viewer.kind = 'startup'
             and bl.startup_profile_id = p_viewer_profile_id
             and bl.catalog_entity_id = (
               select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = p.membership_id))
         or (v_viewer.kind = 'investor'
             and bl.startup_profile_id = p.id
             and bl.catalog_entity_id = (
               select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = v_viewer.membership_id))
    )
    -- Cooldown (30d recusa/fim pela startup, 90d fila esgotada por SLA).
    and not exists (
      select 1 from public.matchdeal_matches m
      where m.cooldown_until is not null and m.cooldown_until > now()
        and (
          (v_viewer.kind = 'startup' and m.startup_profile_id = p_viewer_profile_id
            and m.investor_catalog_entity_id = (
              select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = p.membership_id))
          or
          (v_viewer.kind = 'investor' and p.id = m.startup_profile_id
            and m.investor_catalog_entity_id = (
              select im.catalog_entity_id from public.matchdeal_investor_members im where im.id = v_viewer.membership_id))
        )
    )
  order by
    (not exists (
      select 1 from public.matchdeal_exposures e
      where e.viewer_profile_id = p_viewer_profile_id
        and e.shown_profile_id = p.id
        and e.shown_at > now() - interval '7 days'
    )) desc,
    random()
  limit least(p_limit, v_remaining);
end; $function$;

commit;
