-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro: prompt_179_pipeline_vidro_fosco_e_entrega_mensal_20260812.md §A

-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- catalog_blocked_count() (migracao 0042) conta linhas que JA EXISTEM em
-- `entities` com source='catalog' e nao visiveis (nem unlocked_at nem
-- catalog_is_visible). Mas desde a migracao 0149 (motor de correspondencia,
-- Prompt 139), unlockPack() so insere em `entities` exactamente as
-- orgs.catalog_quota entidades ja desbloqueadas -- NUNCA insere o resto do
-- catalogo como linhas escondidas/bloqueadas. Nao ha "linhas bloqueadas" em
-- entities para contar -- o conjunto e sempre vazio.
--
-- Confirmado directamente em producao (so leitura, sem alterar nada), org
-- "Estojo" (plano idea, catalog_quota=3):
--   entities com source='catalog': 3 (as 3 ja entregues e visiveis)
--   catalog_deliveries desta org: 3
--   catalog_entities elegiveis (verified, nao-teste) no catalogo inteiro: 358
-- catalog_blocked_count() devolve sempre 0 para esta org -- o painel de
-- vidro fosco (pipeline/page.tsx linhas ~566-575, correcto visualmente)
-- nunca aparece, apesar de existirem 355 investidores elegiveis ainda por
-- entregar (358 - 3 ja entregues).
--
-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- catalog_blocked_count() deixa de contar `entities`; passa a reutilizar
-- catalog_top_matches(p_org_id, p_limit) -- ja existe, Prompt 139 -- com um
-- limite alto (o proprio tamanho do catalogo, nunca um numero magico fixo)
-- para obter o universo de matches elegiveis AINDA POR ENTREGAR desta org.
--
-- DESVIO DELIBERADO ao enunciado literal do prompt ("o bloqueado e
-- matches_elegiveis - orgs.catalog_quota"), com o motivo medido em
-- producao antes de escrever SQL nenhum: catalog_top_matches ja EXCLUI as
-- entidades ja entregues (`not exists (... catalog_deliveries ...)`), logo
-- o numero que devolve e o POOL POR ENTREGAR (355 para a Estojo), nao o
-- universo total elegivel (358). Subtrair catalog_quota (3) diretamente
-- desse pool por entregar dava 352 -- errado por exactamente
-- `catalog_deliveries` (3, o numero de entregas ja feitas), sempre que
-- delivered_count > 0. Como o mecanismo normal (unlockPack/entrega mensal)
-- entrega ate a quota assim que ha oportunidade, delivered_count anda quase
-- sempre igual ou proximo de catalog_quota em regime normal -- ou seja, este
-- desvio da formula literal aconteceria em quase todos os casos reais, nao
-- so em edge cases.
--
-- Corrigido somando de volta o numero ja entregue:
--   bloqueado = (pool por entregar) + (ja entregue) - catalog_quota
-- Algebricamente: pool_por_entregar = elegivel_total - ja_entregue, logo
-- bloqueado = elegivel_total - ja_entregue + ja_entregue - quota
--           = elegivel_total - catalog_quota
-- -- exactamente a formula que o prompt pede, so calculada de forma que
-- fica correcta mesmo com catalog_top_matches a excluir o ja entregue.
-- Verificado com os numeros reais da Estojo: 355 (pool) + 3 (entregue) - 3
-- (quota) = 355 = 358 (elegivel total) - 3 (quota). Confere.
--
-- Mesmo contrato (check_org uuid -> int), mesmo nome, mesmo grant -- o
-- frontend nao precisa de tocar (browserClient().rpc('catalog_blocked_count', ...)
-- em pipeline/page.tsx linha ~293 fica inalterado).
-- =============================================================================

create or replace function public.catalog_blocked_count(check_org uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_quota int;
  v_delivered int;
  v_catalog_size int;
  v_undelivered_eligible int;
begin
  if not is_org_member(check_org) then return 0; end if;

  select catalog_quota into v_quota from public.orgs where id = check_org;
  if v_quota is null then return 0; end if;

  select count(*) into v_delivered from public.catalog_deliveries where org_id = check_org;
  -- "sem limite" pedido pelo prompt, na pratica: o proprio tamanho do
  -- catalogo, nunca um numero fixo (500) que ficaria ultrapassado ao
  -- crescer o catalogo silenciosamente.
  select count(*) into v_catalog_size from public.catalog_entities;

  select count(*) into v_undelivered_eligible
  from public.catalog_top_matches(check_org, greatest(v_catalog_size, 1));

  return greatest(0, v_undelivered_eligible + v_delivered - v_quota);
end;
$$;
grant execute on function public.catalog_blocked_count(uuid) to authenticated;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select catalog_blocked_count('b618b763-81ef-4d6c-bf82-697a2d175783'); -- Estojo
-- Esperado: 355 (358 elegiveis no catalogo inteiro - catalog_quota=3).
-- =============================================================================
