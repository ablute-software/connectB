-- 0133 — fecha a exposição anónima das quatro funções criadas pela 0129.
--
-- APLICADA EM PRODUÇÃO A 06/08/2026 09:16:51 UTC pelo revisor (versão
-- 20260806091651 em supabase_migrations.schema_migrations), sem ficheiro no
-- repositório. Este ficheiro é a reconstrução verbatim do que está aplicado,
-- para o repositório voltar a ser fonte da verdade do esquema. Aplicar num
-- ambiente que já a tem é inofensivo (revoke é idempotente).
--
-- DEFEITO (introduzido pela aplicação da 0129, detectado na pós-verificação
-- pelo revisor, não reportado por ninguém): a 0129 termina com um
--
--   revoke execute on function public.matchdeal_record_interest_notification(uuid, uuid, text)
--     from public, anon, authenticated;
--
-- que cobre APENAS essa função. As outras quatro que a 0129 cria ficaram com
-- o default do Postgres — PUBLIC tem EXECUTE — e como são SECURITY DEFINER,
-- correm com os privilégios do owner.
--
-- IMPACTO PROVADO, NÃO TEÓRICO: close_investor_interest_tasks devolve void e
-- é por isso exposta pelo PostgREST em /rest/v1/rpc/. Com a anon key e um
-- UUID qualquer de entities.id, um chamador NÃO AUTENTICADO marcava
-- done = true nas tarefas "Respond to expressed interest" dessa startup —
-- sem qualquer scoping por org, logo cross-tenant. Provado em produção com
-- curl contra um UUID inexistente (zero linhas afectadas): HTTP 204. O
-- controlo matchdeal_record_interest_notification devolveu 401 no mesmo
-- teste, e as três trigger functions devolveram 404 PGRST202 (o PostgREST
-- não expõe funções que devolvem trigger).
--
-- É exactamente o modo de falha que a 0129 existe para prevenir: o interesse
-- do investidor fica por accionar e ninguém dá por isso. Só que por fora.
--
-- PORQUÊ REVOGAR TAMBÉM ÀS TRÊS TRIGGER FUNCTIONS, se o PostgREST não as
-- expõe: defesa em profundidade. A não-exposição é um detalhe de
-- implementação do PostgREST, não uma garantia do Postgres; o EXECUTE
-- público continua a ser um privilégio real por qualquer outro caminho.
--
-- SEGURANÇA DA PRÓPRIA CORREÇÃO — validada numa transação com rollback antes
-- de ser aplicada a sério, e re-validada depois: o Postgres NÃO verifica o
-- privilégio EXECUTE de uma trigger function quando o trigger dispara (só o
-- faz no CREATE TRIGGER). A cadeia de auto-fecho foi exercida inteira depois
-- do revoke e os três ramos continuaram a funcionar: fechada_por_outbound=1,
-- fechada_por_decision=1, fechada_por_log=1. O `perform` interno mantém o
-- privilégio porque corre como o owner SECURITY DEFINER.
--
-- Nenhum call site na aplicação é afectado: grep em src/ por
-- close_investor_interest_tasks e trg_close_investor_interest devolve zero
-- referências — estas funções só são alcançadas por triggers.
--
-- NUMERAÇÃO: aplicada fora de ordem numérica de propósito. Os números 0131 e
-- 0132 foram entretanto ocupados pelo commit 8143c75 (P136, ambas ainda
-- PROPOSE ONLY, por aplicar). Esta correção é urgente e independente de
-- ambas — só mexe em privilégios de funções criadas pela 0129 — pelo que foi
-- aplicada já, com o número seguinte livre.

revoke execute on function public.close_investor_interest_tasks(uuid)
  from public, anon, authenticated;

revoke execute on function public.trg_close_investor_interest_on_decision()
  from public, anon, authenticated;

revoke execute on function public.trg_close_investor_interest_on_outbound()
  from public, anon, authenticated;

revoke execute on function public.trg_close_investor_interest_on_log_entry()
  from public, anon, authenticated;
