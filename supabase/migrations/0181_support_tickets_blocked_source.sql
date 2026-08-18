-- =============================================================================
-- 0181_support_tickets_blocked_source.sql
--
-- ESTADO: APLICADA em producao (confirmado pelo revisor/Cowork, Prompt 249)
-- -- a constraint de support_tickets.source ja inclui 'suspended' e
-- 'blocked'. A 0143_support_tickets_suspended_source.sql continua por
-- aplicar por outro motivo (revisao propria) -- nao confundir as duas.
--
-- Ficheiro companheiro: prompt_244_fila_contas_suspeitas_backoffice_20260817.md
-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- src/app/blocked/page.tsx (novo, Prompt 244/245) e onde o middleware manda
-- uma sessao cujo email esta em blocked_emails (migracao 0180). Mesma forma
-- e razao que /suspended: o ContactForm embutido usa source='blocked', mas
-- support_tickets.source ainda so aceita os valores da 0036 (mais
-- 'suspended', tambem ainda por aplicar).
--
-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- Acrescenta 'blocked' aos valores permitidos de support_tickets.source.
-- Fonte propria (nao reusa 'founder_app'): um ticket vindo de uma conta
-- bloqueada e operacionalmente distinto -- entra na mesma fila de suporte,
-- mas o developer que o le sabe de imediato que veio de alguem que a
-- app recusou deixar entrar, nao de um founder normal com uma duvida.
--
-- Aditiva -- so alarga a lista de valores aceites, nao remove nenhum.
-- Inclui 'suspended' na mesma lista (a 0143 continua tambem por aplicar) --
-- aplicar esta assume a 0143 ainda nao ter corrido.
-- =============================================================================

begin;

alter table public.support_tickets drop constraint support_tickets_source_check;
alter table public.support_tickets add constraint support_tickets_source_check
  check (source in ('landing', 'landing_investors', 'founder_app', 'investor_portal', 'suspended', 'blocked'));

commit;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'public.support_tickets'::regclass and conname = 'support_tickets_source_check';
-- Esperado: definicao inclui 'suspended' e 'blocked' na lista.
--
-- Nota para o revisor: src/app/api/support/submit/route.ts ja tolera esta
-- migracao (e a 0143) nao estarem aplicadas -- um insert com
-- source='suspended' ou source='blocked' que falhe por violar a constraint
-- antiga tenta automaticamente outra vez com source='founder_app', para
-- nunca perder o ticket em silencio. Depois desta migracao aplicada, a
-- segunda tentativa deixa de ser necessaria mas fica inofensiva.
-- =============================================================================
