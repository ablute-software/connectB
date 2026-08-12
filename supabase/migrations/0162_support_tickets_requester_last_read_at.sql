-- =============================================================================
-- 0162_support_tickets_requester_last_read_at.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro:
--   prompt_176_taxonomia_sectores_e_badge_support_20260812.md §B
--
-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- api/support/my-tickets/route.ts calcula `unread` comparando a ultima
-- atividade do admin (reply/status_change) com a data do ULTIMO EVENTO QUE
-- O PROPRIO UTILIZADOR ESCREVEU no ticket (`myLast`), nunca com "o
-- utilizador abriu o ticket". Abrir o ticket
-- (api/support/my-tickets/[id]/route.ts, GET) nao escreve nada -- nao existe
-- nenhum campo de "lido" para o Support, ao contrario das Messages
-- (deal_threads ja tem investor_last_read_at/founder_last_read_at,
-- migracao 0126 -- esse mecanismo fica intocado, so serve de precedente
-- aqui). Resultado: um utilizador que abre um ticket com reply do admin
-- nao lido continua a ve-lo como nao lido ate ele proprio responder outra
-- vez (ou nunca, se so estiver a ler).
--
-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- Acrescenta support_tickets.requester_last_read_at (timestamptz, nullable
-- -- null = nunca lido, o codigo aplicativo usa created_at como fallback
-- nesse caso). Escrito como efeito lateral de
-- GET /api/support/my-tickets/[id] quando o dono do ticket o abre (mesmo
-- padrao markThreadRead/deal_threads, so que aqui e uma coluna na propria
-- support_tickets em vez de uma tabela de threads separada). Lido em
-- GET /api/support/my-tickets para decidir `unread` por comparacao directa
-- de timestamp, substituindo a inferencia por "ultimo evento do proprio
-- utilizador".
--
-- Aditiva -- so acrescenta uma coluna nullable, nao remove nem altera nada.
-- O codigo aplicativo (support-requester-read-capability.ts) degrada com
-- seguranca para a logica antiga enquanto esta migracao nao estiver
-- aplicada -- nunca um erro.
-- =============================================================================

begin;

alter table public.support_tickets add column requester_last_read_at timestamptz;

commit;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select column_name, data_type, is_nullable from information_schema.columns
-- where table_schema = 'public' and table_name = 'support_tickets'
--   and column_name = 'requester_last_read_at';
-- Esperado: uma linha, data_type = 'timestamp with time zone', is_nullable = 'YES'.
-- =============================================================================
