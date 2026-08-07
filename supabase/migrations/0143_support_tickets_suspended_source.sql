-- =============================================================================
-- 0143_support_tickets_suspended_source.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro:
--   mini_prompt_lote_B_suporte_itens_6_13_20260806.md §item 6
--
-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- src/app/suspended/page.tsx tinha um `mailto:ablutecompany@gmail.com` --
-- nao gera ticket, nao entra na fila do backoffice, sem rasto, sem SLA, e
-- nao faz nada em muitos telemoveis sem cliente de mail configurado. O
-- middleware (src/middleware.ts:57-61) reencaminha qualquer utilizador
-- suspenso, com sessao, de QUALQUER pagina que nao seja /suspended de
-- volta para /suspended -- incluindo /contact -- por isso a solucao e
-- embutir o formulario na propria pagina, nao um link para fora.
--
-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- Acrescenta 'suspended' aos valores permitidos de support_tickets.source.
-- Escolhida a opcao de dar uma fonte propria (nao reusar 'founder_app'),
-- por ser operacionalmente diferente de tudo o resto -- um ticket de conta
-- suspensa e mais urgente e tem um fluxo de resolucao proprio (o backoffice
-- decide se reactiva a conta), nao e so mais uma pergunta de founder.
-- category fica 'other' (nao criada categoria nova): a fonte 'suspended' ja
-- da o sinal operacional suficiente sem duplicar a distincao em dois sitios.
--
-- Aditiva -- so alarga a lista de valores aceites, nao remove nenhum.
-- =============================================================================

begin;

alter table public.support_tickets drop constraint support_tickets_source_check;
alter table public.support_tickets add constraint support_tickets_source_check
  check (source in ('landing', 'landing_investors', 'founder_app', 'investor_portal', 'suspended'));

commit;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'public.support_tickets'::regclass and conname = 'support_tickets_source_check';
-- Esperado: definicao inclui 'suspended' na lista.
--
-- Nota para o revisor: o codigo do lado da app (submit/route.ts) ja
-- tolera esta migracao nao estar aplicada ainda -- se o insert com
-- source='suspended' falhar por violacao da constraint antiga, tenta
-- automaticamente outra vez com source='founder_app' em vez de perder o
-- ticket em silencio. Depois desta migracao aplicada, a segunda tentativa
-- deixa de ser necessaria (a primeira passa sempre) mas fica inofensiva.
-- =============================================================================
