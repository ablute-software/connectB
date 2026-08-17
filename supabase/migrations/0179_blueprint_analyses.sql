-- 0179 — PROPOSTO, NÃO APLICADO (aplica o revisor).
--
-- Prompt 219 bloco 3 §2 — a ANÁLISE como unidade: uma passagem do motor de
-- narrativa sobre a empresa, com as perguntas que fez e o que ficou por
-- responder. É o que torna "não voltes a perguntar isto" answerable, e é
-- também onde o contador de consumo do bloco 6 (1/mês + €25) vai bater.
--
-- Deliberadamente NÃO existe tabela `founder_answers`: uma resposta do
-- founder a uma pergunta de lacuna É um claim novo em company_claims, com
-- source_kind='founder_answer' e analysis_id a apontar para aqui. A 0176 já
-- previu isto e deixou analysis_id como uuid solto exactamente para este
-- momento — a FK entra abaixo, agora que há tabela para onde apontar.
create table if not exists blueprint_analyses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress','completed','abandoned')),
  -- O registo do interrogatório: [{rule, question, answered, dismissed, at}]
  -- — o que foi perguntado e o que o founder fez com cada pergunta. jsonb e
  -- não tabela-filha porque nada consulta isto por pergunta individual: é
  -- lido inteiro com a análise, e escrito inteiro a cada resposta.
  questions_asked jsonb not null default '[]'::jsonb,
  -- Consumo, para o bloco 6. Preenchido quando a análise conta para a quota
  -- (a de cortesia mensal) ou foi paga; NULL enquanto não se decidiu, que é
  -- o caso de todas as análises até o bloco 6 existir.
  consumed_kind text check (consumed_kind in ('monthly_free','paid')),
  consumed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blueprint_analyses_org_idx on blueprint_analyses(org_id);
create index if not exists blueprint_analyses_org_status_idx on blueprint_analyses(org_id, status);
-- O contador do bloco 6 pergunta "quantas análises consumidas neste mês
-- para esta org"; este índice é o que torna essa pergunta barata.
create index if not exists blueprint_analyses_org_consumed_idx on blueprint_analyses(org_id, consumed_at);

alter table blueprint_analyses enable row level security;

-- Mesma fronteira de confiança da 0176: os membros da org gerem as suas
-- próprias análises por RLS normal. Nada de investidor toca nisto — uma
-- análise é o interrogatório privado do founder, e a regra raiz aplica-se
-- por inteiro (nenhuma superfície de investidor lê esta tabela).
drop policy if exists blueprint_analyses_org_members on blueprint_analyses;
create policy blueprint_analyses_org_members on blueprint_analyses
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table blueprint_analyses is
  'Uma passagem do motor de narrativa (Prompt 219). questions_asked regista o interrogatorio; consumed_* alimenta a quota do bloco 6. Founder-only.';

-- A FK que a 0176 deixou por fazer, agora que há destino. ON DELETE SET
-- NULL e não CASCADE, e a escolha é deliberada: apagar uma análise não pode
-- levar atrás os claims que ela produziu. Uma resposta do founder é
-- conhecimento sobre a empresa e sobrevive à análise que a provocou — só
-- perde a referência à conversa onde nasceu.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_claims'::regclass and conname = 'company_claims_analysis_id_fkey'
  ) then
    alter table company_claims
      add constraint company_claims_analysis_id_fkey
      foreign key (analysis_id) references blueprint_analyses(id) on delete set null;
  end if;
end $$;

create index if not exists company_claims_analysis_idx on company_claims(analysis_id);
