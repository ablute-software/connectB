-- APLICADO EM PRODUÇÃO 2026-08-17 (verificado por SQL: tabela presente com
-- 12 colunas, RLS ligada, 1 policy company_claims_org_members (ALL,
-- is_org_member em using E with check), 3 índices, os 5 CHECKs de
-- categoria/classe/especificidade/fonte/status e a FK org_id->orgs
-- ON DELETE CASCADE. 0 linhas — a ingestão é do bloco 3.)
-- Texto abaixo é o do revisor, verbatim.
--
-- Prompt 219 bloco 1 — a base de conhecimento do motor de narrativa: cada
-- linha é um CLAIM — uma afirmação sobre a empresa com categoria, classe de
-- evidência (1 = compromisso pago … 5 = decoração), especificidade e FONTE.
-- NADA entra em superfície nenhuma sem status='accepted'.
create table if not exists company_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  category text not null check (category in (
    'problema','solucao','prova_tecnica','validacao_externa',
    'tracao_gtm','equipa','mercado_timing','funding','ask')),
  statement text not null,
  evidence_class int not null check (evidence_class between 1 and 5),
  specificity text not null check (specificity in ('high','medium','low')),
  source_kind text not null check (source_kind in (
    'fact','vault_doc','roadmap','profile','funding_round','founder_answer')),
  source_ref text,
  status text not null default 'proposed' check (status in ('proposed','accepted','rejected')),
  analysis_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_claims_org_idx on company_claims(org_id);
create index if not exists company_claims_org_status_idx on company_claims(org_id, status);

alter table company_claims enable row level security;

drop policy if exists company_claims_org_members on company_claims;
create policy company_claims_org_members on company_claims
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table company_claims is
  'Base de conhecimento da narrativa (Prompt 219). Cada frase que sai para investidores rastreia ate aqui. So status=accepted alimenta superficies.';
