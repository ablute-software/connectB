-- RETROACTIVE — reconstrução, nao autoria, nao captura verbatim. APLICADO
-- em produção (versão 20260809195332), 4 minutos depois de 0153. Nunca vi
-- o ficheiro original desta migração — só descobri que existia ao
-- verificar `list_migrations` depois de reconciliar 0153 (0153
-- explicitamente NÃO tocou matchdeal_eligible_deck, chamando-o de
-- "carve-out permanente, nunca tocar sem sign-off explicito" — esta
-- migração é, aparentemente, esse sign-off, num ficheiro separado).
--
-- Correcção (Nuno, 2026-08-09): a frase anterior aqui dizia "captura fiel
-- via pg_get_functiondef... não uma reconstrução" — errado. A saída real
-- de pg_get_functiondef() vem com as palavras-chave em maiúsculas (CREATE
-- OR REPLACE FUNCTION / RETURNS / LANGUAGE / SECURITY DEFINER / SET...TO);
-- o texto abaixo está em minúsculas, a convenção deste repositório. Isso só
-- é possível porque transcrevi/reformatei manualmente a definição lida —
-- é uma reconstrução fiel ao SQL (mesma lógica, confirmada linha a linha
-- contra a saída da tool), não uma cópia byte-a-byte da saída da tool.
--
-- O que muda, comparado à versão anterior (0053 + matchdeal_deck_replay_mode
-- + matchdeal_deck_symmetric_is_test + matchdeal_eligible_deck_*_exempt_*):
-- um guarda de autorização novo, no topo da função, antes de qualquer outra
-- lógica —
--
--   if auth.role() is distinct from 'service_role'
--      and not exists (
--        select 1 from matchdeal_current_profile_ids() as f(id)
--        where f.id = p_viewer_profile_id
--      ) then
--     raise exception 'MATCHDEAL_NOT_YOUR_PROFILE';
--   end if;
--
-- Mesmo padrão "bind RPC ao chamador real" já aplicado a
-- record_swipe/record_exposure/undo_swipe/weekly_quota_status (0136/0138) —
-- sem isto, um chamador autenticado podia pedir o deck de QUALQUER
-- p_viewer_profile_id, não só o seu próprio, e via a fila de outra pessoa.
-- Nenhuma lógica de filtragem/ordenação/quota do deck foi alterada — só
-- esta verificação de posse, à cabeça.

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
    and (v_exempt or v_viewer_is_test or not public.matchdeal_profile_is_test(p.id))
    and (v_viewer.kind <> 'investor' or v_viewer.sectors = '{}' or p.sectors && v_viewer.sectors)
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.stages_invested,1) is null or p.investment_stage_sought = any(v_viewer.stages_invested))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.geographies,1) is null or p.country = any(v_viewer.geographies))
    and (v_viewer.kind <> 'investor' or array_length(v_viewer.phases_accepted,1) is null or p.company_phase = any(v_viewer.phases_accepted))
    and (v_viewer.kind <> 'startup' or array_length(p.stages_invested,1) is null or v_viewer.investment_stage_sought = any(p.stages_invested))
    and (v_viewer.kind <> 'startup' or array_length(p.geographies,1) is null or v_viewer.country = any(p.geographies))
    and (v_viewer.kind <> 'startup' or array_length(p.phases_accepted,1) is null or v_viewer.company_phase = any(p.phases_accepted))
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
