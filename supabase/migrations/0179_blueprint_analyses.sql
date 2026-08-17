-- APLICADO EM PRODUÇÃO 2026-08-17 (verificado por SQL: 11 colunas, RLS
-- ligada com 1 policy blueprint_analyses_org_members (ALL, is_org_member),
-- os 3 índices declarados — pg_indexes conta 4 porque inclui o implícito da
-- primary key — o índice company_claims_analysis_idx, e a FK
-- company_claims_analysis_id_fkey com confdeltype='n', ou seja ON DELETE
-- SET NULL e não CASCADE, que era a decisão a proteger. 0 linhas.)
--
-- Caminho de escrita completo exercido contra o esquema real, dentro de uma
-- transação com ROLLBACK: criar análise → gravar claim com analysis_id a
-- apontar-lhe → acrescentar a pergunta ao questions_asked e fechar a
-- análise. Passou os três passos (1 pergunta registada, status 'completed',
-- 1 claim ligado) e confirmei 0 linhas deixadas para trás nas duas tabelas.
-- Texto abaixo é o do revisor, verbatim.
--
-- Prompt 219 bloco 3 §2 — a ANÁLISE como unidade: uma passagem do motor de
-- narrativa sobre a empresa, com as perguntas que fez e o que ficou por
-- responder.
create table if not exists blueprint_analyses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress','completed','abandoned')),
  questions_asked jsonb not null default '[]'::jsonb,
  consumed_kind text check (consumed_kind in ('monthly_free','paid')),
  consumed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blueprint_analyses_org_idx on blueprint_analyses(org_id);
create index if not exists blueprint_analyses_org_status_idx on blueprint_analyses(org_id, status);
create index if not exists blueprint_analyses_org_consumed_idx on blueprint_analyses(org_id, consumed_at);

alter table blueprint_analyses enable row level security;

drop policy if exists blueprint_analyses_org_members on blueprint_analyses;
create policy blueprint_analyses_org_members on blueprint_analyses
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table blueprint_analyses is
  'Uma passagem do motor de narrativa (Prompt 219). questions_asked regista o interrogatorio; consumed_* alimenta a quota do bloco 6. Founder-only.';

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
