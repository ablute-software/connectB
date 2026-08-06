-- =============================================================================
-- 0139_add_is_test_flag_orgs_catalog_entities.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar e
-- devolver a confirmacao pos-aplicacao.
--
-- Ficheiro companheiro:
--   mini_prompt_item15_pipeline_stats_contaminacao_estrutural_20260806.md
--
-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- As stats da Pipeline do investidor (populacao de "Tracking", "Data room
-- open", contagens de "outros investidores a acompanhar") estao contaminadas
-- por orgs/entidades internas e de teste, de forma ESTRUTURAL -- nao e um par
-- de contas por reconciliar a mao, e nao ha mecanismo nenhum no schema para
-- distinguir dados internos/teste de dados reais. Duas provas medidas em
-- producao (ver o mini-prompt para o detalhe completo):
--
--   1. `eligiblePipelineOrgIds()` (src/lib/portal-access.ts:55-58) define a
--      populacao de "Tracking" como TODOS os matchdeal_profiles kind=startup
--      com is_visible=true, sem filtro nenhum de teste. O org
--      c21efeda-022e-46cf-beca-c0f93d3d5c6c ("Sherlock Deal_ test") tem
--      is_visible=true e is_complete=true -- aparece HOJE, para QUALQUER
--      investidor real, como card de Tracking na Pipeline.
--
--   2. `activeGrantOrgIds()` (src/lib/portal-access.ts:26-39) resolve grants
--      por email/person_id, nunca por catalog_entity_id. Um access_grants
--      real do org interno "ablute_" (bca54499-03c8-469b-a48d-b9f442e44f69)
--      para alexandrameira.ablute@gmail.com aparece como "Data room open" na
--      Pipeline de "Invest green" -- a entidade investidora REAL que aquele
--      email usa -- porque o grant e puramente interno/QA mas o lookup nao
--      distingue.
--
-- Nao ha coluna is_test/is_internal em orgs, catalog_entities nem
-- matchdeal_profiles (confirmado via information_schema.columns). O unico
-- mecanismo de "isto e teste" que existe, is_ablute_developer() (dominio
-- @ablute.pt), so bloqueia ESCRITAS no route handler da Pipeline
-- (src/app/api/portal/pipeline/route.ts:106-107), nao filtra LEITURAS, nao
-- cobre contas gmail usadas internamente (como a do exemplo acima), e nao
-- tem efeito nenhum sobre access_grants (escrito do lado do founder, uma
-- accao legitima sem guarda de QA).
--
-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- 1. Duas colunas aditivas, nao destrutivas: orgs.is_test e
--    catalog_entities.is_test, boolean not null default false. Nao toca em
--    access_grants nem no motor de matching (matchdeal_eligible_deck).
--
-- 2. Backfill dos casos ja identificados e confirmados nesta investigacao
--    (ver a query de confirmacao no fim do ficheiro):
--      orgs: "ablute_", "Sherlock Deal_ test", "Test & trial",
--            "Caramel Biscuit"
--      catalog_entities: as 5 entidades seedadas "(demo)" mais
--            "ablute_ — Internal QA"
--
-- 3. Duas funcoes SQL para marcar is_test manualmente dai em diante, ate
--    existir um toggle no backoffice (nao construido nesta proposta -- ver
--    nota no fim). Reachable so por postgres/service_role (revogado de
--    public/anon/authenticated de proposito): destinam-se a ser corridas
--    pelo revisor ou pelo Nuno directamente no SQL editor do Supabase, o
--    mesmo modelo de acesso que qualquer outra migracao ja usa -- nao pela
--    app. Se um toggle no backoffice vier a ser construido, a ACL destas
--    funcoes precisa de ser alargada a `authenticated` NESSA altura, com uma
--    guarda is_platform_admin() acrescentada ao corpo primeiro (hoje seria
--    inseguro conceder a authenticated sem essa guarda).
--
-- =============================================================================
-- O QUE ESTA MIGRACAO NAO FAZ (deliberado)
-- =============================================================================
-- - Nao mexe em access_grants nem em matchdeal_eligible_deck -- so leitura e
--   filtragem do que ja la esta.
-- - Nao constroi um toggle de backoffice -- o pedido oferecia isso OU, no
--   minimo, uma funcao SQL invocavel; esta proposta entrega o minimo,
--   imediatamente util, e regista o toggle como melhoria futura em aberto.
-- - Nao filtra is_test nas leituras de matchdeal_swipes/
--   investor_relationship_decisions que alimentam as metricas internas do
--   backoffice (backoffice-metrics.ts, /api/backoffice/metrics/matchdeal) --
--   essa e uma decisao de PRODUTO diferente (o Nuno pode genuinamente querer
--   ver a sua propria actividade de QA nas metricas internas da equipa,
--   distinto de a esconder da Pipeline de um investidor real) e fica
--   sinalizada, nao decidida aqui.
--
-- =============================================================================
-- SWEEP -- candidatos por padrao de nome, para o revisor correr ANTES de
-- aplicar. Nao incluidos no backfill automatico: sao heuristicas, nao factos
-- confirmados -- marcar um org/entidade REAL como is_test por engano teria
-- exactamente o efeito inverso ao pedido (escondia dados reais em silencio).
-- =============================================================================
-- select id, name, created_at from public.orgs
-- where name ilike '%test%' or name ilike '%demo%' or name ilike '%trial%'
--    or name ilike '%qa%' or name ilike '%sample%'
-- order by created_at;
--
-- select id, name, source, created_at from public.catalog_entities
-- where name ilike '%test%' or name ilike '%demo%' or name ilike '%trial%'
--    or name ilike '%qa%' or name ilike '%sample%'
-- order by created_at;
--
-- -- Orgs cujos membros usam email @ablute.pt (equipa interna) -- candidatos
-- -- a rever manualmente, nao a marcar cegamente (um org real pode
-- -- legitimamente ter um membro @ablute.pt convidado, p.ex. um advisor).
-- select distinct o.id, o.name, u.email
-- from public.orgs o
-- join public.org_members om on om.org_id = o.id
-- join auth.users u on u.id = om.user_id
-- where u.email ilike '%@ablute.pt' and o.id not in (
--   'bca54499-03c8-469b-a48d-b9f442e44f69', 'c21efeda-022e-46cf-beca-c0f93d3d5c6c',
--   '4d746b5d-5ae0-44c2-866b-df8660f25007', '45e28905-0a9c-42d8-bcd0-a0ba447484c6'
-- );
-- =============================================================================

begin;

alter table public.orgs add column if not exists is_test boolean not null default false;
alter table public.catalog_entities add column if not exists is_test boolean not null default false;

-- Backfill -- os quatro orgs confirmados no mini-prompt.
update public.orgs set is_test = true
where id in (
  'bca54499-03c8-469b-a48d-b9f442e44f69', -- ablute_
  'c21efeda-022e-46cf-beca-c0f93d3d5c6c', -- Sherlock Deal_ test
  '4d746b5d-5ae0-44c2-866b-df8660f25007', -- Test & trial
  '45e28905-0a9c-42d8-bcd0-a0ba447484c6'  -- Caramel Biscuit
);

-- Backfill -- as 5 entidades seedadas "(demo)" mais a "ablute_ — Internal QA".
update public.catalog_entities set is_test = true
where id in (
  'd0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000002',
  'd0000000-0000-0000-0000-000000000003',
  'd0000000-0000-0000-0000-000000000004',
  'd0000000-0000-0000-0000-000000000005',
  'f2a94a65-3489-4b50-827f-9d3b5b521322' -- ablute_ — Internal QA
);

-- Funcoes de manutencao -- so postgres/service_role (revogado de
-- public/anon/authenticated). Ver nota no cabecalho sobre alargar a ACL se
-- um toggle de backoffice vier a existir.
create or replace function public.set_org_is_test(p_org_id uuid, p_is_test boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
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
  update public.catalog_entities set is_test = p_is_test where id = p_catalog_entity_id;
end;
$function$;
revoke all on function public.set_catalog_entity_is_test(uuid, boolean) from public, anon, authenticated;

commit;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select id, name, is_test from public.orgs
-- where id in (
--   'bca54499-03c8-469b-a48d-b9f442e44f69', 'c21efeda-022e-46cf-beca-c0f93d3d5c6c',
--   '4d746b5d-5ae0-44c2-866b-df8660f25007', '45e28905-0a9c-42d8-bcd0-a0ba447484c6'
-- );
-- Esperado: is_test = true nas quatro, nome confere com o comentario.
--
-- select id, name, is_test from public.catalog_entities
-- where id in (
--   'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
--   'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004',
--   'd0000000-0000-0000-0000-000000000005', 'f2a94a65-3489-4b50-827f-9d3b5b521322'
-- );
-- Esperado: is_test = true nas seis.
--
-- select count(*) from public.orgs where is_test = true;    -- esperado: 4
-- select count(*) from public.catalog_entities where is_test = true; -- esperado: 6
--
-- select has_function_privilege('authenticated', 'public.set_org_is_test(uuid,boolean)', 'EXECUTE') as auth_pode_org,
--        has_function_privilege('authenticated', 'public.set_catalog_entity_is_test(uuid,boolean)', 'EXECUTE') as auth_pode_catalog;
-- Esperado: false, false (so postgres/service_role podem chamar).
--
-- Teste funcional (depois do codigo do lado da app tambem estar deployed --
-- ver commit companheiro): a Pipeline de um investidor real ja nao deve
-- mostrar "Sherlock Deal_ test" como card de Tracking, nem "ablute_" como
-- "Data room open" para contas que so tem esse grant interno.
-- =============================================================================
