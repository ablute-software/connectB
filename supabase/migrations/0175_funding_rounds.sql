-- Prompt 212 §B.1 — APLICADO EM PRODUÇÃO 2026-08-16 pelo revisor.
--
-- Rondas passadas: capital JÁ levantado, separado da ronda actual.
--
-- O bug estrutural que isto fecha: a app não tinha onde guardar "capital de
-- rondas anteriores", portanto o founder registou os €100k de uma ronda
-- antiga como `interest_eur` de uma entrada do pipeline ("Nuno Marujo",
-- not_contacted) — a única forma que a app lhe dava. O review somou esse
-- número como soft-circled DESTA ronda e o SWOT disse ao investidor que só
-- €100k de €300k estavam fechados. O dado não estava errado; estava no
-- sítio errado, porque o sítio certo não existia.
--
-- Fonte ÚNICA: as superfícies (perfil, dossier, cartão de arquivo, próximo
-- review) leem daqui, nunca de cópias. O founder corrige num só local.
create table if not exists funding_rounds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  -- "Pre-seed", "FCT grant", "Friends & family" — texto livre porque a
  -- taxonomia real varia por país e por instrumento, e forçar um enum aqui
  -- fazia o founder mentir para caber.
  label text not null,
  amount_eur numeric not null check (amount_eur >= 0),
  closed_year int check (closed_year between 1900 and 2100),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists funding_rounds_org_idx on funding_rounds(org_id);

alter table funding_rounds enable row level security;

-- Mesmo padrão das outras tabelas por org: só membros da org, e o
-- is_org_member() que já existe (0001).
drop policy if exists funding_rounds_org_members on funding_rounds;
create policy funding_rounds_org_members on funding_rounds
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

comment on table funding_rounds is
  'Capital JA levantado em rondas anteriores. Distinto de orgs.round_secured_eur, que e a ronda actual. Prompt 212 B.1.';
