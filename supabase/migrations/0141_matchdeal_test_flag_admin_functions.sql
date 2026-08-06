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
-- autenticado via PostgREST). Uma ligacao directa via SQL editor do
-- Supabase (psql, postgres, service_role) nao tem auth.role() nenhum —
-- fica NULL, nunca 'authenticated' — e portanto nao passa pela guarda:
-- continua reachable pelo revisor/Nuno exactamente como antes. Se a ACL for
-- alargada a `authenticated` no futuro (quando um toggle de backoffice
-- vier a chamar isto directamente da app), a guarda ja esta pronta para
-- recusar quem nao for platform_admin — nao e preciso voltar aqui.
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
