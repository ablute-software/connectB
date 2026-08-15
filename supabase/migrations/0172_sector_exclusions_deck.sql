-- Prompt 200 §C — exclusões de sector deixam de ser decorativas.
--
-- Até aqui exclusions_sectors/exclusions_notes só eram lidos por
-- MatchDealDeck.tsx, e só para desenhar a etiqueta "Does not invest in".
-- Nada filtrava: nem o scoring (investor-match-score.ts, sem termo de
-- exclusão), nem esta função, que só tem lógica de INCLUSÃO por overlap de
-- sectores. Isto é regra de negócio nova, não uma afinação.
--
-- Decisão (Nuno, 2026-08-15): hard filter, nos dois sítios. Uma exclusão
-- elimina a startup, não lhe baixa o score.
--
-- ESTA NORMALIZAÇÃO É UM ESPELHO de src/lib/sector-exclusions.ts. Os dois
-- lados têm testes sobre os mesmos casos reais de produção; se mexeres num,
-- mexe no outro:
--   1. minúsculas; 2. separar em , ; / & + | e newline; 3. só [a-z0-9 ],
--   espaços colapsados. NUNCA separar por espaços ("digital health" é um
--   termo só).
-- Colisão entre termo da startup (s) e da exclusão (e):
--   A. contenção por palavras inteiras, nos dois sentidos ("health" apanha
--      "digital health"; "tech" NÃO apanha "agritech");
--   B. igualdade sem espaços ("food tech" = "foodtech" — o caso real do
--      perfil 637f8c2a). Igualdade, nunca substring, senão "ai" excluía
--      "retail".
-- O passo 3 é também o que torna o LIKE da regra A seguro: depois de
-- normalizado não sobra nenhum % nem _ para o LIKE interpretar.

create or replace function public.sector_terms(p_inputs text[])
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct s.t), '{}'::text[])
  from (
    select btrim(regexp_replace(regexp_replace(lower(piece), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g')) as t
    from unnest(coalesce(p_inputs, '{}'::text[])) as raw,
         lateral regexp_split_to_table(raw, '[,;/&+|\n\r]+') as piece
  ) s
  where s.t <> ''
$$;

create or replace function public.sector_terms_collide(p_startup text, p_exclusion text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select case
    when coalesce(p_startup, '') = '' or coalesce(p_exclusion, '') = '' then false
    when (' ' || p_startup || ' ') like ('% ' || p_exclusion || ' %') then true   -- regra A
    when (' ' || p_exclusion || ' ') like ('% ' || p_startup || ' %') then true   -- regra A, inverso
    else replace(p_startup, ' ', '') = replace(p_exclusion, ' ', '')              -- regra B
  end
$$;

create or replace function public.sector_excluded(p_sectors text[], p_excl_sectors text[], p_excl_notes text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select exists (
    select 1
    from unnest(public.sector_terms(p_sectors)) as s,
         unnest(public.sector_terms(coalesce(p_excl_sectors, '{}'::text[]) || array[coalesce(p_excl_notes, '')])) as e
    where public.sector_terms_collide(s, e)
  )
$$;

-- Só a matchdeal_eligible_deck (SECURITY DEFINER, corre como owner) precisa
-- destas — nenhum cliente as chama directamente.
revoke all on function public.sector_terms(text[]) from public, anon, authenticated;
revoke all on function public.sector_terms_collide(text, text) from public, anon, authenticated;
revoke all on function public.sector_excluded(text[], text[], text) from public, anon, authenticated;

-- matchdeal_eligible_deck: igual à versão de 0154 + dois predicados novos,
-- aplicados nos DOIS sentidos e nos DOIS sítios onde a piscina é avaliada.
--
-- Simetria, de propósito: se o investidor exclui o sector da startup, a
-- startup também não deve ver esse investidor no deck dela. Um match exige
-- like dos dois lados, portanto mostrar ao founder um investidor que já
-- declarou não investir naquele sector só gasta swipe e cria falsa
-- expectativa.
--
-- O predicado tem de entrar TAMBÉM na contagem v_pool_count do
-- deck_replay_mode: essa contagem decide quando apagar os swipes e recomeçar
-- o baralho. Se contasse uma piscina maior do que a que a query principal
-- devolve, o replay nunca dispararia (v_liked_count nunca alcançava
-- v_pool_count) e o investidor ficava com o deck vazio para sempre.
create or replace function public.matchdeal_eligible_deck(p_viewer_profile_id uuid, p_limit integer default 20)
returns setof matchdeal_profiles
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_viewer public.matchdeal_profiles;
  v_viewer_is_test boolean;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
  v_remaining int;
  v_effective_limit int;
  v_liked_count int;
  v_pool_count int;
  v_exempt boolean;
begin
  if auth.role() is distinct from 'service_role'
     and not exists (
       select 1 from public.matchdeal_current_profile_ids() as f(id)
       where f.id = p_viewer_profile_id
     ) then
    raise exception 'MATCHDEAL_NOT_YOUR_PROFILE';
  end if;

  select * into v_viewer from public.matchdeal_profiles where id = p_viewer_profile_id;
  v_viewer_is_test := public.matchdeal_profile_is_test(p_viewer_profile_id);
  v_weekly := public.matchdeal_get_or_create_weekly_activity(p_viewer_profile_id);
  select * into v_limits from public.matchdeal_tier_limits(v_viewer.plan_tier);
  v_remaining := greatest(v_limits.deck_size - v_weekly.shown_count, 0);
  v_exempt := public.is_ablute_developer();
  if not v_exempt and v_remaining = 0 then return; end if;
  v_effective_limit := case when v_exempt then p_limit else least(p_limit, v_remaining) end;

  if v_viewer.deck_replay_mode then
    select count(*) into v_pool_count
    from public.matchdeal_profiles p
    where p.is_visible = true
      and p.kind <> v_viewer.kind
      and (v_exempt or v_viewer_is_test or not public.matchdeal_profile_is_test(p.id))
      and (v_viewer.kind <> 'investor' or v_viewer.sectors = '{}' or p.sectors && v_viewer.sectors)
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.stages_invested,1) is null or p.investment_stage_sought = any(v_viewer.stages_invested))
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.geographies,1) is null or p.country = any(v_viewer.geographies))
      and (v_viewer.kind <> 'investor' or array_length(v_viewer.phases_accepted,1) is null or p.company_phase = any(v_viewer.phases_accepted))
      and (v_viewer.kind <> 'investor' or not public.sector_excluded(p.sectors, v_viewer.exclusions_sectors, v_viewer.exclusions_notes))
      and (v_viewer.kind <> 'startup' or array_length(p.stages_invested,1) is null or v_viewer.investment_stage_sought = any(p.stages_invested))
      and (v_viewer.kind <> 'startup' or array_length(p.geographies,1) is null or v_viewer.country = any(p.geographies))
      and (v_viewer.kind <> 'startup' or array_length(p.phases_accepted,1) is null or v_viewer.company_phase = any(p.phases_accepted))
      and (v_viewer.kind <> 'startup' or not public.sector_excluded(v_viewer.sectors, p.exclusions_sectors, p.exclusions_notes));

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
    and (v_exempt or v_viewer_is_test or not public.matchdeal_profile_is_test(p.id))
    and (v_viewer.kind <> 'investor' or v_viewer.sectors = '{}' or p.sectors && v_viewer.sectors)
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.stages_invested,1) is null or p.investment_stage_sought = any(v_viewer.stages_invested))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.geographies,1) is null or p.country = any(v_viewer.geographies))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.phases_accepted,1) is null or p.company_phase = any(v_viewer.phases_accepted))
    and (v_viewer.kind <> 'investor' or not public.sector_excluded(p.sectors, v_viewer.exclusions_sectors, v_viewer.exclusions_notes))
    and (v_viewer.kind <> 'startup' or array_length(p.stages_invested,1) is null or v_viewer.investment_stage_sought = any(p.stages_invested))
    and (v_viewer.kind <> 'startup' or array_length(p.geographies,1) is null or v_viewer.country = any(p.geographies))
    and (v_viewer.kind <> 'startup' or array_length(p.phases_accepted,1) is null or v_viewer.company_phase = any(p.phases_accepted))
    and (v_viewer.kind <> 'startup' or not public.sector_excluded(v_viewer.sectors, p.exclusions_sectors, p.exclusions_notes))
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
  limit v_effective_limit;
end; $function$;
