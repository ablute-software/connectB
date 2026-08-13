-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro: prompt_191_catalog_candidates_editar_contactos_checkbox_20260813.md §E

-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- A fila "Added by startups" (Queue -> Catalog candidates) devolve SEMPRE
-- todas as entities com source='manual', sem nocao de "ja tratada" -- uma
-- linha promovida ou juntada ao catalogo continua a aparecer para sempre,
-- obrigando o admin a repetir trabalho ja feito em cada visita.
--
-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- Nova coluna entities.catalog_review_status, default 'pending' (backfill
-- automatico do Postgres para as linhas existentes). manual-entities (GET)
-- passa a filtrar so 'pending'; promote/merge (branch manualEntityId)
-- marcam 'promoted'/'merged' na entities de origem depois de escrever no
-- catalogo; um novo botao "Dismiss" marca 'dismissed' sem tocar no
-- catalogo. A entities row em si NUNCA e apagada -- e dado real da CRM da
-- propria startup, so deixa de aparecer nesta fila especifica do backoffice.
--
-- Nao tem efeito nenhum sobre o que a startup ve na sua propria Pipeline
-- (src/app/pipeline/page.tsx le entities por org_id, nunca filtra por esta
-- coluna) -- e puramente o estado de triagem do backoffice.
-- =============================================================================

alter table public.entities
  add column catalog_review_status text not null default 'pending'
    check (catalog_review_status in ('pending', 'promoted', 'merged', 'dismissed'));

comment on column public.entities.catalog_review_status is
  'Prompt 191 -- backoffice "Added by startups" (Queue -> Catalog candidates) triage state for source=''manual'' rows. Never read by the founder-facing Pipeline.';

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select catalog_review_status, count(*) from public.entities where source = 'manual' group by 1;
-- -- Esperado: tudo em 'pending' no momento em que esta migracao corre (nenhuma
-- -- linha existente foi promovida/juntada/dispensada antes desta coluna existir).
-- =============================================================================
