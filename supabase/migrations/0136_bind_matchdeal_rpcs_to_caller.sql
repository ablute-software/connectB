-- =============================================================================
-- 0136_bind_matchdeal_rpcs_to_caller.sql
--
-- ESTADO: APLICADO em producao (wkjcaoqdvhykrfacsylr) em 06/08/2026, 17:5x UTC,
-- por decisao explicita do Nuno (Opcao A2, escolhida em resposta directa a uma
-- pergunta desta sessao apos a sessao Code ter feito a mesma pergunta sob outro
-- angulo). Pre-verificado (ACLs e md5(prosrc) das 3 RPC + access_grants +
-- contagens de swipes/exposures/matches/weekly identicos ao ultimo estado
-- medido) e pos-verificado com a query no fim deste ficheiro: anon_pode=false,
-- public_pode=false, auth_pode=true, tem_guarda=true, cfg='search_path=public,
-- pg_temp' nas tres. matchdeal_activate_super_like inalterada (d49cca6f...).
-- access_grants: 106 linhas, granted_at max inalterado. Advisors depois: 0
-- ERROR, WARN cai de 97 para 90 (-4 anon_security_definer_function_executable,
-- -3 function_search_path_mutable), exactamente as tres funcoes tocadas.
-- Aplicado junto com 0137_revoke_anon_matchdeal_eligible_deck.sql (D3),
-- tambem escolhida pelo Nuno na mesma decisao.
--
-- Ficheiro companheiro (contexto completo da decisao):
--   relatorio_tier2_matchdeal_rpcs_forjaveis_por_anon_20260806.md
-- =============================================================================
--
-- O PROBLEMA, EM UMA FRASE
-- ------------------------
-- Quatro RPC MatchDeal sao SECURITY DEFINER, aceitam o id do perfil como
-- parametro do cliente, nunca o amarram a auth.uid(), e tem EXECUTE concedido a
-- PUBLIC. Resultado: qualquer pessoa com a anon key -- sem sessao, sem conta --
-- escreve na base como se fosse qualquer perfil. As politicas RLS das tabelas
-- que estas funcoes escrevem JA codificam a regra certa; as funcoes e que nunca
-- as consultam, porque SECURITY DEFINER as contorna por construcao.
--
-- MEDIDO EM PRODUCAO (nao inferido), 2026-08-06, projecto wkjcaoqdvhykrfacsylr:
--
--   proacl das quatro = {=X/postgres,postgres=X/postgres,anon=X/postgres,
--                        authenticated=X/postgres,service_role=X/postgres}
--   O "=X/postgres" a cabeca e a concessao a PUBLIC.
--   has_function_privilege('public', ..., 'EXECUTE') = true nas quatro.
--
--   Ensaio com rollback, como role anon e auth.uid() NULL:
--     insert directo em matchdeal_swipes ....... BLOQUEADO pela RLS
--     matchdeal_record_swipe(...)  ............. PASSOU  <-- o buraco
--     matchdeal_record_exposure(...) ........... PASSOU  <-- o buraco
--   Lido de volta como postgres: linha_vista_como_postgres=1 direccao=pass.
--   Residuo depois do rollback: zero (contagens e md5 identicos).
--
-- CONTRASTE QUE INTERESSA: as funcoes INTERNAS da mesma familia ja estao bem
-- fechadas -- matchdeal_handle_mutual_match, matchdeal_get_or_create_weekly_-
-- activity e matchdeal_activate_super_like tem ACL {postgres,service_role} e
-- anon_pode=false. Ou seja, o projecto sabe fechar; estas quatro escaparam.
--
-- =============================================================================
-- AS DUAS CAMADAS
-- =============================================================================
--
-- CAMADA 1 (ACL): revogar EXECUTE a PUBLIC e a anon, mantendo authenticated e
--   service_role. Isto e uma CORRECCAO A MINHA PROPRIA NOTA em
--   0134_revoke_execute_matchdeal_and_misc_definer_functions.sql:110-140, onde
--   escrevi "Revogar partia o deck". Essa nota confundiu revogacao a TODOS os
--   roles com revogacao so a anon. Medido agora no repo @158be30: os unicos
--   call sites destas RPC sao quatro linhas em
--   src/components/matchdeal/MatchDealDeck.tsx (561, 583, 636, 675), todas via
--   browserClient(), sempre num dispositivo com sessao GoTrue hidratada
--   (src/app/pair/page.tsx:169 chama auth.setSession()). Com sessao hidratada o
--   PostgREST resolve o role para "authenticated", nao "anon". Nao existe
--   nenhum chamador server-side/service_role em todo o src/.
--   Ressalva honesta: hoje, se a hidratacao da sessao falhasse, a chamada
--   continuava a "funcionar" pelo buraco do DEFINER. A Camada 1 remove esse
--   fallback acidental. Isso nao e uma regressao -- e deixar de mascarar uma
--   falha de sessao -- mas pode revelar avarias latentes.
--
-- CAMADA 2 (guarda): amarrar o parametro ao chamador dentro da funcao.
--   Forma "not exists", nao "not in": "x not in (... NULL ...)" avalia a NULL e
--   e falso, portanto FAIL-OPEN. "not exists (...)" e fail-closed por
--   construcao. Esta distincao nao e estilo -- e a diferenca entre uma guarda
--   que protege e uma que nao protege.
--
-- CAMADA 3 (search_path): "SET search_path = public, pg_temp". Seguro porque
--   os tres corpos qualificam com "public." todas as referencias. Fecha 3 dos
--   31 avisos function_search_path_mutable. Para dispensar, apagar a linha
--   "SET search_path" das tres funcoes -- nao ha mais nada acoplado.
--
-- =============================================================================
-- A ESCOTILHA service_role -- porque existe (achado tardio, mudou a recomendacao)
-- =============================================================================
-- matchdeal_activate_super_like e service_role-only E TERMINA EM:
--     perform public.matchdeal_record_swipe(p_actor_profile_id, ..., 'like');
-- Uma chamada service_role nao traz JWT de utilizador, logo auth.uid() e NULL e
-- uma guarda ingenua PARTIRIA o super like no dia em que ele saisse do estado
-- dormente (hoje nao tem call site: BoostExtraPanel.tsx:6 e so um comentario).
-- Por isso a guarda comeca com:
--     auth.role() is distinct from 'service_role' and not exists (...)
-- auth.role() le request.jwt.claims, GUC que o PostgREST so escreve DEPOIS de
-- verificar a assinatura do JWT -- nao e forjavel por um cliente. Uma ligacao
-- postgres directa (psql, MCP, migracao) tem auth.role() NULL e fica sujeita a
-- guarda; para manutencao SQL, mexer nas tabelas em vez das RPC.
--
-- =============================================================================
-- PROVA DE QUE ESTE PATCH FUNCIONA (ensaio com rollback, 2026-08-06)
-- =============================================================================
-- Apliquei este corpo dentro de uma transaccao revertida e chamei a funcao com
-- as quatro classes de chamador:
--
--   md5_antes=d01fd086  md5_patch=3e9ed154
--   T1_anon    = BLOQUEADO [MATCHDEAL_NOT_YOUR_PROFILE]   <- exploit fechado
--   T2_dono    = PASSOU (BOM)                             <- sem regressao
--   T3_outro   = BLOQUEADO [MATCHDEAL_NOT_YOUR_PROFILE]   <- forja entre contas fechada
--   T4_service = PASSOU (BOM)                             <- super like sobrevive
--
-- T3 e o teste que mais importa: o atacante realista nao e o anonimo, e
-- qualquer utilizador registado a agir em nome do perfil de outro.
--
-- Residuo pos-rollback verificado: md5 das quatro RPC de volta ao valor
-- original (record_swipe d01fd086..., record_exposure d851d1dc...,
-- undo_swipe 3fea61b2..., eligible_deck b74197a2...), proconfig nulo, ACL
-- inalterada, swipes 11 / exposures 103 / matches 3 / weekly 4 /
-- access_grants 106 @ 2026-08-06 11:34:14.539462+00.
--
-- NOTA DE HONESTIDADE: o ensaio exercitou a guarda em matchdeal_record_swipe.
-- Em matchdeal_record_exposure e matchdeal_undo_swipe a guarda e textualmente
-- identica mas NAO foi disparada em producao -- undo_swipe termina no caminho
-- 'like' e pode alcancar o motor de matches, e nao o fiz de proposito.
--
-- =============================================================================
-- COMPATIBILIDADE COM OS DADOS QUE JA EXISTEM (medido, nao assumido)
-- =============================================================================
-- Para cada perfil com actividade real, verifiquei se a guarda o deixaria
-- passar. Resultado: 8/8 PASSA (6 "investor active", 2 "org_member"; o perfil
-- fc9974e7 aparece duas vezes por a org ter dois membros, nao e duplicado).
-- ZERO utilizadores legitimos bloqueados.
-- Dos 19 perfis matchdeal, 6 nao tem membership resolvivel -- todos semente/demo
-- (b341ec3b + e2000000-...-0001..0005), sem utilizador dono nenhum. Nunca
-- poderiam satisfazer a guarda porque ninguem se consegue autenticar como eles:
-- se algum caminho depender de agir como esses perfis, esse caminho depende da
-- vulnerabilidade.
--
-- =============================================================================
-- O QUE ESTE FICHEIRO NAO TOCA
-- =============================================================================
-- matchdeal_eligible_deck: NAO e tocada aqui. Proibicao permanente. Fica em
-- aberto a decisao D3 (revogar anon so na ACL, sem tocar no prosrc, mantendo a
-- ancora md5 b74197a2e721df7112165064504e63b4 intacta) -- ver relatorio.
-- access_grants: nao e tocada.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- CAMADA 2 + 3 :: matchdeal_record_swipe
-- Corpo reproduzido byte a byte do prosrc de producao (md5 d01fd086525f44e554
-- b8d3b5351d2293), com dois acrescentos e nada mais: o bloco da guarda logo a
-- seguir ao "begin", e a linha SET search_path no cabecalho.
-- -----------------------------------------------------------------------------
create or replace function public.matchdeal_record_swipe(p_actor_profile_id uuid, p_target_profile_id uuid, p_direction text)
 returns uuid
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_reverse_like_exists boolean;
  v_actor_kind text;
  v_target_kind text;
  v_startup_profile_id uuid;
  v_investor_profile_id uuid;
  v_match_id uuid;
  v_actor public.matchdeal_profiles;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
begin
  -- GUARDA 0136: o id do actor tem de pertencer a quem esta a chamar.
  -- "not exists" e nao "not in" -- fail-closed por construcao.
  -- A escotilha service_role existe para matchdeal_activate_super_like, que
  -- chama esta funcao sem JWT de utilizador.
  if auth.role() is distinct from 'service_role'
     and not exists (
       select 1 from public.matchdeal_current_profile_ids() as f(id)
       where f.id = p_actor_profile_id
     ) then
    raise exception 'MATCHDEAL_NOT_YOUR_PROFILE';
  end if;

  if p_direction not in ('like','pass') then
    raise exception 'direction inválida: %', p_direction;
  end if;
  select * into v_actor from public.matchdeal_profiles where id = p_actor_profile_id;
  if p_direction = 'like' then
    v_weekly := public.matchdeal_get_or_create_weekly_activity(p_actor_profile_id);
    select * into v_limits from public.matchdeal_tier_limits(v_actor.plan_tier);
    if v_weekly.like_count >= v_limits.like_limit then
      raise exception 'MATCHDEAL_LIKE_LIMIT_REACHED';
    end if;
  end if;
  insert into public.matchdeal_swipes (actor_profile_id, target_profile_id, direction)
  values (p_actor_profile_id, p_target_profile_id, p_direction)
  on conflict (actor_profile_id, target_profile_id) do update set direction = excluded.direction;
  if p_direction = 'pass' then return null; end if;
  update public.matchdeal_weekly_activity
    set like_count = like_count + 1, updated_at = now()
    where profile_id = p_actor_profile_id and week_start = public.matchdeal_current_week_start();
  v_actor_kind := v_actor.kind;
  select kind into v_target_kind from public.matchdeal_profiles where id = p_target_profile_id;
  if v_actor_kind = v_target_kind then
    raise exception 'swipe entre dois perfis do mesmo tipo não é suportado';
  end if;
  select exists (
    select 1 from public.matchdeal_swipes
    where actor_profile_id = p_target_profile_id
      and target_profile_id = p_actor_profile_id and direction = 'like'
  ) into v_reverse_like_exists;
  if not v_reverse_like_exists then return null; end if;
  if v_actor_kind = 'startup' then
    v_startup_profile_id := p_actor_profile_id;
    v_investor_profile_id := p_target_profile_id;
  else
    v_startup_profile_id := p_target_profile_id;
    v_investor_profile_id := p_actor_profile_id;
  end if;
  v_match_id := public.matchdeal_handle_mutual_match(v_startup_profile_id, v_investor_profile_id);
  return v_match_id;
end; $function$;

-- -----------------------------------------------------------------------------
-- CAMADA 2 + 3 :: matchdeal_record_exposure
-- Corpo de producao md5 d851d1dc38809ddc2dde05b77188426a.
-- Aqui o parametro do dono chama-se p_viewer_profile_id.
-- -----------------------------------------------------------------------------
create or replace function public.matchdeal_record_exposure(p_viewer_profile_id uuid, p_shown_profile_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
begin
  -- GUARDA 0136 :: ver nota em matchdeal_record_swipe.
  if auth.role() is distinct from 'service_role'
     and not exists (
       select 1 from public.matchdeal_current_profile_ids() as f(id)
       where f.id = p_viewer_profile_id
     ) then
    raise exception 'MATCHDEAL_NOT_YOUR_PROFILE';
  end if;

  insert into public.matchdeal_exposures (viewer_profile_id, shown_profile_id)
  values (p_viewer_profile_id, p_shown_profile_id);
  perform public.matchdeal_get_or_create_weekly_activity(p_viewer_profile_id);
  update public.matchdeal_weekly_activity
    set shown_count = shown_count + 1, updated_at = now()
    where profile_id = p_viewer_profile_id and week_start = public.matchdeal_current_week_start();
end; $function$;

-- -----------------------------------------------------------------------------
-- CAMADA 2 + 3 :: matchdeal_undo_swipe
-- Corpo de producao md5 3fea61b2b83ccb9032be71538d437cc9.
-- A guarda fica aqui TAMBEM, e nao so por delegacao a record_swipe: undo_swipe
-- escreve undo_count ANTES de delegar, portanto sem guarda propria um atacante
-- gastava a quota de undo da vitima mesmo que a delegacao falhasse depois.
-- -----------------------------------------------------------------------------
create or replace function public.matchdeal_undo_swipe(p_actor_profile_id uuid, p_target_profile_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_actor public.matchdeal_profiles;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
  v_current_direction text;
begin
  -- GUARDA 0136 :: ver nota em matchdeal_record_swipe.
  if auth.role() is distinct from 'service_role'
     and not exists (
       select 1 from public.matchdeal_current_profile_ids() as f(id)
       where f.id = p_actor_profile_id
     ) then
    raise exception 'MATCHDEAL_NOT_YOUR_PROFILE';
  end if;

  select * into v_actor from public.matchdeal_profiles where id = p_actor_profile_id;
  select * into v_limits from public.matchdeal_tier_limits(v_actor.plan_tier);
  select direction into v_current_direction
  from public.matchdeal_swipes
  where actor_profile_id = p_actor_profile_id and target_profile_id = p_target_profile_id;
  if v_current_direction is distinct from 'pass' then
    raise exception 'Só é possível reconsiderar perfis rejeitados.';
  end if;
  v_weekly := public.matchdeal_get_or_create_weekly_activity(p_actor_profile_id);
  if v_limits.undo_limit is not null and v_weekly.undo_count >= v_limits.undo_limit then
    raise exception 'MATCHDEAL_UNDO_LIMIT_REACHED';
  end if;
  if v_weekly.like_count >= v_limits.like_limit then
    raise exception 'MATCHDEAL_LIKE_LIMIT_REACHED';
  end if;
  update public.matchdeal_weekly_activity
    set undo_count = undo_count + 1, updated_at = now()
    where profile_id = p_actor_profile_id and week_start = public.matchdeal_current_week_start();
  return public.matchdeal_record_swipe(p_actor_profile_id, p_target_profile_id, 'like');
end; $function$;

-- -----------------------------------------------------------------------------
-- CAMADA 1 :: ACL
-- "create or replace function" PRESERVA a ACL (mesma lei ja documentada para as
-- vistas no trabalho da 0135), portanto os replaces acima nao reconcederam
-- nada: estas revogacoes sao necessarias e sao o que efectivamente fecha a
-- porta a anon.
-- authenticated e service_role FICAM. Os quatro call sites reais correm como
-- authenticated (browserClient() + sessao hidratada).
-- -----------------------------------------------------------------------------
revoke execute on function public.matchdeal_record_swipe(uuid, uuid, text) from public, anon;
revoke execute on function public.matchdeal_record_exposure(uuid, uuid) from public, anon;
revoke execute on function public.matchdeal_undo_swipe(uuid, uuid) from public, anon;

commit;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR (esperado: 3 linhas, todas com
-- anon_pode=false, auth_pode=false para public, tem_guarda=true)
-- =============================================================================
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_pode,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_pode,
--        has_function_privilege('public', p.oid, 'EXECUTE')        as public_pode,
--        p.prosrc like '%MATCHDEAL_NOT_YOUR_PROFILE%'              as tem_guarda,
--        array_to_string(p.proconfig, ',')                         as cfg
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('matchdeal_record_swipe','matchdeal_record_exposure','matchdeal_undo_swipe')
-- order by p.proname;
--
-- Esperado: anon_pode=false, public_pode=false, auth_pode=TRUE,
--           tem_guarda=true, cfg='search_path=public, pg_temp'.
--
-- E o teste de aceitacao que nenhum SQL substitui: emparelhar um dispositivo
-- real, fazer um swipe, e confirmar no Network do browser que a chamada devolve
-- 200 e nao 403. Se der 403 com MATCHDEAL_NOT_YOUR_PROFILE, a sessao GoTrue nao
-- esta hidratada nesse dispositivo -- e isso e um bug que ate hoje estava
-- escondido pelo buraco.
-- =============================================================================
