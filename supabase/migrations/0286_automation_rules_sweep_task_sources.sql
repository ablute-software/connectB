-- Prompt 498 — o tick de regras (`src/lib/rules.ts`) passa a correr do lado do
-- servidor, no mesmo GET diário de /api/automations. Esta migração é só o que
-- esse sweep precisa em schema: dois valores novos de `tasks.source`, e o
-- índice que torna a não-duplicação uma garantia da base de dados em vez de
-- uma esperança do código.
--
-- Porquê valores NOVOS e não reutilizar 'suggested': 'suggested' significa
-- "o motor de relações propôs, o founder aceitou" (0065). Estas tarefas
-- nascem sem ninguém as aceitar — precisam de se distinguir para o guarda de
-- idempotência abaixo poder olhar exactamente para as suas, e para a UI
-- poder um dia ramificar nelas (hoje não ramifica: TodayPanel/
-- RelationshipSummaryCard comparam `source` por igualdade a valores
-- concretos, portanto um valor novo cai no render por omissão — verificado
-- antes de escrever isto).
--
-- Mesma precedência de alargamento que 0128 ('investor_interest'), 0132
-- ('interest_level_request') e 0243 ('document_request').
alter table tasks drop constraint if exists tasks_source_check;
alter table tasks add constraint tasks_source_check
  check (source is null or source in (
    'suggested', 'manual', 'investor_interest', 'interest_level_request',
    'document_request', 'automation_follow_up', 'automation_dormant'
  ));

-- O mecanismo de idempotência, camada 2 (a camada 1 é a leitura das tarefas
-- abertas antes de inserir, em automation-rules-tick.ts). Um sweep diário que
-- lê-depois-escreve tem uma janela de corrida entre a leitura e o insert; duas
-- corridas do cron sobrepostas, ou um retry da Vercel a meio, criariam a
-- segunda cópia da mesma tarefa. Um índice único parcial fecha isso na base de
-- dados, onde nenhuma corrida o pode contornar: no máximo UMA tarefa aberta
-- por (org, entidade, tipo de automação). Assim que o founder a fecha
-- (done = true) sai do índice, e um silêncio novo mais tarde pode voltar a
-- gerar uma — que é o comportamento certo, não uma fuga.
create unique index if not exists tasks_automation_sweep_open_uniq
  on tasks (org_id, entity_id, source)
  where done = false and source in ('automation_follow_up', 'automation_dormant');

-- Sonda de capacidade para o alargamento do CHECK acima. Um select de coluna
-- não vê valores de constraint, e uma sonda por insert+rollback precisaria de
-- um org_id real (FK) — mesma razão, mesma solução que
-- public.entities_source_expanded() (0122): introspecção read-only da
-- definição da própria constraint.
create or replace function public.tasks_source_automation_sweep_ready() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pg_constraint
    where conname = 'tasks_source_check'
      and pg_get_constraintdef(oid) like '%automation_follow_up%'
  );
$$;

-- Mesma política de 0134: só o service_role (que a sonda usa) precisa disto.
revoke execute on function public.tasks_source_automation_sweep_ready()
  from public, anon, authenticated;
