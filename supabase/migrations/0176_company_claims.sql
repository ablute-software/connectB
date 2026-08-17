-- Prompt 219 bloco 1 — PROPOSTO, NÃO APLICADO (aplica o revisor).
--
-- A base de conhecimento do motor de narrativa: cada linha é um CLAIM —
-- uma afirmação sobre a empresa com categoria, classe de evidência (1 =
-- compromisso pago … 5 = decoração), especificidade e FONTE. É daqui que
-- todas as superfícies viradas a investidores passarão a beber, e é por
-- cada frase ter fonte que a fuga do 211 se torna estruturalmente
-- impossível: performance de plataforma nem categoria tem neste modelo.
--
-- NADA entra em superfície nenhuma sem status='accepted' — o founder
-- aceita/edita/rejeita cada claim proposto. Mesmo padrão dos canon facts:
-- confirmado é a moeda.
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
  -- A análise que o propôs (blueprint_analyses, migração futura do bloco 3).
  -- uuid solto por agora — a FK entra quando a tabela existir, para as duas
  -- migrações não ficarem acopladas.
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
