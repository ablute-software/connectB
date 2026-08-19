-- =============================================================================
-- 0193_reawakening_advice.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro: prompt_272_sherlock_adviser_conselho_acionavel_20260819.md
-- =============================================================================
-- Prompt 272 — o degrau acima do 271: "Ask Sherlock" deixa de devolver um
-- paragrafo unico (rationale) e passa a devolver os 5 elementos de um
-- conselho de adviser a serio (reconhecer, responder ao pendente, o
-- gancho novo ou "ainda nao", canal+pessoa+timing). rationale continua a
-- existir (o resumo de uma linha, para os sitios que ja o leem sem
-- mudanca -- Pipeline row, nextBestAction) -- advice e o detalhe
-- estruturado novo, so relevante para trigger_kind='neglect' (as outras
-- duas origens nunca o preenchem).
--
-- jsonb em vez de colunas separadas por elemento: ao contrario de
-- trigger_kind (0192, uma distincao de 3 vias reutilizada em toda a
-- tabela), esta estrutura so serve UMA das tres origens -- 5 colunas
-- novas so para essa fatia era mais ruido de schema do que um bloco
-- coerente que se le/escreve de uma vez.
alter table reawakening_proposals add column advice jsonb;

comment on column reawakening_proposals.advice is
  'Prompt 272 -- conselho estruturado do Sherlock (so trigger_kind=neglect): acknowledge, respondTo[], newHook ou holdReason, channel/personId/personName/timing. rationale continua a ser o resumo de uma linha.';
