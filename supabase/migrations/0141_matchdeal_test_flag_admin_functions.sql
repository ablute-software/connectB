-- =============================================================================
-- 0141_matchdeal_test_flag_admin_functions.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro:
--   mini_prompt_URGENTE_regressao_778f1bf_activegrantorgids_20260806.md §5.3
--
-- =============================================================================
-- PORQUE ESTA MIGRACAO EXISTE SEPARADA DA 0139
-- =============================================================================
-- Estas duas funcoes (set_org_is_test, set_catalog_entity_is_test) estavam
-- originalmente na 0139_add_is_test_flag_orgs_catalog_entities.sql. Movidas
-- para aqui por pedido explicito, porque essa 0139 colide de numero com uma
-- 0139 diferente ja aplicada pelo revisor (ver o cabecalho desse ficheiro) —
-- as funcoes ficam numa migracao propria, nao acopladas a resolucao dessa
-- colisao.
--
-- =============================================================================
-- O QUE MUDOU FACE A VERSAO ANTERIOR
-- =============================================================================
-- Pedido explicito: a verificacao de que quem chama e admin tem de estar
-- DENTRO do corpo da funcao, nao so confiada ao revoke de ACL. Adicionado
-- `is_platform_admin()`, mas com uma condicao: so se aplica quando
-- auth.role() = 'authenticated' (ou seja, um JWT real de utilizador
-- autenticado via PostgREST).
--
-- CORRECCAO (relatorio_verificacao_40a0835_e_reposicao_is_test_20260806 §5)
-- a uma alegacao errada que estava aqui: "uma ligacao directa via SQL
-- editor... (psql, postgres, service_role) nao tem auth.role() nenhum".
-- So metade e verdade. Medido em producao (verificacao da 0138): uma
-- ligacao directa pelo SQL editor tem mesmo auth.role() = NULL, mas
-- service_role VIA POSTGREST (qualquer rota de API que use o admin/
-- service-role client, como todas as rotas de backoffice deste
-- repositorio) tem auth.role() = 'service_role' -- uma string real, nunca
-- NULL. auth.role() le o CLAIM do JWT, nao o papel de ligacao a base.
--
-- Isto nao muda a conclusao pratica: nos dois casos (SQL directo e
-- service_role) a condicao `auth.role() = 'authenticated'` e falsa, logo a
-- guarda nao dispara em nenhum dos dois -- exactamente como a app precisa
-- hoje (revisor/Nuno via SQL editor; qualquer futura rota de API via o
-- admin client). A alegacao errada era so na explicacao de PORQUE, nao no
-- comportamento.
--
-- O revisor propos endurecer para bloquear tambem `service_role` sem
-- is_platform_admin(). Avaliado e NAO adoptado, por duas razoes: (1)
-- nenhuma rota do repositorio chama esta funcao hoje -- e revogada de
-- public/anon/authenticated, so alcancavel por quem ja tem acesso directo
-- a base (SQL editor) ou pelo service_role, que sao precisamente os dois
-- chamadores de confianca que este ficheiro pretende continuar a servir;
-- (2) e inconsistente com o modelo de seguranca que o resto do backoffice
-- ja usa em todo o lado (requirePlatformAdmin() ao nivel da ROTA antes de
-- chamar o cliente service_role -- ver src/lib/backoffice-auth.ts e todas
-- as rotas /api/backoffice/*) -- nenhuma outra mutacao admin deste
-- repositorio re-verifica o admin dentro da funcao SQL, so na rota. Se um
-- toggle de backoffice vier a chamar isto directamente de uma rota de API,
-- essa rota tem de trazer o proprio requirePlatformAdmin() antes de tocar
-- no cliente admin -- mesma disciplina que todas as outras, nao uma
-- excepcao.
--
-- `is_platform_admin()` continua a existir aqui como a camada que recusa
-- um `authenticated` sem ser admin -- o caso real que esta guarda existe
-- para apanhar, e o unico que muda de comportamento consoante quem chama.
--
-- `set search_path = public, pg_temp` ja estava nas duas, mantido.
-- `revoke all ... from public, anon, authenticated` mantido tambem — a
-- guarda interna e defesa em profundidade, nao substitui o revoke.
-- =============================================================================

begin;

create or replace function public.set_org_is_test(p_org_id uuid, p_is_test boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.role() = 'authenticated' and not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;
  update public.orgs set is_test = p_is_test where id = p_org_id;
end;
$function$;
revoke all on function public.set_org_is_test(uuid, boolean) from public, anon, authenticated;

create or replace function public.set_catalog_entity_is_test(p_catalog_entity_id uuid, p_is_test boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.role() = 'authenticated' and not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;
  update public.catalog_entities set is_test = p_is_test where id = p_catalog_entity_id;
end;
$function$;
revoke all on function public.set_catalog_entity_is_test(uuid, boolean) from public, anon, authenticated;

commit;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select has_function_privilege('authenticated', 'public.set_org_is_test(uuid,boolean)', 'EXECUTE') as auth_pode_org,
--        has_function_privilege('authenticated', 'public.set_catalog_entity_is_test(uuid,boolean)', 'EXECUTE') as auth_pode_catalog;
-- Esperado: false, false (ACL continua fechada; a guarda interna e so
-- defesa em profundidade para o dia em que isto mudar).
--
-- select prosrc like '%is_platform_admin%' from pg_proc
-- where proname in ('set_org_is_test', 'set_catalog_entity_is_test');
-- Esperado: true nas duas.
--
-- Teste funcional (correr no SQL editor do Supabase, como postgres/service_role):
--   select set_org_is_test('bca54499-03c8-469b-a48d-b9f442e44f69', true);
-- Tem de passar (auth.role() e NULL numa ligacao directa, nao 'authenticated'
-- -- a guarda nao se aplica). Confirmar com:
--   select id, name, is_test from orgs where id = 'bca54499-03c8-469b-a48d-b9f442e44f69';
-- =============================================================================
